#!/usr/bin/env node
// Reproducible real-time UI cycles. Long deterministic matches run separately in release.mjs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOT,loadPlaywright,startServer} from './lib/harness.mjs';
import {installAudioProbe} from './lib/audio-probe.mjs';
import {boot,click,themes,start,ready,quit,purchase,backFromPack} from './lib/release-ui.mjs';
const OUT=path.join(ROOT,'test-results/soak'); fs.mkdirSync(OUT,{recursive:true});
const report={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),seed:20261022,cycles:[],status:'FAIL',started:new Date().toISOString()};
const server=await startServer();
const browser=await loadPlaywright().chromium.launch();
const context=await browser.newContext({viewport:{width:1366,height:900}});
await context.addInitScript(installAudioProbe);
await context.addInitScript(save=>{if(!sessionStorage.seeded){localStorage.setItem('emoji_elements_meta_v1',save);sessionStorage.seeded='1';}},fs.readFileSync(path.join(ROOT,'tests/fixtures/saves/existing.json'),'utf8'));
await context.addInitScript(() => {
    const timeouts=new Set(), intervals=new Set(), frames=new Set();
    for(const [set,clear,active] of [['setTimeout','clearTimeout',timeouts],['setInterval','clearInterval',intervals],['requestAnimationFrame','cancelAnimationFrame',frames]]) {
        const original=window[set].bind(window), cancel=window[clear].bind(window);
        window[set]=(callback,...args)=>{let id;id=original((...values)=>{if(set!=='setInterval')active.delete(id);if(typeof callback==='function')callback(...values);else (0,eval)(callback);},...args);active.add(id);return id;};
        window[clear]=id=>{active.delete(id);return cancel(id);};
    }
    window.__resources=()=>({timeouts:timeouts.size,intervals:intervals.size,frames:frames.size,dom:document.querySelectorAll('*').length,audio:__audioProbe.snapshot()});
});
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
async function sample(){
    await page.waitForTimeout(2200); // allow notices, source ended events and transient animations to settle
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const counters=await cdp.send('Memory.getDOMCounters');
    const resources=await page.evaluate(()=>__resources());
    const frames=await page.evaluate(()=>new Promise(resolve=>{const times=[];let previous;function frame(t){if(previous!==undefined)times.push(t-previous);previous=t;if(times.length<120)requestAnimationFrame(frame);else{times.sort((a,b)=>a-b);resolve({p50:times[60],p95:times[114],max:times.at(-1),samples:times.length});}}requestAnimationFrame(frame);}));
    return {heapBytes:metrics.JSHeapUsedSize, ...counters,...resources,frameMs:frames};
}
try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await boot(page);
    await page.evaluate(()=>{setGameplaySeed(20261022);GameFeedback.setSetting('musicOff',true);});
    // Previous-release save has 135 credits: three standard-price land packs cost 120.
    for(let cycle=0;cycle<3;cycle++){
        console.log(`cycle ${cycle}`);
        await themes(page);
        await start(page);
        for(let turn=0;turn<8;turn++){
            // Read current hand only; play real controls, never inject cards or change combat rules.
            const land=page.locator('#playerHand .card.land').first();if(await land.count())await land.click();
            const stack=page.locator('#playerBoard .land-stack-card').first();if(await stack.count())await stack.click();
            await click(page,'#endTurnBtn');
            await page.waitForFunction(()=>gameState.matchFinalized || (gameState.turn==='player' && gameState.phase==='main' && !isProcessingAction),null,{timeout:30000});
            if(await page.evaluate(()=>gameState.matchFinalized)){
                assert.equal(await page.locator('#loseOverlay').isVisible(),true,'natural match ends in defeat');
                await click(page,'#loseOverlay .overlay-btn');
                await click(page,'.deck-mode-btn[data-deck-mode="single"]');
                await click(page,'.element-btn[data-element="fire"]');
                await click(page,'#startBtn');await ready(page);
                assert.equal(await page.locator('#loseOverlay').isVisible(),false,'old completion stays closed after rematch');
                report.completions=(report.completions||0)+1;
            }
            console.log(`cycle ${cycle} turn ${turn}`);
            if(turn===3){
                // CDP lifecycle freezing is a browser page transition, separate from synthetic visibility below.
                await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
                await page.waitForTimeout(150);
                await cdp.send('Page.setWebLifecycleState',{state:'active'});
                // Headless pages cannot simulate OS backgrounding: exercise the real visibility listeners explicitly.
                await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
                await page.waitForTimeout(100);
                await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
                if(await page.locator('#pauseModal').isVisible())await page.locator('#pauseModal .menu-btn').filter({hasText:'RESUME'}).click();
            }
        }
        await quit(page); // immediate new match, then quit, exercises old pending callbacks
        await start(page);await quit(page);
        await purchase(page,'lands',40);await backFromPack(page);
        const state=await sample();report.cycles.push(state);
        await page.screenshot({path:path.join(OUT,`cleanup-${cycle}.png`)});
        assert.equal(state.audio.liveSources,0,'no sounding/scheduled effect sources after cleanup');
        assert.equal(state.audio.connected,3,'only the permanent audio bus remains');
        assert.ok(state.frameMs.p95<250,JSON.stringify(state.frameMs));
    }
    const first=report.cycles[0],last=report.cycles.at(-1);
    assert.ok(last.heapBytes<first.heapBytes*1.25+2_000_000,JSON.stringify(report.cycles));
    assert.ok(last.nodes<first.nodes*1.1+100,'post-GC DOM nodes plateau');
    assert.ok(last.jsEventListeners<first.jsEventListeners*1.1+50,'native listeners plateau');
    assert.ok(last.dom<=first.dom+50,'live DOM plateau');
    for(const key of ['timeouts','intervals','frames'])assert.ok(last[key]<=first[key]+1,`${key}: ${first[key]} → ${last[key]}`);
    assert.deepEqual(errors,[]);report.status='PASS';
} catch(error){report.error=error.stack;await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});}
finally{await context.close();await browser.close();await new Promise(r=>server.close(r));report.completed=new Date().toISOString();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
