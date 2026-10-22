#!/usr/bin/env node
// Strict by default, including launch failures. A phone viewport is emulation, never a device pass.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';
import { boot, click, themes, start, ready, quit, purchase, backFromPack } from './lib/release-ui.mjs';
const selected = process.argv.find(a => a.startsWith('--engine='))?.split('=')[1];
if (selected && !['chromium','firefox','webkit'].includes(selected)) throw Error('Unknown engine');
const OUT = path.join(ROOT, 'test-results/cross-browser');
fs.mkdirSync(OUT, { recursive: true });
const playwright = loadPlaywright();
const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/`;
const report = { commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), started: new Date().toISOString(), results: [] };
const save = fs.readFileSync(path.join(ROOT,'tests/fixtures/saves/existing.json'),'utf8');
for (const engine of selected ? [selected] : ['chromium','firefox','webkit']) {
    let browser;
    // Linux WebKit's legacy playbin2 deadlocks pausing looping MP3s on this host.
    // Select the native playbin3 pipeline; media and Web Audio remain enabled.
    const mediaPipeline = engine === 'webkit' && process.platform === 'linux' ? 'playbin3' : 'native';
    try { browser = await playwright[engine].launch({ timeout: 15000, ...(mediaPipeline === 'playbin3' ? { env: { ...process.env, WEBKIT_GST_USE_PLAYBIN3: '1' } } : {}) }); }
    catch (error) { report.results.push({ engine, status: 'BLOCKED', error: error.message }); console.error(`${engine}: BLOCKED: ${error.message}`); continue; }
    for (const [profile, viewport] of [['desktop',{width:1366,height:900}],['phone',{width:360,height:740}]]) {
        const row = { engine, profile, version: browser.version(), mediaPipeline, status: 'FAIL', checks: [], screenshots: [] };
        report.results.push(row);
        const context = await browser.newContext({ viewport, hasTouch: profile === 'phone', reducedMotion: 'reduce' });
        await context.addInitScript(save => { if (!sessionStorage.seeded) { localStorage.setItem('emoji_elements_meta_v1',save); sessionStorage.seeded='1'; } }, save);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const shot = async name => { const file = `${engine}-${profile}-${name}.png`; await page.screenshot({path:path.join(OUT,file)}); row.screenshots.push(file); };
        try {
            await page.goto(url); await boot(page); row.checks.push('startup');
            await themes(page, shot); row.checks.push('all themes, reduced motion, Escape focus return');
            await click(page, '#mainMenu [data-menu-target="binderScreen"]');
            assert.equal(await page.locator('#binderList .binder-row').count(),268);
            await click(page, '#binderList .binder-row');
            assert.equal(await page.locator('#cardDetailPopup').isVisible(),true);
            await shot('inspect'); await click(page,'#cardDetailPopup .close-detail');
            await click(page,'#binderScreen .menu-back'); row.checks.push('collection, trusted card inspection');
            await click(page,'#mainMenu [data-menu-target="achievementsScreen"]');
            assert.equal(await page.locator('#achievementsMenuView .ach-item').count(),150);
            await shot('achievements'); await click(page,'#achievementsScreen .menu-back'); row.checks.push('150 achievement entries');
            await start(page); row.checks.push('battle setup');
            await click(page,'.menu-icon-btn');
            await click(page,'#pauseSfxSwitch'); await click(page,'#pauseSfxSwitch');
            await page.locator('#pauseModal .menu-btn').filter({hasText:'RESUME'}).click();
            await click(page,'#endTurnBtn'); await ready(page); row.checks.push('pause/settings, natural AI turn');
            // Explicit combat fixture: position only; attack selection and confirmation use real controls.
            await page.evaluate(() => {
                gameState.playerBoard = [{...__CARD_BY_ID['creatures-fire-lion'],id:900001,tapped:false,summoningSick:false,damage:0}];
                gameState.enemyBoard=[]; gameState.enemyLife=20; updateUI({immediate:true});
            });
            const before = await page.evaluate(() => gameState.enemyLife);
            await click(page,'#attackBtn'); await click(page,'#playerBoard .card.type-creature'); await click(page,'#attackBtn');
            await page.waitForFunction(before => gameState.enemyLife < before, before);
            await shot('combat'); await ready(page); await quit(page); row.checks.push('fixture combat via UI, quit');
            if (profile === 'phone') await page.setViewportSize({width:740,height:360});
            await purchase(page); await shot('pack-summary-landscape');
            if (profile === 'phone') {
                // Layout zoom shrinks the CSS viewport; CSS root zoom does not change dvh.
                await page.setViewportSize({width:240,height:493});
                await shot('pack-summary-zoom');
                const rect = await page.locator('#packCloseBtn').boundingBox(); assert.ok(rect.y>=0 && rect.y+rect.height<=493);
            }
            await backFromPack(page);
            const persisted = await page.evaluate(() => ({meta:localStorage.getItem(META_STORAGE_KEY), achievements:localStorage.getItem('emoji_elements_achievements_v1'), theme:document.documentElement.dataset.theme}));
            await page.reload(); await boot(page);
            assert.deepEqual(await page.evaluate(() => ({meta:localStorage.getItem(META_STORAGE_KEY), achievements:localStorage.getItem('emoji_elements_achievements_v1'), theme:document.documentElement.dataset.theme})),persisted);
            assert.deepEqual(errors,[]); row.checks.push('purchase, reveal, summary, rotation/zoom, save reload'); row.status='PASS';
        } catch (error) { row.error=error.stack; await shot('failure').catch(()=>{}); }
        finally { await context.close(); }
        console.log(`${engine}/${profile}: ${row.status} ${row.error || row.checks.join('; ')}`);
    }
    await browser.close();
}
await new Promise(resolve=>server.close(resolve));
report.completed=new Date().toISOString();
fs.writeFileSync(path.join(OUT,selected ? `${selected}.json` : 'results.json'),JSON.stringify(report,null,2)+'\n');
process.exitCode=report.results.every(r=>r.status==='PASS') ? 0 : 1;
