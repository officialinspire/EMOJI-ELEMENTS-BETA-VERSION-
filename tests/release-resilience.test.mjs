import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/harness.mjs';
import {useGameBrowser,openGamePage} from './lib/game.mjs';
import {boot,click,start,ready} from './lib/release-ui.mjs';
useGameBrowser();
test('real startup and a UI turn survive absent device APIs and failed media/fonts', {timeout:60000}, async t=>{
    const {page,close}=await openGamePage({initScript:()=>{
        Object.defineProperty(window,'AudioContext',{value:undefined,configurable:true});
        Object.defineProperty(window,'webkitAudioContext',{value:undefined,configurable:true});
        Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});
    },contextOptions:{reducedMotion:'reduce'}});t.after(close);
    let failed=0;
    await page.route(/fonts\.(googleapis|gstatic)\.com|\.(mp3|mp4)(\?|$)/,route=>{failed++;return route.abort('failed');});
    await page.reload();await boot(page);
    assert.ok(failed>0,'actually fail requested media or fonts');
    assert.equal(await page.evaluate(()=>GameFeedback.play('victory')),false);
    await click(page,'#soundChip');
    assert.equal(await page.locator('#menuHapticsSwitch').isDisabled(),true);
    await page.keyboard.press('Escape');
    await start(page);await click(page,'#endTurnBtn');
    // Deterministic gameplay clock remains installed across the reload; advance the actual AI schedule.
    await page.clock.runFor(15000);await ready(page);
    assert.equal(await page.evaluate(()=>gameState.matchFinalized),false);
    await page.setViewportSize({width:370,height:180});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await click(page,'.menu-icon-btn');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('#pauseModal').contains(document.activeElement)),true);
    const out=path.join(ROOT,'test-results/resilience');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'missing-apis-media-fonts-zoom.png')});
});
