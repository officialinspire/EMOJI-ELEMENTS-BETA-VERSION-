#!/usr/bin/env node
// Interaction and layout audit for EMOJI ELEMENTS on phone, tablet and desktop sizes.
//
//   node tests/ui-audit.mjs                       # all profiles, screenshots + checks (npm run ui)
//   node tests/ui-audit.mjs --profile=android-portrait
//   node tests/ui-audit.mjs --label=before        # screenshot folder name (default: current)
//   node tests/ui-audit.mjs --report-only         # never exit 1 (used to record a baseline)
//
// For each profile it walks the real flows (menus, element/deck selection, hand and battlefield, card
// inspection, tapping lands, attacking, blocking feedback, graveyards, modals, pack ripping/swiping,
// pause/resume, match results, Deck Builder, Binder), saves a screenshot of each, and checks:
//   layout   no horizontal overflow; essential controls on screen, unobscured and not clipped
//   touch    touch targets at least 44 px (24 px hard minimum); no double activation; long-press inspects
//            without playing; gestures don't scroll the page
//   keyboard Esc closes the top dialog; focus stays inside open dialogs; shortcuts don't hijack focused
//            buttons; cards can be played and inspected from the keyboard
//   a11y     axe-core (if installed) on each screen: names, roles, contrast; icon buttons have labels
//   motion   prefers-reduced-motion stops decorative animation
//   audio    with the mobile autoplay policy, nothing plays before the first tap and nothing errors
// Screenshots and ui-audit.json go to test-results/ui/<label>/ (gitignored). Exit 1 if a check fails.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const LABEL = args.label || 'current';
const OUT = path.join(ROOT, 'test-results', 'ui', LABEL);
const { chromium, devices } = loadPlaywright();

