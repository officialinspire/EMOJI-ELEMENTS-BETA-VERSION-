#!/usr/bin/env node
// Main menu and battle setup audit for EMOJI ELEMENTS at desktop, narrow phone, short landscape and tablet sizes.
//
//   node tests/menu-audit.mjs                       # all profiles (npm run menu)
//   node tests/menu-audit.mjs --profile=phone
//   node tests/menu-audit.mjs --label=before --report-only
//
// It drives the real menus (mouse, touch or keyboard) on a fresh profile, saves a screenshot of each screen,
// and checks:
//   layout     no horizontal overflow; menu controls at least 44 px; text at least 11 px; NEW GAME on screen
//              without scrolling
//   hierarchy  NEW GAME is the first and clearly largest menu entry
//   labels     every entry has a readable label and a line of supporting text
//   info       the menu shows current credits and collection progress from the saved profile
//   setup      element buttons show element names; selection has a non-colour marker; the difficulty
//              explanation matches AI_PROFILES; a summary of the selected saved deck (counts from the deck
//              itself) is shown before START
//   saved      the last deck you started is selected again on NEW GAME, also after a reload
//   routing    every entry opens its screen and BACK returns to the menu
//   keyboard   Tab reaches NEW GAME first; Enter/Space work; Esc returns from every menu screen; focus returns
//              to the entry that opened the screen; focus is visible
//   a11y       axe-core: no violations on any menu screen (contrast included)
//   audio      menu music starts after the first tap
// Screenshots and menu-audit.json go to test-results/menu/<label>/ (gitignored). Exit 1 if a check fails.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const LABEL = args.label || 'current';
const OUT = path.join(ROOT, 'test-results', 'menu', LABEL);
const { chromium, devices } = loadPlaywright();

const PROFILES = {
    desktop: { touch: false, options: { viewport: { width: 1366, height: 768 } } },
    phone: { touch: true, options: { ...devices['Galaxy S8'] } },                     // 360×740
    landscape: { touch: true, options: { ...devices['Pixel 7 landscape'] } },         // 863×360
    tablet: { touch: true, options: { ...devices['Galaxy Tab S4'] } }                 // 712×1138
};

const ENTRIES = [
    { label: 'New Game', screen: 'elementSelectionScreen' },
    { label: 'Deck Builder', screen: 'deckBuilderScreen' },
    { label: 'Collection', screen: 'binderScreen' },
    { label: 'Pack Shop', screen: 'packShopScreen' },
    { label: 'How to Play', screen: 'howToPlayScreen' },
    { label: 'Stats', screen: 'statsScreen' }
];
const ELEMENT_NAMES = { fire: 'Fire', water: 'Water', earth: 'Earth', swamp: 'Swamp', light: 'Light' };
// What each difficulty must say, from AI_PROFILES in index.js (AI.md §3)
const DIFFICULTY_TEXT = {
    easy: [/1 card a turn/i, /never casts instants/i],
    medium: [/2 cards a turn/i, /instants/i, /lethal/i],
    hard: [/as many cards as its mana allows/i, /blockers/i]
};

function loadAxe() {
    const require = createRequire(import.meta.url);
    for (const candidate of [process.env.AXE_CORE_PATH, 'axe-core/axe.min.js']) {
        if (!candidate) continue;
        try { return fs.readFileSync(require.resolve(candidate), 'utf8'); } catch (_) { /* next */ }
    }
    return null;
}
const AXE_SOURCE = loadAxe();

