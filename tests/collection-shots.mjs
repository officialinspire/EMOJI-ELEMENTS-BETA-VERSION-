#!/usr/bin/env node
// Screenshots of the Collection (Binder) and Deck Builder in their interesting states, at desktop and phone size:
// a filtered Binder, a deck edit that breaks the land cap (issues with fix actions, blocked Add reasons, the
// unsaved marker) and the unsaved-changes question. Checks live in tests/collection.test.mjs.
//
//   node tests/collection-shots.mjs [--label=current]     → test-results/collection/<label>/

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const label = (process.argv.find(a => a.startsWith('--label=')) || '--label=current').split('=')[1];
const OUT = path.join(ROOT, 'test-results', 'collection', label);
fs.mkdirSync(OUT, { recursive: true });
const { chromium, devices } = loadPlaywright();
const server = await startServer();
const browser = await chromium.launch();
const url = `http://127.0.0.1:${server.address().port}/`;
const setFilter = (page, scope, name, value) => page.evaluate(({ scope, name, value }) => {
    const el = document.querySelector(`#${scope} [data-filter="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'INPUT' ? 'input' : 'change'));
}, { scope, name, value });

let failures = 0;
for (const [name, options] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['phone', { ...devices['Galaxy S8'] }]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        document.getElementById('clickToStart').style.display = 'none';
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
        showBinder();
        document.querySelector('#binderFilters details').open = true;
    });
    await setFilter(page, 'binderFilters', 'element', 'fire');
    await setFilter(page, 'binderFilters', 'sort', 'rarity');
    await page.waitForTimeout(300);
    await page.locator('#startModal .modal-content').screenshot({ path: path.join(OUT, `${name}-binder.png`) });

    // Test setup in memory only (never saved): spare Fire lands, then a swap that breaks the 20-land cap
    await page.evaluate(() => {
        backToMenu();
        gameMeta.collection['lands-volcanic-peak'] = 25;
        showDeckBuilder();
        document.querySelector('#deckBuilderFilters details').open = true;
        const creature = deckBuilderState.workingCardIds.find(id => id.startsWith('creatures-'));
        document.querySelector(`#deckBuilderDeck .deck-builder-row[data-card-id="${creature}"] button`).click();
        deckBuilderState.workingCardIds.push('lands-volcanic-peak');
        renderDeckBuilder();
    });
    await setFilter(page, 'deckBuilderFilters', 'owned', 'all');
    await setFilter(page, 'deckBuilderFilters', 'type', 'creature');
    await setFilter(page, 'deckBuilderFilters', 'sort', 'rarity');
    await page.waitForTimeout(300);
    await page.locator('#startModal .modal-content').screenshot({ path: path.join(OUT, `${name}-deckbuilder.png`) });
    await page.evaluate(() => backToMenu());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}-unsaved-confirm.png`) });
    console.log(`${name}: ${errors.length ? `❌ ${errors.join(' | ')}` : '✅ no page errors'}`);
    failures += errors.length;
    await context.close();
}
await browser.close();
server.close();
console.log(`Screenshots → ${path.relative(ROOT, OUT)}/`);
process.exit(failures ? 1 : 0);