const PROFILES = {
    'android-portrait': { touch: true, options: { ...devices['Galaxy S8'] } },               // 360×740
    'phone-landscape': { touch: true, options: { ...devices['Pixel 7 landscape'] } },        // 863×360
    tablet: { touch: true, options: { ...devices['Galaxy Tab S4'] } },                        // 712×1138
    desktop: { touch: false, options: { viewport: { width: 1366, height: 768 } } }
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

// ------------------------------------------------------------------ results

const results = [];
function check(profile, area, label, ok, detail = '') {
    results.push({ profile, area, label, ok: !!ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} [${area}] ${label}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}
const notes = [];
function note(profile, text) {
    notes.push({ profile, text });
    console.log(`  ℹ️  ${text}`);
}

// ------------------------------------------------------------------ page helpers

function seededInit() {
    let state = 20261020;
    Math.random = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function tapOrClick(page, touch, target, options = {}) {
    const locator = typeof target === 'string' ? page.locator(target).first() : target;
    await locator.scrollIntoViewIfNeeded();
    return touch ? locator.tap(options) : locator.click(options);
}

async function cdpTouch(page, points) {
    const cdp = await page.context().newCDPSession(page);
    try {
        for (const step of points) {
            if (step.wait) { await page.waitForTimeout(step.wait); continue; }
            await cdp.send('Input.dispatchTouchEvent', step);
        }
    } finally {
        await cdp.detach();
    }
}

async function longPress(page, touch, locator, ms = 650) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (touch) {
        await cdpTouch(page, [
            { type: 'touchStart', touchPoints: [{ x, y }] },
            { wait: ms },
            { type: 'touchEnd', touchPoints: [] }
        ]);
    } else {
        await page.mouse.click(x, y, { button: 'right' });
    }
    await page.waitForTimeout(250);
}

async function swipe(page, touch, from, to, steps = 10) {
    if (touch) {
        const moves = [];
        for (let i = 1; i <= steps; i++) {
            moves.push({ type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
        }
        await cdpTouch(page, [{ type: 'touchStart', touchPoints: [from] }, ...moves, { type: 'touchEnd', touchPoints: [] }]);
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps });
        await page.mouse.up();
    }
    await page.waitForTimeout(250);
}

async function boot(page, touch, url) {
    await page.goto(url);
    await tapOrClick(page, touch, '#clickToStart');
    await page.waitForFunction(() =>
        document.getElementById('introContainer').style.display === 'flex' ||
        document.getElementById('startModal').classList.contains('modal-visible'));
    if (await page.evaluate(() => document.getElementById('introContainer').style.display === 'flex')) {
        await tapOrClick(page, touch, '#introContainer', { position: { x: 15, y: 15 } });
    }
    await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

const waitForPlayerTurn = page => page.waitForFunction(() =>
    gameState.matchFinalized || (gameState.turn === 'player' && gameState.phase === 'main' && !isProcessingAction), null, { timeout: 30000 });

async function startMatch(page, touch) {
    await tapOrClick(page, touch, page.locator('#mainMenu button', { hasText: 'NEW GAME' }));
    await tapOrClick(page, touch, '.deck-mode-btn[data-deck-mode="dual"]');
    await tapOrClick(page, touch, '.element-btn[data-element="fire"]');
    await tapOrClick(page, touch, '.element-btn[data-element="water"]');
    await tapOrClick(page, touch, '#startBtn');
    await page.waitForFunction(() => document.getElementById('gameContainer').style.display === 'flex');
    await waitForPlayerTurn(page);
    await page.waitForTimeout(300);
}

// A busy, readable board: stacked lands, keyworded creatures, artifacts, a full hand and graveyards.
function richBoard(page) {
    return page.evaluate(() => {
        const make = (id, extra = {}) => {
            const base = window.__CARD_BY_ID[id];
            const card = { ...base, id: Math.random(), ...extra };
            if (card.type !== 'instant') card.tapped = card.tapped ?? false;
            if (card.type === 'creature') { card.summoningSick = false; card.damage = 0; }
            return card;
        };
        gameState.playerHand = ['lands-volcanic-peak', 'lands-mystic-springs', 'creatures-fire-lion', 'spells-fireball', 'spells-growth',
            'artifacts-mana-gem', 'creatures-werewolf', 'creatures-crystal-swan'].map(id => make(id));
        gameState.playerBoard = [
            ...Array(3).fill('lands-volcanic-peak').map(id => make(id)),
            ...Array(2).fill('lands-mystic-springs').map(id => make(id)),
            make('creatures-fire-lobster'), make('creatures-crystal-swan'), make('creatures-death-scorpion'),
            make('creatures-great-shark'), make('artifacts-holy-chalice')
        ];
        gameState.enemyBoard = [
            ...Array(3).fill('lands-ancient-grove').map(id => make(id)),
            make('creatures-giant-squid'), make('creatures-ancient-turtle'), make('creatures-ember-beetle'),
            make('artifacts-cursed-orb')
        ];
        gameState.playerGraveyard = ['spells-fireball', 'creatures-fire-ram'].map(id => make(id));
        gameState.enemyGraveyard = ['spells-curse'].map(id => make(id));
        gameState.landsPlayedThisTurn = 0;
        gameState.playerMana = {};
        updateUI({ immediate: true });
    });
}

// ------------------------------------------------------------------ measurements (run in the page)

function measure(page, { essentials = [], scrollable = false }) {
    return page.evaluate(({ essentials, scrollable }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const visible = el => {
            if (!el || !el.isConnected) return false;
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const describe = el => {
            const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
            return `${el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase()}${text ? ` "${text}"` : ''}`;
        };
        const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;

        // Essential controls: present, inside the viewport, and the topmost element at their centre.
        const problems = [];
        for (const selector of essentials) {
            const els = [...document.querySelectorAll(selector)].filter(visible);
            if (!els.length) { problems.push(`${selector}: not shown`); continue; }
            const el = els[0];
            if (scrollable) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            const r = el.getBoundingClientRect();
            if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
                problems.push(`${selector}: off screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`);
                continue;
            }
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) problems.push(`${selector}: covered by ${describe(hit)}`);
        }

        // Interactive elements: size (touch targets) and accessible names.
        // Only controls a finger can actually reach: on screen and not covered by an overlay.
        const reachable = el => {
            const r = el.getBoundingClientRect();
            if (!(r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw)) return false;
            const x = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
            const y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
            const hit = document.elementFromPoint(x, y);
            return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
        };
        const interactive = [...document.querySelectorAll('button, select, input, a[href], [onclick], [role="button"], #playerHand .card, #playerBoard .card, .land-stack-card, .close-detail')]
            .filter(visible)
            .filter(reachable);
        const small = interactive.map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width < 44 || r.height < 44)
            .map(({ el, r }) => ({ name: describe(el), w: Math.round(r.width), h: Math.round(r.height) }));
        const unnamed = interactive.filter(el => ['BUTTON', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'button')
            .filter(el => {
                const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
                return !/[a-z0-9]/i.test(name) || (el.tagName === 'SELECT' && !el.labels?.length && !el.getAttribute('aria-label'));
            })
            .map(describe);

        // Legibility: the smallest visible text.
        const fonts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent.trim()) continue;
            const el = node.parentElement;
            if (!visible(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
            fonts.push({ size: parseFloat(getComputedStyle(el).fontSize), name: describe(el) });
        }
        fonts.sort((a, b) => a.size - b.size);

        // Card faces whose content spills outside the card (clipped stats/badges).
        const clippedCards = [...document.querySelectorAll('.card')].filter(visible).filter(card => {
            const cr = card.getBoundingClientRect();
            return [...card.querySelectorAll('.card-power, .card-cost, .card-abilities, .land-count')].some(part => {
                if (!visible(part)) return false;
                const pr = part.getBoundingClientRect();
                return pr.left < cr.left - 2 || pr.right > cr.right + 2 || pr.top < cr.top - 2 || pr.bottom > cr.bottom + 2;
            });
        }).map(describe);

        return {
            overflowX, problems, small, unnamed,
            minFont: fonts[0] || null,
            tinyText: fonts.filter(f => f.size < 10).map(f => `${f.name} ${f.size}px`).slice(0, 8),
            clippedCards,
            pageScroll: { x: window.scrollX, y: window.scrollY, scrollHeight: document.documentElement.scrollHeight, vh }
        };
    }, { essentials, scrollable });
}

async function runAxe(page) {
    if (!AXE_SOURCE) return null;
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
    return page.evaluate(async () => {
        const result = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations']
        });
        return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    });
}

