import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useGameBrowser,openGamePage,startMatch} from './lib/game.mjs';
import {installAudioProbe} from './lib/audio-probe.mjs';
useGameBrowser();

test('one lazy SFX load; real sample voices overlap music and never replay old inputs after loading',async t=>{
    const {page,close}=await openGamePage({initScript:installAudioProbe,contextOptions:{serviceWorkers:'block'}});t.after(close);
    let held,requests=0;
    await page.route('**/audio/sfx/sfx-bank.wav',route=>{requests++;held=route;});
    assert.equal(await page.evaluate(()=>GameFeedback.sampleState),'idle');
    await page.mouse.click(3,3);
    await page.waitForFunction(()=>GameFeedback.sampleState==='loading');
    await page.evaluate(()=>{GameFeedback.unlock();GameFeedback.play('attack');GameFeedback.stopAll();});
    const played=await page.evaluate(()=>GameFeedback.stats().played);
    assert.equal(requests,1,'gesture listeners share one request');
    await held.continue();
    assert.equal(await page.evaluate(()=>GameFeedback.samplesReady()),true);
    assert.deepEqual(await page.evaluate(()=>GameFeedback.stats().played),played,'no queued late sounds');
    await startMatch(page);
    await page.evaluate(()=>GameFeedback.stopAll());
    const before=await page.evaluate(()=>__audioProbe.snapshot());
    await page.clock.runFor(1500);
    const result=await page.evaluate(()=>{
        GameFeedback.play('attack');GameFeedback.play('block');GameFeedback.play('spell');
        return {probe:__audioProbe.snapshot(),sampled:GameFeedback.stats().sampled,musicPaused:audioSystem.gameplayMusic.paused};
    });
    assert.equal(result.musicPaused,false,'effects layer over the battle soundtrack');
    assert.equal(result.probe.bufferSources-before.bufferSources,3,'three actual recorded-buffer voices');
    assert.equal(result.probe.oscillators-before.oscillators,0,'no oscillator beeps on the normal path');
    for(const cue of ['attack','block','spell'])assert.ok(result.sampled[cue]>0,cue);
    await page.evaluate(()=>{GameFeedback.stopAll();GameFeedback.setSetting('sfxOff',true);GameFeedback.setSetting('sfxOff',false);});
    assert.equal(await page.evaluate(()=>__audioProbe.snapshot().liveSources),0,'unmute cannot resurrect old samples');
    assert.equal(requests,1);
});

test('all themes, rare reveals, summon variants and damage intensities render recorded sounds',async t=>{
    const {page,close}=await openGamePage();t.after(close);
    const rows=await page.evaluate(async()=>{
        const out=[];
        for(const theme of ['arcane','deep-space','neon']){
            document.documentElement.dataset.theme=theme;
            for(const [cue,options] of [['summon',{variant:'fantasy'}],['summon',{variant:'scifi'}],['reveal',{rarity:'common'}],['reveal',{rarity:'legendary'}],['damageTaken',{intensity:0}],['damageTaken',{intensity:1}]]){
                const {buffer,engine}=await GameFeedback.renderCue(cue,options);
                const data=buffer.getChannelData(0);let peak=0,energy=0,last=0;
                for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));energy+=data[i]*data[i];if(Math.abs(data[i])>.001)last=i;}
                out.push({theme,cue,options,engine,peak,energy,last});
            }
        }return out;
    });
    for(const row of rows){assert.equal(row.engine,'samples');assert.ok(row.peak<.5&&row.peak>.005,JSON.stringify(row));}
    for(let i=0;i<rows.length;i+=6){
        assert.notEqual(rows[i].energy,rows[i+1].energy,'summon variants differ');
        assert.ok(rows[i+3].last>rows[i+2].last,'legendary reveal has a distinct longer flourish');
        assert.ok(rows[i+5].energy>rows[i+4].energy,'larger hits remain stronger');
    }
    assert.notEqual(rows[0].energy,rows[6].energy,'themes have a subtle distinct sound treatment');
});

test('failed or corrupt sample downloads keep controls and gameplay working without retries on every click',async t=>{
    for(const failure of ['network','decode']){
        const {page,close}=await openGamePage({contextOptions:{serviceWorkers:'block'}});t.after(close);
        let requests=0;
        await page.route('**/audio/sfx/sfx-bank.wav',route=>{requests++;return failure==='network'?route.abort():route.fulfill({status:200,body:'invalid WAV',contentType:'audio/wav'});});
        await page.mouse.click(3,3);
        assert.equal(await page.evaluate(()=>GameFeedback.samplesReady()),false);
        assert.equal(await page.evaluate(()=>GameFeedback.sampleState),'unavailable');
        await page.evaluate(()=>{GameFeedback.unlock();GameFeedback.unlock();});
        assert.equal(requests,1,'bounded retry cooldown');
        assert.equal(await page.evaluate(()=>GameFeedback.play('select')),true,'quiet legacy fallback remains available');
        await startMatch(page);
        assert.equal(await page.evaluate(()=>gameState.matchFinalized),false);
        await page.evaluate(()=>GameFeedback.setSetting('muted',true));
        assert.equal(await page.evaluate(()=>GameFeedback.play('attack')),false);
        assert.equal(await page.evaluate(()=>audioSystem.gameplayMusic.muted),true);
    }
});