const results = [];
function check(profile, area, label, ok, detail = '') {
    results.push({ profile, area, label, ok: !!ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} [${area}] ${label}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}

function seededInit() {
    let state = 20261021;
    Math.random = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function press(page, touch, target) {
    const locator = typeof target === 'string' ? page.locator(target).first() : target;
    await locator.scrollIntoViewIfNeeded();
    if (touch) await locator.tap(); else await locator.click();
    await page.waitForTimeout(150);
}

const entry = (page, label) => page.locator('#mainMenu button', { hasText: label }).first();

async function boot(page, touch, url) {
    await page.goto(url);
    await press(page, touch, '#clickToStart');
    await page.waitForFunction(() =>
        document.getElementById('introContainer').style.display === 'flex' ||
        document.getElementById('startModal').classList.contains('modal-visible'));
    if (await page.evaluate(() => document.getElementById('introContainer').style.display === 'flex')) {
        await page.locator('#introContainer').click({ position: { x: 15, y: 15 } });
    }
    await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'), null, { timeout: 20000 });
    await page.waitForTimeout(700);
}

const shown = (page, id) => page.evaluate(id => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
}, id);

// Layout of the visible menu screen: overflow, small controls, small text, and the visible text itself.
function measure(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const visible = el => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const name = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        const modal = document.querySelector('#startModal .modal-content');
        const controls = [...modal.querySelectorAll('button, select, a[href]')].filter(visible);
        const small = controls.map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.height < 44 || r.width < 44)
            .map(({ el, r }) => `"${name(el)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        const tiny = [];
        const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const el = walker.currentNode.parentElement;
            if (!walker.currentNode.textContent.trim() || !visible(el)) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 11) tiny.push(`"${name(el)}" ${size}px`);
        }
        const clipped = controls.filter(el => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'hidden').map(name);
        return {
            overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw,
            modalOverflowX: modal.scrollWidth - modal.clientWidth,
            small, tiny: [...new Set(tiny)], clipped
        };
    });
}

async function runAxe(page) {
    if (!AXE_SOURCE) return null;
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
    return page.evaluate(async () => {
        const result = await window.axe.run(document.getElementById('startModal'), {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations']
        });
        return result.violations.map(v => ({ id: v.id, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(' ') }));
    });
}

async function scene(ctx, name) {
    const { page, profile } = ctx;
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector('#startModal .modal-content').scrollTop = 0; document.getElementById('startModal').scrollTop = 0; });
    await page.screenshot({ path: path.join(OUT, profile, `${name}.png`) });
    if (ctx.fullPage) {
        // The whole scrolling panel, so long screens are reviewable in one image
        await page.locator('#startModal .modal-content').screenshot({ path: path.join(OUT, profile, `${name}-panel.png`) }).catch(() => {});
    }
    const m = await measure(page);
    check(profile, 'layout', `${name}: no horizontal overflow`, m.overflowX <= 1 && m.modalOverflowX <= 1, `page +${m.overflowX}px, panel +${m.modalOverflowX}px`);
    check(profile, 'layout', `${name}: controls at least 44 px`, m.small.length === 0, m.small.slice(0, 6).join('; '));
    check(profile, 'layout', `${name}: text at least 11 px`, m.tiny.length === 0, m.tiny.slice(0, 6).join('; '));
    if (m.clipped.length) check(profile, 'layout', `${name}: no clipped labels`, false, m.clipped.join('; '));
    const axe = await runAxe(page);
    if (axe) check(profile, 'a11y', `${name}: no axe violations`, axe.length === 0, axe.map(v => `${v.id}×${v.nodes} (${v.target})`).join(', '));
    return m;
}

const savedDeckSummary = (page, key) => page.evaluate(key => {
    const deck = gameMeta.decks[key];
    const counts = { land: 0, creature: 0, instant: 0, artifact: 0 };
    deck.cardIds.forEach(id => { counts[__CARD_BY_ID[id].type] += 1; });
    const costs = deck.cardIds.map(id => __CARD_BY_ID[id]).filter(c => c.type !== 'land')
        .map(c => Object.values(c.cost || {}).reduce((sum, n) => sum + n, 0));
    return { size: deck.cardIds.length, counts, average: (costs.reduce((sum, n) => sum + n, 0) / costs.length).toFixed(1) };
}, key);

async function setupChecks(ctx, { mode, elements, difficulty }) {
    const { page, profile, touch } = ctx;
    const deckKey = elements.map(e => e.toUpperCase()).join('_');
    await press(page, touch, `.deck-mode-btn[data-deck-mode="${mode}"]`);
    for (const element of elements) await press(page, touch, `.element-btn[data-element="${element}"]`);
    await press(page, touch, `.difficulty-btn[data-difficulty="${difficulty}"]`);
    const state = await page.evaluate(() => {
        const screen = document.getElementById('elementSelectionScreen');
        const pick = sel => [...screen.querySelectorAll(sel)];
        const selected = pick('.element-btn[aria-pressed="true"]').map(b => b.dataset.element);
        const one = pick('.element-btn[aria-pressed="true"]')[0];
        const other = pick('.element-btn[aria-pressed="false"]')[0];
        const cs = el => el && getComputedStyle(el);
        const marker = el => {
            if (!el) return '';
            const after = getComputedStyle(el, '::after').content;
            const before = getComputedStyle(el, '::before').content;
            return [el.innerText, after, before].join(' ');
        };
        return {
            selected,
            visualDiff: !!one && !!other && (cs(one).borderColor !== cs(other).borderColor || cs(one).boxShadow !== cs(other).boxShadow || cs(one).backgroundImage !== cs(other).backgroundImage),
            selectedMarker: marker(one),
            unselectedMarker: marker(other),
            startEnabled: !document.getElementById('startBtn').disabled,
            text: screen.innerText
        };
    });
    check(profile, 'setup', `${deckKey}: selection is announced (aria-pressed) and styled`, JSON.stringify(state.selected.sort()) === JSON.stringify([...elements].sort()) && state.visualDiff, JSON.stringify(state.selected));
    check(profile, 'setup', `${deckKey}: selected elements carry a non-colour marker (✓)`, /✓/.test(state.selectedMarker) && !/✓/.test(state.unselectedMarker), state.selectedMarker.trim().slice(0, 40));
    check(profile, 'setup', `${deckKey}: START is enabled once the deck is complete`, state.startEnabled);
    const expected = DIFFICULTY_TEXT[difficulty];
    const others = Object.entries(DIFFICULTY_TEXT).filter(([key]) => key !== difficulty).map(([, res]) => res[0]);
    check(profile, 'setup', `${difficulty}: explanation matches the AI profile (and only this level)`,
        expected.every(re => re.test(state.text)) && !others.some(re => re.test(state.text)),
        [...expected.filter(re => !re.test(state.text)), ...others.filter(re => re.test(state.text)).map(re => `also ${re}`)].join(' '));
    const deck = await savedDeckSummary(page, deckKey);
    const summary = await page.evaluate(() => document.getElementById('deckSummary')?.innerText || '');
    const count = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
    const wanted = [count(deck.size, 'card'), count(deck.counts.land, 'land'), count(deck.counts.creature, 'creature'),
        count(deck.counts.instant, 'instant'), count(deck.counts.artifact, 'artifact'), `cards: ${deck.average}`];
    const names = elements.map(e => ELEMENT_NAMES[e]);
    check(profile, 'setup', `${deckKey}: deck summary names the deck and matches the saved deck`,
        names.every(n => summary.includes(n)) && wanted.every(w => new RegExp(`(?<![\\d.])${w.replace(/[.]/g, '\\.')}`, 'i').test(summary)),
        `${JSON.stringify(summary.slice(0, 160))} wanted ${wanted.join(', ')}`);
}

async function auditProfile(browser, url, profile) {
    const { touch, options } = PROFILES[profile];
    console.log(`\n[${profile}] ${options.viewport.width}×${options.viewport.height}${touch ? ' touch' : ' mouse+keyboard'}`);
    fs.mkdirSync(path.join(OUT, profile), { recursive: true });
    const context = await browser.newContext({ ...options });
    await context.addInitScript(seededInit);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const ctx = { page, profile, touch, fullPage: true };

    await boot(page, touch, url);
    const music = await page.evaluate(() => !audioSystem.startMenuMusic.paused);
    check(profile, 'audio', 'menu music starts after the first tap', music);

    // ---- main menu
    await scene(ctx, '01-menu');
    const menu = await page.evaluate(() => {
        const vh = window.innerHeight;
        const buttons = [...document.querySelectorAll('#mainMenu button')];
        const rect = b => b.getBoundingClientRect();
        const unique = Object.entries(gameMeta.collection).filter(([id, n]) => __CARD_BY_ID[id] && n > 0).length;
        return {
            first: (buttons[0]?.innerText || '').trim(),
            lines: buttons.map(b => b.innerText.split('\n').map(s => s.trim()).filter(Boolean)),
            areas: buttons.map(b => rect(b).width * rect(b).height),
            newGameOnScreen: buttons[0] && rect(buttons[0]).bottom <= vh && rect(buttons[0]).top >= 0,
            menuText: document.querySelector('#startModal .modal-content').innerText,
            credits: Math.floor(gameMeta.wallet.credits),
            unique,
            total: Object.keys(__CARD_BY_ID).length
        };
    });
    const others = menu.areas.slice(1).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)] || 1;
    check(profile, 'hierarchy', 'NEW GAME is the first menu entry', /^[^a-z]*new game/i.test(menu.first), menu.first);
    check(profile, 'hierarchy', 'NEW GAME is clearly the largest entry (≥ 1.5× the others)', menu.areas[0] >= 1.5 * median, `${Math.round(menu.areas[0])} vs median ${Math.round(median)} px²`);
    check(profile, 'layout', 'NEW GAME is on screen without scrolling', menu.newGameOnScreen);
    check(profile, 'labels', 'menu entries are New Game, Deck Builder, Collection, Pack Shop, How to Play, Stats',
        ENTRIES.every((e, i) => (menu.lines[i]?.join(' ') || '').toLowerCase().includes(e.label.toLowerCase())), menu.lines.map(l => l[0]).join(' | '));
    check(profile, 'labels', 'every entry has a line of supporting text', menu.lines.every(l => l.length >= 2), menu.lines.filter(l => l.length < 2).map(l => l[0]).join(', '));
    check(profile, 'info', `menu shows current credits (${menu.credits})`, new RegExp(`\\b${menu.credits}\\b[^\\n]*credits|credits[^\\n]*\\b${menu.credits}\\b`, 'i').test(menu.menuText));
    check(profile, 'info', `menu shows collection progress (${menu.unique} / ${menu.total})`, new RegExp(`\\b${menu.unique}\\s*/\\s*${menu.total}\\b`).test(menu.menuText));

    // ---- routing: each entry opens its screen and BACK returns
    for (const { label, screen } of ENTRIES) {
        await press(page, touch, entry(page, label));
        const opened = await shown(page, screen);
        if (label !== 'New Game') await scene(ctx, `03-${screen}`);
        await press(page, touch, page.locator(`#${screen} button`, { hasText: 'BACK' }).last());
        check(profile, 'routing', `${label}: opens and BACK returns to the menu`, opened && await shown(page, 'mainMenu'), `opened=${opened}`);
    }

    // ---- battle setup
    await press(page, touch, entry(page, 'New Game'));
    await scene(ctx, '02-setup-empty');
    const names = await page.evaluate(() => [...document.querySelectorAll('.element-btn')].map(b => [b.dataset.element, b.innerText]));
    check(profile, 'setup', 'element buttons show element names', names.every(([key, text]) => text.toLowerCase().includes(ELEMENT_NAMES[key].toLowerCase())), names.map(n => n[1].replace(/\s+/g, ' ')).join(' | '));
    await setupChecks(ctx, { mode: 'dual', elements: ['fire', 'water'], difficulty: 'medium' });
    await scene(ctx, '02-setup-dual');
    if (profile !== 'phone') {
        // Wide and short screens lay setup out in columns, so START is reachable without scrolling
        const startOnScreen = await page.evaluate(() => {
            const r = document.getElementById('startBtn').getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
        });
        check(profile, 'layout', 'START BATTLE is on screen without scrolling', startOnScreen);
    }
    await setupChecks(ctx, { mode: 'single', elements: ['light'], difficulty: 'hard' });
    await scene(ctx, '02-setup-single');
    await setupChecks(ctx, { mode: 'dual', elements: ['earth', 'swamp'], difficulty: 'easy' });

    // ---- saved selection: start EARTH_SWAMP, quit, NEW GAME selects it again (and after a reload)
    await press(page, touch, '#startBtn');
    await page.waitForFunction(() => document.getElementById('gameContainer').style.display === 'flex');
    await page.waitForTimeout(600);
    await page.evaluate(() => { pauseGame(); confirmQuit(); });
    await page.waitForTimeout(200);
    await press(page, touch, '#gameConfirmYesBtn');
    await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'));
    const savedSelection = async () => {
        await press(page, touch, entry(page, 'New Game'));
        return page.evaluate(() => ({
            mode: document.querySelector('.deck-mode-btn[aria-pressed="true"]')?.dataset.deckMode,
            selected: [...document.querySelectorAll('.element-btn[aria-pressed="true"]')].map(b => b.dataset.element),
            start: !document.getElementById('startBtn').disabled,
            stored: gameMeta.selectedDeckKey
        }));
    };
    const again = await savedSelection();
    check(profile, 'saved', 'NEW GAME selects the last deck you started', again.mode === 'dual' && again.selected.join() === 'earth,swamp' && again.start, JSON.stringify(again));
    await page.reload();
    await boot(page, touch, url);
    const reloaded = await savedSelection();
    check(profile, 'saved', '…also after a reload (gameMeta.selectedDeckKey)', reloaded.stored === 'EARTH_SWAMP' && reloaded.selected.join() === 'earth,swamp', JSON.stringify(reloaded));
    await press(page, touch, page.locator('#elementSelectionScreen button', { hasText: 'BACK' }).last());

    // ---- keyboard (desktop)
    if (!touch) {
        // Start keyboard navigation from the title, as a player who clicked the page would
        await page.locator('#startModal .modal-title').click();
        let first = '';
        for (let i = 0; i < 12 && !first; i++) {
            await page.keyboard.press('Tab');
            first = await page.evaluate(() => document.activeElement?.closest('#mainMenu') ? document.activeElement.innerText.trim() : '');
        }
        check(profile, 'keyboard', 'Tab reaches NEW GAME first among the menu entries', /^[^a-z]*new game/i.test(first), first);
        await page.waitForTimeout(400); // .menu-btn transitions all properties, the outline included
        const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
        check(profile, 'keyboard', 'focused entry shows a visible focus outline', ring);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        check(profile, 'keyboard', 'Enter on NEW GAME opens battle setup', await shown(page, 'elementSelectionScreen'));
        await page.locator('.deck-mode-btn[data-deck-mode="single"]').focus();
        await page.keyboard.press('Space');
        await page.locator('.element-btn[data-element="water"]').focus();
        await page.keyboard.press('Space');
        const kb = await page.evaluate(() => document.querySelector('.element-btn[data-element="water"]').getAttribute('aria-pressed'));
        check(profile, 'keyboard', 'Space selects an element', kb === 'true', kb);
        for (const { label, screen } of ENTRIES) {
            if (label !== 'New Game') await page.evaluate(id => ({
                deckBuilderScreen: showDeckBuilder, binderScreen: showBinder, packShopScreen: showPackShop,
                howToPlayScreen: showHowToPlay, statsScreen: showStats
            })[id](), screen);
            else if (!(await shown(page, screen))) await page.evaluate(() => showElementSelection());
            await page.keyboard.press('Escape');
            await page.waitForTimeout(150);
            const focus = await page.evaluate(() => (document.activeElement?.innerText || document.activeElement?.tagName || '').replace(/\s+/g, ' ').trim());
            check(profile, 'keyboard', `Esc returns from ${label} to the menu, focus on its entry`, await shown(page, 'mainMenu') && focus.toLowerCase().includes(label.toLowerCase()), `focus: ${focus}`);
        }
    }

    check(profile, 'errors', 'no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
try {
    const only = args.profile ? [args.profile] : Object.keys(PROFILES);
    for (const profile of only) await auditProfile(browser, url, profile);
} finally {
    await browser.close();
    server.close();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'menu-audit.json'), JSON.stringify({ label: LABEL, results }, null, 2));
const failed = results.filter(r => !r.ok);
const byArea = {};
results.forEach(r => { byArea[r.area] = byArea[r.area] || [0, 0]; byArea[r.area][r.ok ? 0 : 1] += 1; });
console.log('\nBy area (pass/fail):', Object.entries(byArea).map(([a, [p, f]]) => `${a} ${p}/${f}`).join(' · '));
console.log(`Summary: ${results.length - failed.length} passed · ${failed.length} failed → ${path.relative(ROOT, OUT)}/`);
if (failed.length && !args['report-only']) process.exit(1);
