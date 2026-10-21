#!/usr/bin/env node
// Screenshots of the Pack Shop and pack opening at desktop, phone and phone-landscape size: the shop (short of
// credits, so affordability shows), "What's inside" for the Robot pack, the sealed pack, a revealed card and
// the five-card summary. Runs axe-core (if installed, or AXE_CORE_PATH=…/axe.min.js) on the shop, the
// contents dialog and the summary. Checks live in tests/packs.test.mjs.
//
//   node tests/pack-shots.mjs [--label=current]     → test-results/packs/<label>/

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const label = (process.argv.find(a => a.startsWith('--label=')) || '--label=current').split('=')[1];
const OUT = path.join(ROOT, 'test-results', 'packs', label);
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
for (const [name, options] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['phone', { ...devices['Galaxy S8'] }], ['landscape', { ...devices['Pixel 7 landscape'] }]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(400);
    // Test setup in memory only (never saved): 50 credits, so the 60-credit packs show as unaffordable
    await page.evaluate(() => {
        document.getElementById('clickToStart').style.display = 'none';
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
        gameMeta.wallet.credits = 50;
        showPackShop();
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}-shop.png`) });
    const shopAxe = await seriousAxe(page);

    await page.evaluate(() => showPackContents('robot'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}-contents.png`) });
    const contentsAxe = await seriousAxe(page);

    await page.evaluate(() => {
        hidePackContents();
        gameMeta.wallet.credits = 500;
        updatePackShopCreditsBadge();
        purchasePack('robot');
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}-sealed.png`) });
    await page.click('#packOpenBtn');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, `${name}-reveal.png`) });
    await page.click('#packSummaryBtn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}-summary.png`) });
    const summaryAxe = await seriousAxe(page);

    const problems = [...errors, ...shopAxe.map(v => `axe (shop): ${v}`), ...contentsAxe.map(v => `axe (contents): ${v}`), ...summaryAxe.map(v => `axe (summary): ${v}`)];
    console.log(`${name}: ${problems.length ? `❌ ${problems.join(' | ')}` : '✅ no page errors or serious axe violations'}`);
    failures += problems.length;
    await context.close();
}
await browser.close();
server.close();
console.log(`Screenshots → ${path.relative(ROOT, OUT)}/`);
process.exit(failures ? 1 : 0);
