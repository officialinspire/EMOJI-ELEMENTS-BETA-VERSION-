#!/usr/bin/env node
// Screenshots of the gameplay feedback states at desktop, phone and phone-landscape size: attacker selection
// with the combat preview (closed and open), the enemy turn with its AI status, and the match history dialog.
// Runs axe-core (if installed, or AXE_CORE_PATH=…/axe.min.js) on the open preview and on the history dialog.
// Rule and parity checks live in tests/feedback.test.mjs.
//
//   node tests/feedback-shots.mjs [--label=current]     → test-results/feedback/<label>/

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const label = (process.argv.find(a => a.startsWith('--label=')) || '--label=current').split('=')[1];
const OUT = path.join(ROOT, 'test-results', 'feedback', label);
fs.mkdirSync(OUT, { recursive: true });

function loadAxe() {
    const require = createRequire(import.meta.url);
    for (const candidate of [process.env.AXE_CORE_PATH, 'axe-core/axe.min.js']) {
        if (!candidate) continue;
        try { return fs.readFileSync(require.resolve(candidate), 'utf8'); } catch (_) { /* next */ }
    }
    return null;
}
const AXE_SOURCE = loadAxe();
if (!AXE_SOURCE) console.log('axe-core not found: skipping axe checks');

async function seriousAxe(page) {
    if (!AXE_SOURCE) return [];
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
    return page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
        return result.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}×${v.nodes.length}`);
    });
}

const { chromium, devices } = loadPlaywright();
const server = await startServer();
const browser = await chromium.launch();
const url = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
for (const [name, options] of [['desktop', { viewport: { width: 1366, height: 768 } }], ['phone', { ...devices['Galaxy S8'] }], ['landscape', { ...devices['Pixel 7 landscape'] }]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        document.getElementById('clickToStart').style.display = 'none';
        showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); startGame();
    });
    await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 20000 });
    // Test setup in memory only (never saved): a board where some creatures can't attack and some blocks kill
    await page.evaluate(() => {
        const make = (id, extra = {}) => {
            const c = { ...__CARD_BY_ID[id], id: Math.random(), ...extra };
            if (c.type !== 'instant') c.tapped = c.tapped ?? false;
            if (c.type === 'creature') { c.summoningSick = c.summoningSick ?? false; c.damage = 0; }
            return c;
        };
        gameState.playerBoard = [make('lands-volcanic-peak'), make('lands-volcanic-peak'), make('creatures-ancient-dragon'), make('creatures-death-scorpion'),
            make('creatures-fire-lion'), make('creatures-fire-lobster', { summoningSick: true }), make('creatures-crystal-swan', { tapped: true })];
        gameState.enemyBoard = [make('lands-ancient-grove'), make('creatures-ancient-turtle'), make('creatures-giant-squid'), make('creatures-ember-beetle')];
        gameState.playerHand = ['lands-mystic-springs', 'spells-fireball', 'creatures-great-shark'].map(id => make(id));
        gameState.landsPlayedThisTurn = 1;
        gameState.playerMana = { fire: 1 };
        updateUI({ immediate: true });
        enterAttackPhase();
        gameState.playerBoard.filter(c => c.type === 'creature' && canAttack(c)).forEach(c => selectAttacker(c.id));
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}-attack.png`) });
    await page.evaluate(() => { document.querySelector('.combat-preview-details').open = true; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${name}-attack-details.png`) });
    const previewAxe = await seriousAxe(page);

    await page.evaluate(() => { document.querySelector('.combat-preview-details').open = false; confirmAttackers(); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { releaseProcessingLock(); endTurn(); });
    await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(OUT, `${name}-enemy-turn.png`) });
    await page.waitForFunction(() => gameState.turn === 'player' || gameState.matchFinalized, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => showMatchHistory());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}-history.png`) });
    const historyAxe = await seriousAxe(page);

    const problems = [...errors, ...previewAxe.map(v => `axe (preview): ${v}`), ...historyAxe.map(v => `axe (history): ${v}`)];
    console.log(`${name}: ${problems.length ? `❌ ${problems.join(' | ')}` : '✅ no page errors or serious axe violations'}`);
    failures += problems.length;
    await context.close();
}
await browser.close();
server.close();
console.log(`Screenshots → ${path.relative(ROOT, OUT)}/`);
process.exit(failures ? 1 : 0);
