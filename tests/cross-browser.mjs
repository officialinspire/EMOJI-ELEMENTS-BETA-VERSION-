#!/usr/bin/env node
// A short check of the main flows in every browser engine Playwright can launch here: Chromium, Firefox and
// WebKit (Safari's engine). These are desktop browser engines with phone-sized viewports and touch emulation.
// They are not real devices: real iOS Safari and Android Chrome still need hands-on testing (UI.md §6).
//
//   node tests/cross-browser.mjs                 → test-results/cross-browser/<engine>-*.png
//
// An engine that isn't installed is reported as NOT TESTED, never as passed. Install the missing engines with
// `npx playwright install --with-deps firefox webkit`.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const OUT = path.join(ROOT, 'test-results', 'cross-browser');
fs.mkdirSync(OUT, { recursive: true });
const playwright = loadPlaywright();
const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (engine, name, ok, detail = '') => {
    results.push({ engine, name, ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} [${engine}] ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

for (const engine of ['chromium', 'firefox', 'webkit']) {
    let browser;
    try {
        browser = await playwright[engine].launch();
    } catch (error) {
        console.log(`\n[${engine}] NOT TESTED: ${error.message.split('\n')[0]}`);
        results.push({ engine, name: 'launch', ok: null });
        continue;
    }
    console.log(`\n[${engine}] ${browser.version()}`);
    for (const [label, options] of [['desktop', { viewport: { width: 1366, height: 900 } }],
        ['phone', { viewport: { width: 360, height: 740 }, hasTouch: true, ...(engine === 'firefox' ? {} : { isMobile: true }) }]]) {
        const context = await browser.newContext(options);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(url);
        await page.waitForTimeout(600);
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        // Menus
        await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; const m = document.getElementById('startModal'); m.style.display = 'flex'; m.classList.add('modal-visible'); });
        await page.waitForTimeout(300);
        check(engine, `${label}: main menu has 6 entries`, await page.locator('#mainMenu [data-menu-target], #mainMenu .menu-btn').count() >= 6);
        await page.evaluate(() => { showBinder(); });
        await page.waitForTimeout(300);
        check(engine, `${label}: Collection lists all 268 cards`, await page.locator('#binderList .binder-row').count() === 268);
        await page.evaluate(() => { backToMenu(); showPackShop(); });
        await page.waitForTimeout(300);
        check(engine, `${label}: Pack Shop shows 6 packs, no sideways overflow`, await page.locator('#packShopGrid .shop-pack').count() === 6 && (await overflow()) <= 1);
        await page.screenshot({ path: path.join(OUT, `${engine}-${label}-shop.png`) });
        await page.evaluate(() => showPackContents('robot'));
        await page.waitForTimeout(300);
        check(engine, `${label}: What's inside lists the Robot pack`, await page.locator('#packContentsList .pack-contents-row').count() === 16);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        check(engine, `${label}: Esc closes it`, !(await page.evaluate(() => document.getElementById('packContentsModal').classList.contains('show'))));
        // A match: crowded board, attack preview, pack reveal
        await page.evaluate(() => { hidePackShop(); showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); startGame(); });
        await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 20000 }).catch(() => {});
        const preview = await page.evaluate(() => {
            const mk = id => { const c = { ...__CARD_BY_ID[id], id: Math.random() }; c.tapped = false; if (c.type === 'creature') { c.summoningSick = false; c.damage = 0; } return c; };
            gameState.playerBoard = ['creatures-fire-lion', 'creatures-giant-squid', 'creatures-ancient-dragon', 'lands-volcanic-peak'].map(mk);
            gameState.enemyBoard = ['creatures-ember-beetle', 'creatures-ancient-turtle'].map(mk);
            updateUI({ immediate: true });
            enterAttackPhase();
            gameState.playerBoard.filter(c => c.type === 'creature').forEach(c => selectAttacker(c.id));
            updateUI({ immediate: true });
            return { shown: !document.getElementById('combatPreview').hidden, summary: document.querySelector('.combat-preview-summary').textContent };
        });
        await page.waitForTimeout(300);
        check(engine, `${label}: attack preview shows`, preview.shown && /Enemy/.test(preview.summary), preview.summary);
        check(engine, `${label}: match screen has no sideways overflow`, (await overflow()) <= 1);
        await page.screenshot({ path: path.join(OUT, `${engine}-${label}-attack.png`) });
        await page.evaluate(() => { cancelAttack(); gameMeta.lastPack = { themeKey: 'alien', cardIds: ['creatures-grey-alien', 'creatures-ufo-saucer', 'spells-comet-strike', 'creatures-space-marine', 'lands-distant-planet'], openedAt: 'x' }; openPackOpeningOverlayFromMeta('shop'); });
        await page.waitForTimeout(300);
        await page.click('#packOpenBtn');
        await page.waitForTimeout(900);
        check(engine, `${label}: OPEN PACK reveals the first card`, (await page.textContent('#packCardName')) === 'Grey Alien');
        await page.screenshot({ path: path.join(OUT, `${engine}-${label}-reveal.png`) });
        await page.click('#packSummaryBtn');
        await page.waitForTimeout(300);
        check(engine, `${label}: summary lists 5 cards`, await page.locator('#packSummaryGrid .pack-summary-card').count() === 5);
        check(engine, `${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
        await context.close();
    }
    await browser.close();
}
server.close();
const failed = results.filter(r => r.ok === false);
const untested = [...new Set(results.filter(r => r.ok === null).map(r => r.engine))];
console.log(`\nSummary: ${results.filter(r => r.ok).length} passed · ${failed.length} failed${untested.length ? ` · NOT TESTED: ${untested.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
