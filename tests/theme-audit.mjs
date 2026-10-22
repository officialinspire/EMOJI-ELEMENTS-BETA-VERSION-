#!/usr/bin/env node
// Visual theme audit for EMOJI ELEMENTS: Arcane Fantasy, Deep Space and Neon Sci-Fi (styles.css "VISUAL THEMES").
//
//   node tests/theme-audit.mjs                          # every theme × desktop, phone, landscape (npm run themes)
//   node tests/theme-audit.mjs --theme=neon --profile=phone
//
// For each theme and screen size it opens the start screen, main menu, theme picker, battle setup, Pack Shop,
// a crowded match, the attack preview, the enemy turn, the pause menu and the victory banner, saves a
// screenshot of each, and checks:
//   contrast   axe-core color-contrast on the visible screen (fails the run; other axe rules too), and the measured
//              contrast of key labels against the pixels behind them, which axe skips on gradients
//   layout     no sideways page overflow; no clipped text; the logo fits inside its panel and the viewport
//   motion     no looping (infinite) animation during a match, on the start screen or in the menu
//   logo       the menu logo is a level-1 heading named "Emoji Elements"
// and, once per run:
//   storage    the theme is saved under its own key, survives a reload and a progress reset, and switching
//              it leaves the saved profile byte-for-byte unchanged; a bad saved value falls back to Arcane
//   keyboard   the theme chip opens the picker on Enter, focus starts on the current theme, arrow keys pick,
//              Esc closes it and focus returns to the chip; from the pause menu Esc closes only the picker
//   reduced    with prefers-reduced-motion nothing animates on the start screen
// Screenshots and theme-audit.json go to test-results/themes/ (gitignored). Exit 1 if a check fails.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const OUT = path.join(ROOT, 'test-results', 'themes');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

