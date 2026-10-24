#!/usr/bin/env node
// Run from a network that can reach Pages. Only an isolated browser profile is modified.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT,loadPlaywright} from './lib/harness.mjs';
import {boot,click,themes,start,ready,quit,purchase,backFromPack} from './lib/release-ui.mjs';
import {reportFailure} from './lib/ci.mjs';
const target=process.argv.find(a=>a.startsWith('--url='))?.slice(6);
if(!target)throw Error('Usage: node tests/live-pages.mjs --url=https://owner.github.io/repository/');
const base=new URL(target);if(!base.pathname.endsWith('/'))base.pathname+='/';
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const out=path.join(ROOT,'test-results/live-pages');fs.mkdirSync(out,{recursive:true});
const files=['index.html','index.js','styles.css','feedback.js','achievements.js',
    'manifest.json','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'];
const media=['audio/sfx/sfx-bank.wav','minimalist menu theme.mp3','Emoji Elements - Celestial Battle Theme.mp3',
    'Emoji Elements - Winning Battle Theme.mp3','Emoji Elements - Losing Battle Theme.mp3','inspiresoftwareintro.mp4'];
const digest=data=>createHash('sha256').update(data).digest('hex');
const expected=Object.fromEntries(files.map(file=>[file,digest(fs.readFileSync(path.join(ROOT,file)))]));
const report={commit,url:base.href,status:'FAIL',started:new Date().toISOString(),assets:[],screenshots:[],checks:[]};
let browser,context,page;
try{
    // Pages publishes asynchronously after the main push. Retry propagation, never an engine/UI failure.
    for(let attempt=1;attempt<=24;attempt++){
        report.assets=await Promise.all([...files,...media].map(async file=>{
            const url=new URL(file,base);url.searchParams.set('release',commit);
            try{
                const response=await fetch(url,{method:files.includes(file)?'GET':'HEAD',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
                const hash=files.includes(file)?digest(Buffer.from(await response.arrayBuffer())):null;
                return{file,status:response.status,expected:expected[file]||null,actual:hash,ok:response.status===200&&(!expected[file]||hash===expected[file])};
            }catch(error){return{file,ok:false,error:error.message};}
        }));
        report.attempts=attempt;
        if(report.assets.every(a=>a.ok))break;
        console.log(`Pages propagation ${attempt}/24: ${report.assets.filter(a=>!a.ok).map(a=>a.file).join(', ')}`);
        if(attempt<24)await new Promise(resolve=>setTimeout(resolve,10000));
    }
    assert.ok(report.assets.every(a=>a.ok),JSON.stringify(report.assets));
    report.checks.push('deployed HTML, JS and CSS exactly match the tested commit; all media served');
    browser=await loadPlaywright().chromium.launch();report.browser=browser.version();
    context=await browser.newContext({viewport:{width:1366,height:900},reducedMotion:'reduce'});
    page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const shot=async name=>{await page.screenshot({path:path.join(out,`${name}.png`)});report.screenshots.push(`${name}.png`);};
    const live=new URL(base);live.searchParams.set('release',commit);
    await page.goto(live.href,{waitUntil:'domcontentloaded'});await boot(page);
    assert.equal(await page.evaluate(()=>GameFeedback.samplesReady()),true);
    assert.equal(await page.evaluate(()=>GameFeedback.sampleState),'ready');
    report.checks.push('deployed recorded SFX bank fetched and decoded');
    assert.equal(await page.evaluate(()=>QA_MODE),false);await shot('startup');
    await page.evaluate(()=>setGameplaySeed(20261022));
    await themes(page,shot);report.checks.push('real startup, all three themes and keyboard focus return');
    await click(page,'#mainMenu [data-menu-target="achievementsScreen"]');
    assert.equal(await page.locator('#achievementsMenuView .ach-item').count(),400);
    await shot('achievements');await click(page,'#achievementsScreen .menu-back');
    await start(page);
    await page.locator('#playerHand .card').first().click({button:'right'});
    await page.locator('#cardDetailPopup').waitFor({state:'visible'});
    await click(page,'#cardDetailPopup .close-detail');
    await click(page,'#endTurnBtn');await ready(page);await shot('battle');
    await quit(page);report.checks.push('400 achievements, battle setup, card inspection, AI turn and pause/quit');
    await purchase(page);await shot('pack-summary');await backFromPack(page);
    const state=()=>page.evaluate(()=>({credits:gameMeta.wallet.credits,cards:Object.values(gameMeta.collection).reduce((a,b)=>a+b,0),packs:gameMeta.stats.packsOpened}));
    const bought=await state();assert.equal(bought.credits,40);assert.equal(bought.cards,305);assert.equal(bought.packs,1);
    await page.reload({waitUntil:'domcontentloaded'});await boot(page);assert.deepEqual(await state(),bought);
    assert.deepEqual(errors,[]);report.checks.push('one pack purchase, reveal, navigation, summary and save reload');
    report.status='PASS';
}catch(error){report.error=error.stack;reportFailure('Live Pages verification failed',report.error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
    await context?.close();await browser?.close();report.completed=new Date().toISOString();
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n## Live Pages: ${report.status}\n\nCommit: ${commit}\n\n${base.href}\n\n${report.checks.map(c=>`- ${c}`).join('\n')}\n`);
}
console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