// ------------------------------------------------------------------ scenes

async function scene(ctx, name, { essentials = [], scrollable = false, touchTargets = true } = {}) {
    const { page, profile, touch, shots } = ctx;
    await page.waitForTimeout(350);
    const file = path.join(OUT, profile, `${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    const m = await measure(page, { essentials, scrollable });
    ctx.scenes[name] = m;
    check(profile, 'layout', `${name}: no horizontal overflow`, m.overflowX <= 1, `${m.overflowX}px wider than the screen`);
    check(profile, 'layout', `${name}: essential controls on screen and unobscured`, m.problems.length === 0, m.problems.join('; '));
    if (m.clippedCards.length) check(profile, 'layout', `${name}: card stats/badges inside the card`, false, m.clippedCards.slice(0, 5).join('; '));
    if (touch && touchTargets) {
        const severe = m.small.filter(s => s.w < 24 || s.h < 24);
        check(profile, 'touch', `${name}: no touch target under 24 px`, severe.length === 0, severe.slice(0, 6).map(s => `${s.name} ${s.w}×${s.h}`).join('; '));
        if (m.small.length > severe.length) note(profile, `${name}: ${m.small.length - severe.length} target(s) between 24 and 44 px: ${m.small.filter(s => s.w >= 24 && s.h >= 24).slice(0, 4).map(s => `${s.name} ${s.w}×${s.h}`).join('; ')}`);
    }
    check(profile, 'a11y', `${name}: interactive controls have accessible names`, m.unnamed.length === 0, m.unnamed.slice(0, 6).join('; '));
    check(profile, 'layout', `${name}: text at least 10 px`, m.tinyText.length === 0, m.tinyText.join('; '));
    const axe = await runAxe(page);
    if (axe) {
        ctx.axe[name] = axe;
        const serious = axe.filter(v => ['serious', 'critical'].includes(v.impact) && v.id !== 'color-contrast');
        check(profile, 'a11y', `${name}: no serious axe violations (contrast reported separately)`, serious.length === 0, serious.map(v => `${v.id}×${v.nodes}`).join(', '));
        const contrast = axe.find(v => v.id === 'color-contrast');
        if (contrast) note(profile, `${name}: axe color-contrast on ${contrast.nodes} node(s)`);
    }
    return m;
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
    page.on('dialog', d => d.accept());
    const ctx = { page, profile, touch, shots: [], scenes: {}, axe: {} };

    // Audio autoplay: before the first tap nothing may play; after it, music may start.
    await page.goto(url);
    await page.waitForTimeout(500);
    const preAudio = await page.evaluate(() => [...document.querySelectorAll('audio, video')].filter(m => !m.paused).length +
        Object.values(typeof audioSystem === 'object' ? audioSystem : {}).filter(a => a && a.paused === false).length);
    check(profile, 'audio', 'nothing plays before the first tap', preAudio === 0, `${preAudio} element(s) playing`);
    await scene(ctx, '00-click-to-start', { essentials: ['#clickToStart'] });
    await page.goto('about:blank');

    await boot(page, touch, url);
    await scene(ctx, '01-menu', { essentials: ['#mainMenu button'], scrollable: true });

    await tapOrClick(page, touch, page.locator('#mainMenu button', { hasText: 'NEW GAME' }));
    await tapOrClick(page, touch, '.element-btn[data-element="fire"]');
    await scene(ctx, '02-new-game', { essentials: ['.deck-mode-btn', '.difficulty-btn', '.element-btn', '#startBtn'], scrollable: true });
    await page.evaluate(() => backToMenu());

    await startMatch(page, touch);
    await richBoard(page);
    await scene(ctx, '03-match', { essentials: ['#endTurnBtn', '#attackBtn', '#graveyardBtn', '#mulliganBtn', '.menu-icon-btn', '#muteBtn', '#playerLife', '#enemyLife', '#playerHand .card', '#playerBoard .card', '#enemyBoard .card'] });
    const match = ctx.scenes['03-match'];
    check(profile, 'layout', '03-match: the page itself does not scroll', match.pageScroll.scrollHeight <= match.pageScroll.vh + 1, `page is ${match.pageScroll.scrollHeight}px tall in a ${match.pageScroll.vh}px viewport`);

    // Card inspection: long-press (touch) or right-click (mouse) on a board creature.
    const swan = page.locator('#playerBoard .card').filter({ hasText: '🦢' }).first();
    await swan.scrollIntoViewIfNeeded();
    await longPress(page, touch, swan);
    const detailShown = await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show'));
    check(profile, 'touch', `${touch ? 'long-press' : 'right-click'} on a battlefield card opens its details`, detailShown);
    await scene(ctx, '04-card-detail', { essentials: ['#cardDetailPopup .close-detail', '#detailName'] });
    if (!touch) {
        await page.keyboard.press('Escape');
        check(profile, 'keyboard', 'Esc closes card details', !(await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show'))));
    }
    await page.evaluate(() => hideCardDetail());

    // Hand: inspect without playing; a tap plays exactly once.
    const handBefore = await page.evaluate(() => gameState.playerHand.length);
    // A playable card (a land), so a stray play would show.
    const handLand = page.locator('#playerHand .card.land').last();
    await handLand.scrollIntoViewIfNeeded();
    await longPress(page, touch, handLand);
    const afterInspect = await page.evaluate(() => ({ hand: gameState.playerHand.length, detail: document.getElementById('cardDetailPopup').classList.contains('show') }));
    check(profile, 'touch', `${touch ? 'long-press' : 'right-click'} on a playable hand card shows details and does not play it`, afterInspect.detail && afterInspect.hand === handBefore, JSON.stringify(afterInspect));
    await page.evaluate(() => hideCardDetail());

    const landsBefore = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'land').length);
    await tapOrClick(page, touch, page.locator('#playerHand .card.land').first());
    await page.waitForTimeout(400);
    const landsAfter = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'land').length);
    check(profile, 'touch', `one ${touch ? 'tap' : 'click'} on a hand land plays exactly one land`, landsAfter === landsBefore + 1, `${landsBefore} → ${landsAfter}`);

    // Tapping lands: one tap taps exactly one land in the stack.
    const tappedBefore = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'land' && c.tapped).length);
    await tapOrClick(page, touch, page.locator('#playerBoard .land-stack-card:not(.enemy-land-stack)').first());
    await page.waitForTimeout(300);
    const tappedAfter = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'land' && c.tapped).length);
    check(profile, 'touch', `one ${touch ? 'tap' : 'click'} on a land stack taps exactly one land`, tappedAfter === tappedBefore + 1, `${tappedBefore} → ${tappedAfter}`);
    await scene(ctx, '05-lands-tapped', { essentials: ['#playerMana', '#playerBoard .land-stack-card:not(.enemy-land-stack)'] });

    // Hand scroll gesture: a horizontal swipe across the hand scrolls it, plays nothing, and the page stays put.
    if (touch) {
        const handBox = await page.locator('#playerHand').boundingBox();
        const y = handBox.y + handBox.height / 2;
        const handCount = await page.evaluate(() => gameState.playerHand.length);
        await swipe(page, touch, { x: handBox.x + handBox.width - 20, y }, { x: handBox.x + 20, y }, 12);
        const after = await page.evaluate(() => ({ hand: gameState.playerHand.length, x: window.scrollX, y: window.scrollY }));
        check(profile, 'touch', 'swiping across the hand plays nothing and does not scroll the page', after.hand === handCount && after.x === 0 && after.y === 0, JSON.stringify(after));
        // A vertical drag on the battlefield must not scroll or bounce the page.
        const board = await page.locator('#playerBoard').boundingBox();
        await swipe(page, touch, { x: board.x + 30, y: board.y + 10 }, { x: board.x + 30, y: board.y + board.height + 120 }, 8);
        const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
        check(profile, 'touch', 'dragging on the battlefield does not scroll the page', scroll[0] === 0 && scroll[1] === 0, JSON.stringify(scroll));
    }

    // Ctrl+A (select all) must not start an attack.
    if (!touch) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Control+a');
        check(profile, 'keyboard', 'Ctrl+A does not trigger the A (attack) shortcut', !(await page.evaluate(() => attackPhase)));
        await page.evaluate(() => { if (attackPhase) confirmAttackers(); });
        await page.waitForTimeout(200);
    }

    // Attacking: select two attackers.
    await tapOrClick(page, touch, '#attackBtn');
    await page.waitForTimeout(250);
    for (const emoji of ['🦞', '🦈']) {
        await tapOrClick(page, touch, page.locator('#playerBoard .card').filter({ hasText: emoji }).first());
        await page.waitForTimeout(150);
    }
    const selected = await page.evaluate(() => gameState.attackers.length);
    check(profile, 'touch', `${touch ? 'tapping' : 'clicking'} two creatures selects exactly two attackers`, selected === 2, `${selected} selected`);
    if (touch) {
        const before = await page.evaluate(() => gameState.attackers.length);
        await longPress(page, touch, page.locator('#playerBoard .card').filter({ hasText: '🦢' }).first());
        const after = await page.evaluate(() => ({ attackers: gameState.attackers.length, detail: document.getElementById('cardDetailPopup').classList.contains('show') }));
        check(profile, 'touch', 'long-press during attack selection inspects without selecting', after.detail && after.attackers === before, JSON.stringify(after));
        await page.evaluate(() => hideCardDetail());
    }
    await scene(ctx, '06-attack-select', { essentials: ['#attackBtn', '#playerBoard .card.attacking'] });

    // Confirm: the AI blocks; the result must be readable on screen.
    await tapOrClick(page, touch, '#attackBtn');
    await page.waitForTimeout(500);
    await scene(ctx, '07-combat-result', { essentials: ['#playerLife', '#enemyLife'] });
    const combatText = await page.evaluate(() => [...document.querySelectorAll('.game-log, .combat-report, [aria-live]')]
        .map(el => el.textContent).join(' | '));
    check(profile, 'legibility', 'blocks are reported by name after combat', /block/i.test(combatText) && /(Squid|Turtle|Beetle)/.test(combatText), combatText.slice(0, 160));
    await waitForPlayerTurn(page);

    // Graveyard modal.
    await tapOrClick(page, touch, '#graveyardBtn');
    await page.waitForTimeout(300);
    await scene(ctx, '08-graveyard', { essentials: ['#graveyardModal .graveyard-close', '#playerGraveyardTab', '#enemyGraveyardTab'] });
    if (!touch) {
        const trapped = await focusStaysInside(page, '#graveyardModal');
        check(profile, 'keyboard', 'Tab stays inside the graveyard dialog', trapped.ok, trapped.detail);
        await page.keyboard.press('Escape');
        check(profile, 'keyboard', 'Esc closes the graveyard', !(await page.evaluate(() => document.getElementById('graveyardModal').classList.contains('show'))));
    }
    await page.evaluate(() => hideGraveyard());

    // Keyboard: Space on a focused button activates that button, not END TURN.
    if (!touch) {
        // Reach it the keyboard way (Tab); after a mouse click Space stays END TURN (tests/smoke.mjs).
        await page.focus('#graveyardBtn');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        const s = await page.evaluate(() => ({ turn: gameState.turn, graveyard: document.getElementById('graveyardModal').classList.contains('show') }));
        check(profile, 'keyboard', 'Space on a focused button presses that button (not END TURN)', s.turn === 'player' && s.graveyard, JSON.stringify(s));
        await page.evaluate(() => hideGraveyard());
        await waitForPlayerTurn(page);
        // Cards from the keyboard: focus a hand card, Enter plays it; the context-menu key inspects.
        const focusable = await page.evaluate(() => {
            const card = document.querySelector('#playerHand .card');
            return card ? card.tabIndex >= 0 : false;
        });
        check(profile, 'keyboard', 'hand cards can be reached with Tab', focusable);
        if (focusable) {
            const before = await page.evaluate(() => gameState.playerHand.length);
            await page.evaluate(() => document.querySelector('#playerHand .card').focus());
            await page.keyboard.press('i');
            const shown = await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show'));
            check(profile, 'keyboard', 'I on a focused card shows its details', shown);
            await page.keyboard.press('Escape');
            const after = await page.evaluate(() => gameState.playerHand.length);
            check(profile, 'keyboard', 'inspecting from the keyboard does not play the card', after === before);
        }
        // Focus is visible on buttons.
        await page.focus('#attackBtn');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const outline = await page.evaluate(() => {
            const s = getComputedStyle(document.activeElement);
            return { tag: document.activeElement.id || document.activeElement.className, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow };
        });
        check(profile, 'keyboard', 'keyboard focus is visible on game buttons', outline.outline, JSON.stringify(outline));
    }

    // Pause / resume.
    await tapOrClick(page, touch, '.menu-icon-btn');
    await page.waitForTimeout(300);
    await scene(ctx, '09-pause', { essentials: ['#pauseModal .menu-btn'] });
    if (!touch) {
        const trapped = await focusStaysInside(page, '#pauseModal');
        check(profile, 'keyboard', 'Tab stays inside the pause dialog', trapped.ok, trapped.detail);
        await page.keyboard.press('Escape');
        check(profile, 'keyboard', 'Esc resumes from pause', !(await page.evaluate(() => document.getElementById('pauseModal').classList.contains('show'))));
    }
    await page.evaluate(() => { if (document.getElementById('pauseModal').classList.contains('show')) resumeGame(); });

    // Match result: win → rewards → booster → victory.
    await page.evaluate(() => changeEnemyLife(-99));
    await page.waitForFunction(() => document.getElementById('matchRewardOverlay').classList.contains('show'), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await scene(ctx, '10-rewards', { essentials: ['#matchRewardOverlay .overlay-btn'] });
    await tapOrClick(page, touch, '#matchRewardOverlay .overlay-btn');
    await page.waitForFunction(() => document.getElementById('packOpeningOverlay').classList.contains('show'));
    await page.waitForTimeout(500);
    await scene(ctx, '11-pack-sealed', { essentials: ['#packTearSurface', '#packCloseBtn'] });
    const tear = await page.locator('#packTearSurface').boundingBox();
    await swipe(page, touch, { x: tear.x + 10, y: tear.y + tear.height / 2 }, { x: tear.x + tear.width - 10, y: tear.y + tear.height / 2 + 30 }, 12);
    const ripped = await page.waitForFunction(() => document.getElementById('packRevealStage').classList.contains('pack-stage-active'), null, { timeout: 4000 }).then(() => true, () => false);
    check(profile, 'touch', `${touch ? 'swipe' : 'drag'} rips the pack`, ripped);
    const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
    check(profile, 'touch', 'ripping the pack does not scroll the page', scroll[0] === 0 && scroll[1] === 0, JSON.stringify(scroll));
    await page.waitForTimeout(500);
    if (touch) {
        const vp = await page.locator('#packCardViewport').boundingBox();
        const c = { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 };
        await swipe(page, touch, { x: c.x + 75, y: c.y }, { x: c.x - 75, y: c.y }, 8);
        const counter = await page.textContent('#packCardCounter');
        check(profile, 'touch', 'one swipe shows the next card', /Card 2 of/.test(counter), counter);
    }
    await scene(ctx, '12-pack-reveal', { essentials: ['#packPrevBtn', '#packNextBtn', '#packCloseBtn', '#packCardViewport'] });
    if (!touch) {
        const trapped = await focusStaysInside(page, '#packOpeningOverlay');
        check(profile, 'keyboard', 'Tab stays inside the pack dialog', trapped.ok, trapped.detail);
    }
    await tapOrClick(page, touch, '#packCloseBtn');
    await page.waitForFunction(() => document.getElementById('victoryOverlay').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    await scene(ctx, '13-victory', { essentials: ['#victoryOverlay .overlay-btn'] });
    if (!touch) {
        await page.keyboard.press('Escape');
        const s = await page.evaluate(() => ({
            victory: document.getElementById('victoryOverlay').classList.contains('show'),
            inGame: document.getElementById('gameContainer').style.display === 'flex'
        }));
        check(profile, 'keyboard', 'Esc on the result screen keeps a way out (no stranded board)', s.victory || !s.inGame, JSON.stringify(s));
    }

    // Defeat.
    await page.evaluate(() => { document.getElementById('victoryOverlay').classList.remove('show'); returnToMainMenu(); });
    await page.waitForTimeout(400);
    await startMatch(page, touch);
    await page.evaluate(() => changePlayerLife(-99));
    await page.waitForFunction(() => document.getElementById('loseOverlay').classList.contains('show'), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    await scene(ctx, '14-defeat', { essentials: ['#loseOverlay .overlay-btn'] });
    await page.evaluate(() => { document.getElementById('loseOverlay').classList.remove('show'); returnToMainMenu(); });
    await page.waitForTimeout(400);

    // Menus that hold lists.
    await page.evaluate(() => showDeckBuilder());
    await page.waitForTimeout(400);
    await scene(ctx, '15-deck-builder', { essentials: ['#deckBuilderDeckKey', '#deckBuilderPool', '#deckBuilderDeck'], scrollable: true });
    if (touch) {
        // A finger swipe scrolls a long menu screen (the backdrop blocks touch scrolling, the content must not).
        await page.evaluate(() => { document.querySelector('#startModal .modal-content').scrollTop = 0; });
        const box = await page.locator('#startModal .modal-content').boundingBox();
        const x = box.x + 20;
        await swipe(page, touch, { x, y: box.y + box.height * 0.8 }, { x, y: box.y + box.height * 0.3 }, 10);
        const top = await page.evaluate(() => document.querySelector('#startModal .modal-content').scrollTop);
        check(profile, 'touch', 'a finger swipe scrolls a long menu screen', top > 20, `scrollTop ${top}`);
    }
    await page.evaluate(() => backToMenu());
    await page.evaluate(() => showBinder());
    await page.waitForTimeout(400);
    await scene(ctx, '16-binder', { essentials: ['#binderList'], scrollable: true });

    check(profile, 'errors', 'no page errors', errors.filter(e => !/Failed to load resource|play\(\) request|NotAllowedError|NotSupportedError|media/i.test(e)).length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
    return ctx;
}

// Presses Tab 15 times and reports whether focus ever left the dialog.
async function focusStaysInside(page, selector) {
    const outside = [];
    await page.evaluate(sel => {
        const dialog = document.querySelector(sel);
        const first = dialog.querySelector('button, [tabindex="0"], select');
        (first || dialog).focus();
    }, selector);
    for (let i = 0; i < 15; i++) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(sel => {
            const dialog = document.querySelector(sel);
            const el = document.activeElement;
            return dialog.contains(el) ? null : (el.id || el.className || el.tagName);
        }, selector);
        if (where) outside.push(where);
    }
    return { ok: outside.length === 0, detail: outside.length ? `focus moved to ${[...new Set(outside)].slice(0, 3).join(', ')}` : '' };
}

async function auditReducedMotion(browser, url) {
    console.log('\n[reduced-motion] desktop, prefers-reduced-motion: reduce');
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    await context.addInitScript(seededInit);
    const page = await context.newPage();
    await boot(page, false, url);
    const intro = await page.evaluate(() => ({ played: document.getElementById('introVideo').currentTime > 0 }));
    check('reduced-motion', 'motion', 'the intro animation is skipped with reduced motion', !intro.played, JSON.stringify(intro));
    await startMatch(page, false);
    await richBoard(page);
    await page.evaluate(() => enterAttackPhase());
    await page.evaluate(() => selectAttacker(gameState.playerBoard.find(c => c.name === 'Fire Lobster').id));
    const motion = await page.evaluate(() => {
        const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().duration > 1 &&
            (a.effect.getComputedTiming().iterations === Infinity || a.effect.getComputedTiming().duration > 400));
        createSparkles(200, 200, 5);
        return { long: running.length, names: [...new Set(running.map(a => a.animationName || a.constructor.name))].slice(0, 6) };
    });
    check('reduced-motion', 'motion', 'no looping or long animations with reduced motion', motion.long === 0, `${motion.long} running: ${motion.names.join(', ')}`);
    const shake = await page.evaluate(() => { screenShake('high'); return document.getAnimations().filter(a => /shake/i.test(a.animationName || '')).length; });
    check('reduced-motion', 'motion', 'no screen shake with reduced motion', shake === 0, `${shake} shake animation(s)`);
    await context.close();
}

async function auditAutoplay(url) {
    console.log('\n[autoplay] Chromium with --autoplay-policy=user-gesture-required (as on phones)');
    const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
    const context = await browser.newContext({ ...devices['Galaxy S8'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => Object.values(typeof audioSystem === 'object' ? audioSystem : {}).filter(a => a && a.paused === false).length);
    check('autoplay', 'audio', 'no sound before the first tap', before === 0, `${before} playing`);
    await boot(page, true, url);
    const mute = await page.evaluate(() => { toggleMute(); return [localStorage.getItem('emojiElementsMuted'), document.getElementById('muteBtn')?.getAttribute('aria-pressed')]; });
    check('autoplay', 'audio', 'mute is saved and announced (aria-pressed)', mute[0] === 'true' && mute[1] === 'true', JSON.stringify(mute));
    check('autoplay', 'audio', 'no uncaught errors from blocked audio', errors.length === 0, errors.join(' | '));
    await browser.close();
}

// ------------------------------------------------------------------ main

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch();
    if (!AXE_SOURCE) console.log('axe-core not found (npm install, or AXE_CORE_PATH=…/axe.min.js): skipping axe checks');
    const selected = args.profile ? [args.profile] : Object.keys(PROFILES);
    const contexts = {};
    try {
        for (const profile of selected) contexts[profile] = await auditProfile(browser, url, profile);
        if (!args.profile) {
            await auditReducedMotion(browser, url);
            await auditAutoplay(url);
        }
    } finally {
        await browser.close();
        server.close();
    }
    const failed = results.filter(r => !r.ok);
    const report = {
        label: LABEL, date: new Date().toISOString(), profiles: Object.fromEntries(selected.map(p => [p, PROFILES[p].options.viewport])),
        passed: results.length - failed.length, failed: failed.length, results, notes,
        axe: Object.fromEntries(Object.entries(contexts).map(([p, c]) => [p, c.axe])),
        scenes: Object.fromEntries(Object.entries(contexts).map(([p, c]) => [p, c.scenes]))
    };
    fs.writeFileSync(path.join(OUT, 'ui-audit.json'), JSON.stringify(report, null, 2));
    console.log(`\nSummary: ${report.passed} passed · ${report.failed} failed · screenshots in ${path.relative(ROOT, OUT)}/`);
    process.exit(failed.length && !args['report-only'] ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