const THEMES = ['arcane', 'deep-space', 'neon'].filter(t => !args.theme || t === args.theme);
const PROFILES = Object.entries({
    desktop: { viewport: { width: 1366, height: 900 } },
    phone: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    landscape: { viewport: { width: 740, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
}).filter(([name]) => !args.profile || name === args.profile);
const THEME_KEY = 'emoji_elements_theme';
const META_KEY = 'emoji_elements_meta_v1';

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
function check(scope, area, label, ok, detail = '') {
    results.push({ scope, area, label, ok: !!ok, detail });
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

async function runAxe(page, rootSelector) {
    if (!AXE_SOURCE) return null;
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
    return page.evaluate(async selector => {
        const result = await window.axe.run(document.querySelector(selector), {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations']
        });
        return result.violations.map(v => ({
            id: v.id,
            nodes: v.nodes.length,
            where: v.nodes.slice(0, 3).map(n => `${n.target.join(' ')}${n.any?.[0]?.data?.contrastRatio ? ` (${n.any[0].data.contrastRatio}:1)` : ''}`).join('; ')
        }));
    }, rootSelector);
}

// Sideways overflow, clipped text inside the given root, and where the logos sit
function measure(page, rootSelector) {
    return page.evaluate(selector => {
        const root = document.querySelector(selector) || document.body;
        const visible = el => {
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
        };
        const clipped = [];
        for (const el of root.querySelectorAll('*')) {
            if (!visible(el) || !el.childNodes.length || el.closest('.sr-only')) continue;
            const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
            if (!ownText) continue;
            const s = getComputedStyle(el);
            const hides = ['hidden', 'clip'].includes(s.overflowX) || s.textOverflow === 'ellipsis';
            if (hides && el.scrollWidth > el.clientWidth + 1) clipped.push(`${el.className || el.tagName}: "${el.textContent.trim().slice(0, 30)}"`);
        }
        const logos = [...document.querySelectorAll('.ee-logo')].filter(visible).map(logo => {
            const r = logo.getBoundingClientRect();
            const big = logo.querySelector('.ee-logo-big')?.getBoundingClientRect();
            const panel = logo.parentElement.getBoundingClientRect();
            const inside = big && big.left >= panel.left - 1 && big.right <= panel.right + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
            return { cls: logo.className, inside, width: Math.round(r.width) };
        });
        return { overflowX: document.documentElement.scrollWidth - window.innerWidth, clipped, logos };
    }, rootSelector);
}

// axe skips text drawn over gradients and images (it reports it as "needs review"), and most of this UI is
// gradients. So key labels are also measured: the label's own colour against the pixels behind it, taken from a
// screenshot with the text hidden. The 10th-percentile pixel is used so a small icon in the box doesn't count.
const CONTRAST_PROBES = {
    '01-start': ['.click-to-start-tagline', '.click-to-start-text', '.click-to-start-hint', '#clickToStart .ee-logo-small'],
    '02-menu': ['.theme-chip-text', '.menu-primary .menu-tile-label', '.menu-primary .menu-tile-desc', '.menu-grid .menu-tile-label',
        '.menu-grid .menu-tile-desc', '.menu-status-text', '#startModal .modal-intro > div:last-child', '#startModal .ee-logo-small'],
    '03-picker': ['.theme-dialog-note', '.theme-option-label', '.theme-option-desc'],
    '04-setup': ['#startModal .modal-subtitle', '#startModal .setup-step-title', '#startModal .element-btn-name', '#startModal .deck-summary-line'],
    '05-shop': ['#startModal .modal-subtitle', '#startModal .shop-intro'],
    '06-match': ['#mulliganBtn .btn-text', '.turn-banner-text', '.turn-banner-round', '.phase-indicator', '#endTurnBtn .btn-text', '#graveyardBtn .btn-text', '#attackBtn .btn-text',
        '.player-info .life-counter', '.player-info .deck-counter', '.title .ee-logo-small'],
    '06b-toast': ['#gameLog'],
    '07-attack': ['.combat-preview-summary', '#attackBtn .btn-text', '#endTurnBtn .btn-text'],
    '09-pause': ['#pauseModal .menu-btn', '#pauseModal .pause-title', '.pause-summary', '.pause-section-title', '.pause-row-label',
        '.pause-row-note', '.pause-leave-note'],
    '10-victory': ['#victoryOverlay .overlay-btn']
};

async function measuredContrast(page, selector) {
    const targets = await page.evaluate(selector => {
        if (!document.getElementById('ee-probe-style')) {
            const style = document.createElement('style');
            style.id = 'ee-probe-style';
            style.textContent = '.ee-probe, .ee-probe * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important; }';
            document.head.appendChild(style);
        }
        return [...document.querySelectorAll(selector)]
            .filter(el => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length && el.textContent.trim() && !el.closest(':disabled'))
            // Only what is actually on screen: not scrolled out of its panel or under another layer
            .filter(el => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return !!hit && (el.contains(hit) || hit.contains(el));
            })
            .slice(0, 4)
            .map((el, i) => {
                el.dataset.eeProbe = String(i);
                const s = getComputedStyle(el);
                // The content box, where the text is: a button's own border and rounded corners are not behind it
                const b = el.getBoundingClientRect();
                const px = prop => parseFloat(s[prop]) || 0;
                const left = b.left + px('borderLeftWidth') + px('paddingLeft');
                const top = b.top + px('borderTopWidth') + px('paddingTop');
                const right = b.right - px('borderRightWidth') - px('paddingRight');
                const bottom = b.bottom - px('borderBottomWidth') - px('paddingBottom');
                const r = right - left >= 2 && bottom - top >= 2 ? { left, top, right, bottom } : b;
                const x = Math.max(0, r.left);
                const y = Math.max(0, r.top);
                return { i, text: el.textContent.trim().slice(0, 24), color: s.color, size: parseFloat(s.fontSize), weight: Number(s.fontWeight) || 400,
                    clip: { x, y, width: Math.min(r.right, window.innerWidth) - x, height: Math.min(r.bottom, window.innerHeight) - y } };
            })
            .filter(t => t.clip.width >= 2 && t.clip.height >= 2);
    }, selector);
    const out = [];
    for (const t of targets) {
        await page.evaluate(i => document.querySelector(`[data-ee-probe="${i}"]`).classList.add('ee-probe'), t.i);
        const png = await page.screenshot({ clip: t.clip, animations: 'disabled' });
        await page.evaluate(i => { const el = document.querySelector(`[data-ee-probe="${i}"]`); el.classList.remove('ee-probe'); delete el.dataset.eeProbe; }, t.i);
        out.push(await page.evaluate(async ({ b64, t }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const g = canvas.getContext('2d');
            g.drawImage(img, 0, 0);
            const px = g.getImageData(0, 0, img.width, img.height).data;
            const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
            const lum = (r, g2, b) => 0.2126 * lin(r) + 0.7152 * lin(g2) + 0.0722 * lin(b);
            const [cr, cg, cb, ca = 1] = t.color.match(/[\d.]+/g).map(Number);
            const ratios = [];
            const step = Math.max(1, Math.floor(px.length / 4 / 4000));
            for (let p = 0; p < px.length / 4; p += step) {
                const [br, bg, bb] = [px[p * 4], px[p * 4 + 1], px[p * 4 + 2]];
                const fg = lum(cr * ca + br * (1 - ca), cg * ca + bg * (1 - ca), cb * ca + bb * (1 - ca));
                const back = lum(br, bg, bb);
                ratios.push((Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05));
            }
            ratios.sort((a, b) => a - b);
            const ratio = ratios[Math.floor(ratios.length * 0.1)];
            const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
            return { text: t.text, ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5 };
        }, { b64: png.toString('base64'), t }));
    }
    return out;
}

const loopingAnimations = page => page.evaluate(() => [...new Set(document.getAnimations()
    .filter(a => a.effect?.getTiming().iterations === Infinity && a.playState === 'running')
    .filter(a => { const t = a.effect.target; return t && t.getClientRects().length > 0; })
    .map(a => `${a.animationName || 'animation'} on ${a.effect.target.id ? '#' + a.effect.target.id : String(a.effect.target.className).slice(0, 30)}`))]);

async function screen(ctx, name, rootSelector, { motion = true } = {}) {
    const { page, scope } = ctx;
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${scope}-${name}.png`) });
    const m = await measure(page, rootSelector);
    check(scope, 'layout', `${name}: no sideways overflow`, m.overflowX <= 1, `+${m.overflowX}px`);
    check(scope, 'layout', `${name}: no clipped text`, m.clipped.length === 0, m.clipped.slice(0, 4).join('; '));
    for (const logo of m.logos) check(scope, 'layout', `${name}: logo fits (${logo.cls.split(' ').pop()}, ${logo.width}px)`, logo.inside);
    const axe = await runAxe(page, rootSelector);
    if (axe) {
        const contrast = axe.find(v => v.id === 'color-contrast');
        check(scope, 'contrast', `${name}: text contrast meets WCAG AA`, !contrast, contrast?.where);
        const other = axe.filter(v => v.id !== 'color-contrast');
        check(scope, 'a11y', `${name}: no other axe violations`, other.length === 0, other.map(v => `${v.id}×${v.nodes} ${v.where}`).join(' | '));
        ctx.axe[name] = axe;
    }
    for (const selector of CONTRAST_PROBES[name] || []) {
        for (const m of await measuredContrast(page, selector)) {
            ctx.contrast.push({ screen: name, selector, ...m });
            check(scope, 'contrast', `${name}: ${selector} "${m.text}" ${m.ratio}:1 (needs ${m.need})`, m.ratio >= m.need);
        }
    }
    if (motion) {
        const loops = await loopingAnimations(page);
        check(scope, 'motion', `${name}: nothing loops`, loops.length === 0, loops.join(', '));
    }
}

async function auditTheme(browser, url, theme, profile, options) {
    const scope = `${theme}-${profile}`;
    console.log(`\n[${scope}]`);
    const context = await browser.newContext({ ...options });
    await context.addInitScript(seededInit);
    await context.addInitScript(t => { try { localStorage.setItem('emoji_elements_theme', t); } catch (_) { /* about:blank */ } }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const ctx = { page, scope, axe: {}, contrast: [] };
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    check(scope, 'storage', 'saved theme is applied', await page.evaluate(() => document.documentElement.dataset.theme) === theme);
    await screen(ctx, '01-start', '#clickToStart');

    await page.evaluate(() => {
        document.getElementById('clickToStart').style.display = 'none';
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
        setStartMenuScreen('mainMenu');
        updateMenuStatus();
    });
    await page.evaluate(() => document.fonts.ready);
    await screen(ctx, '02-menu', '#startModal');
    const heading = await page.evaluate(() => {
        const h = document.querySelector('#startModal [role="heading"][aria-level="1"]');
        return h ? h.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    check(scope, 'logo', 'menu logo is a level-1 heading "Emoji Elements"', heading === 'Emoji Elements', String(heading));

    await page.evaluate(() => showThemePicker());
    await screen(ctx, '03-picker', '#themeDialog');
    await page.evaluate(() => hideThemePicker());

    await page.evaluate(() => { showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); });
    await screen(ctx, '04-setup', '#startModal');
    await page.evaluate(() => { backToMenu(); showPackShop(); });
    await screen(ctx, '05-shop', '#startModal');

    await page.evaluate(() => { hidePackShop(); showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); startGame(); });
    await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 20000 });
    await page.evaluate(() => {
        const mk = id => { const c = { ...__CARD_BY_ID[id], id: Math.random() }; c.tapped = false; if (c.type === 'creature') { c.summoningSick = false; c.damage = 0; } return c; };
        gameState.playerBoard = ['lands-volcanic-peak', 'lands-mystic-springs', 'creatures-ancient-dragon', 'creatures-fire-lion', 'creatures-giant-squid', 'artifacts-bomb'].map(mk);
        gameState.enemyBoard = ['lands-ancient-grove', 'creatures-ancient-turtle', 'creatures-ember-beetle'].map(mk);
        gameState.playerHand = ['lands-cursed-bog', 'spells-fireball', 'creatures-great-shark', 'creatures-phantom-train'].map(mk);
        gameState.playerMana = { fire: 3 };
        gameState.landsPlayedThisTurn = 0;
        updateUI({ immediate: true });
        document.getElementById('mulliganBtn').disabled = false; // as on the opening hand, so its colours are checked
    });
    await screen(ctx, '06-match', '#gameContainer');
    // A toast during the match: it sits on the turn banner
    await page.evaluate(() => showGameLog('🔥 You cast Fireball: Ember Beetle destroyed'));
    await screen(ctx, '06b-toast', '#gameContainer');
    await page.evaluate(() => showGameLog('🤖 Enemy summons Great Shark', true));
    await page.waitForTimeout(250);
    for (const m of await measuredContrast(page, '#gameLog')) {
        ctx.contrast.push({ screen: '06b-toast-enemy', selector: '#gameLog', ...m });
        check(scope, 'contrast', `06b-toast: enemy toast "${m.text}" ${m.ratio}:1 (needs ${m.need})`, m.ratio >= m.need);
    }
    await page.evaluate(() => resetGameLog());
    await page.evaluate(() => { enterAttackPhase(); gameState.playerBoard.filter(c => c.type === 'creature').forEach(c => selectAttacker(c.id)); updateUI({ immediate: true }); });
    await screen(ctx, '07-attack', '#gameContainer');
    await page.evaluate(() => { cancelAttack(); releaseProcessingLock(); endTurn(); });
    await page.waitForFunction(() => document.getElementById('gameContainer').classList.contains('enemy-turn'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const enemyLoops = await loopingAnimations(page);
    check(scope, 'motion', '08-enemy-turn: nothing loops', enemyLoops.length === 0, enemyLoops.join(', '));
    await page.screenshot({ path: path.join(OUT, `${scope}-08-enemy-turn.png`) });
    await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 30000 }).catch(() => {});

    await page.evaluate(() => pauseGame());
    await screen(ctx, '09-pause', '#pauseModal');
    await page.evaluate(() => resumeGame());
    await page.evaluate(() => showMatchResultOverlay('win'));
    await page.waitForTimeout(700);
    await screen(ctx, '10-victory', '#victoryOverlay');

    check(scope, 'errors', 'no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
    return { axe: ctx.axe, contrast: ctx.contrast };
}

// Saving, reloading, resetting and the keyboard path through the picker (theme-independent, desktop only)
async function auditBehaviour(browser, url) {
    const scope = 'behaviour';
    console.log(`\n[${scope}]`);
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addInitScript(seededInit);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const openMenu = async () => {
        await page.click('#clickToStart');
        await page.waitForFunction(() =>
            document.getElementById('introContainer').style.display === 'flex' ||
            document.getElementById('startModal').classList.contains('modal-visible'));
        if (await page.evaluate(() => document.getElementById('introContainer').style.display === 'flex')) {
            await page.locator('#introContainer').click({ position: { x: 15, y: 15 } });
        }
        await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'), null, { timeout: 20000 });
        await page.waitForTimeout(600);
    };

    await page.goto(url);
    const fresh = await page.evaluate(k => ({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem(k) }), THEME_KEY);
    check(scope, 'storage', 'a new player gets Arcane Fantasy and nothing is saved yet', fresh.theme === 'arcane' && fresh.saved === null, JSON.stringify(fresh));
    await openMenu();
    check(scope, 'storage', 'the menu chip names the theme', (await page.textContent('#themeChipName')) === 'Arcane Fantasy');
    const metaBefore = await page.evaluate(k => localStorage.getItem(k), META_KEY);

    // Keyboard: chip → picker → arrows → Esc
    await page.focus('#themeChip');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => ({
        open: document.getElementById('themeDialog').classList.contains('show'),
        focus: document.activeElement?.dataset?.uiTheme,
        checked: document.activeElement?.getAttribute('aria-checked')
    }));
    check(scope, 'keyboard', 'Enter on the chip opens the picker with focus on the current theme', opened.open && opened.focus === 'arcane' && opened.checked === 'true', JSON.stringify(opened));
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterArrow = await page.evaluate(k => ({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem(k), focus: document.activeElement?.dataset?.uiTheme }), THEME_KEY);
    check(scope, 'keyboard', 'ArrowDown picks Deep Space and saves it', afterArrow.theme === 'deep-space' && afterArrow.saved === 'deep-space' && afterArrow.focus === 'deep-space', JSON.stringify(afterArrow));
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    check(scope, 'keyboard', 'End picks the last theme (Neon Sci-Fi)', await page.evaluate(() => document.documentElement.dataset.theme) === 'neon');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    check(scope, 'keyboard', 'arrows wrap around (Neon → Arcane)', await page.evaluate(() => document.documentElement.dataset.theme) === 'arcane');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const radios = await page.evaluate(() => [...document.querySelectorAll('#themeOptions [role="radio"]')].map(r => `${r.dataset.uiTheme}:${r.getAttribute('aria-checked')}:${r.tabIndex}`));
    check(scope, 'keyboard', 'one radio is checked and only it is in the Tab order', radios.join(',') === 'arcane:false:-1,deep-space:false:-1,neon:true:0', radios.join(','));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => ({ open: document.getElementById('themeDialog').classList.contains('show'), focus: document.activeElement?.id, menu: document.getElementById('startModal').classList.contains('modal-visible') }));
    check(scope, 'keyboard', 'Esc closes the picker, keeps the menu and returns focus to the chip', !closed.open && closed.focus === 'themeChip' && closed.menu, JSON.stringify(closed));
    check(scope, 'storage', 'the chip shows the new theme', (await page.textContent('#themeChipName')) === 'Neon Sci-Fi');
    const metaAfter = await page.evaluate(k => localStorage.getItem(k), META_KEY);
    check(scope, 'storage', 'switching theme leaves the saved profile byte-for-byte unchanged', metaAfter === metaBefore);

    // Mouse pick
    await page.click('#themeChip');
    await page.waitForTimeout(300);
    await page.click('#themeOptions [data-ui-theme="deep-space"]');
    await page.waitForTimeout(100);
    check(scope, 'storage', 'clicking an option applies and saves it', await page.evaluate(k => localStorage.getItem(k), THEME_KEY) === 'deep-space');
    await page.click('#themeDialog .graveyard-close');
    await page.waitForTimeout(300);

    // Reload: applied before the first paint, from the theme key only
    await page.reload();
    const reloaded = await page.evaluate(() => document.documentElement.dataset.theme);
    check(scope, 'storage', 'the theme survives a reload', reloaded === 'deep-space', reloaded);

    // A progress reset keeps the theme
    await openMenu();
    await page.evaluate(() => { showStats(); resetMetaProgress(); });
    await page.waitForTimeout(300);
    await page.click('#gameConfirmYesBtn');
    await page.waitForTimeout(400);
    const afterReset = await page.evaluate(k => ({ theme: document.documentElement.dataset.theme, saved: localStorage.getItem(k) }), THEME_KEY);
    check(scope, 'storage', 'resetting progress keeps the theme', afterReset.theme === 'deep-space' && afterReset.saved === 'deep-space', JSON.stringify(afterReset));

    // From the pause menu: the picker opens above it and Esc closes only the picker
    await page.evaluate(() => { backToMenu(); showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); startGame(); });
    await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click('#pauseModal .pause-theme-btn');
    await page.waitForTimeout(300);
    const overPause = await page.evaluate(() => {
        const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return { picker: document.getElementById('themeDialog').classList.contains('show'), onTop: !!top?.closest('#themeDialog') };
    });
    check(scope, 'keyboard', 'THEME in the pause menu opens the picker on top', overPause.picker && overPause.onTop, JSON.stringify(overPause));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const pauseState = await page.evaluate(() => ({ picker: document.getElementById('themeDialog').classList.contains('show'), pause: document.getElementById('pauseModal').classList.contains('show') }));
    check(scope, 'keyboard', 'Esc closes the picker and leaves the game paused', !pauseState.picker && pauseState.pause, JSON.stringify(pauseState));
    check(scope, 'errors', 'no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();

    // A saved value that isn't a theme falls back to Arcane
    const bad = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await bad.addInitScript(() => { try { localStorage.setItem('emoji_elements_theme', 'bogus'); } catch (_) { /* about:blank */ } });
    const badPage = await bad.newPage();
    await badPage.goto(url);
    check(scope, 'storage', 'an unknown saved theme falls back to Arcane', await badPage.evaluate(() => document.documentElement.dataset.theme) === 'arcane');
    await bad.close();

    // Reduced motion: the start screen does not animate
    const calm = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
    const calmPage = await calm.newPage();
    await calmPage.goto(url);
    await calmPage.waitForTimeout(300);
    const moving = await calmPage.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName || 'animation'));
    check(scope, 'reduced', 'with reduced motion nothing animates on the start screen', moving.length === 0, moving.join(', '));
    await calm.close();
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
if (!AXE_SOURCE) console.log('axe-core not found (npm install, or AXE_CORE_PATH=…/axe.min.js): skipping contrast checks');
const measured = {};
for (const theme of THEMES) {
    for (const [profile, options] of PROFILES) measured[`${theme}-${profile}`] = await auditTheme(browser, url, theme, profile, options);
}
if (!args.theme && !args.profile) await auditBehaviour(browser, url);
await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(OUT, 'theme-audit.json'), JSON.stringify({ results, measured }, null, 2));
console.log(`\nSummary: ${results.length - failed.length} passed · ${failed.length} failed → test-results/themes/`);
if (failed.length) failed.forEach(f => console.log(`  ❌ [${f.scope}] ${f.label}${f.detail ? ` — ${f.detail}` : ''}`));
process.exit(failed.length ? 1 : 0);
