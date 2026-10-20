#!/usr/bin/env node
// Browser smoke tests for EMOJI ELEMENTS (live entry point: index.html + index.js + styles.css).
//
// Usage:
//   node tests/smoke.mjs                      # desktop + mobile projects
//   node tests/smoke.mjs --project=mobile     # one project (desktop | mobile)
//   node tests/smoke.mjs --only=shop,match    # scenarios whose name contains any of these
//   node tests/smoke.mjs --headed --turns=6   # watch it; longer natural-play soak
//   node tests/smoke.mjs --verbose            # also echo the page console
//
// No build step and no app dependencies: the script serves the repo root itself and
// drives Chromium through Playwright. Results:
//   PASS  expected behaviour confirmed
//   FAIL  regression or broken flow (exit code 1)
//   XFAIL known defect still present (see QA_BASELINE.md, ids D1..Dn); does not fail the run
//   XPASS known defect no longer reproduces; update QA_BASELINE.md
// Screenshots and smoke-results.json are written to test-results/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const OUT_DIR = path.join(ROOT, 'test-results');
const META_KEY = 'emoji_elements_meta_v1';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));

const { chromium, devices } = loadPlaywright();

const PROJECTS = {
    desktop: {
        touch: false,
        contextOptions: { viewport: { width: 1280, height: 800 } }
    },
    mobile: {
        touch: true,
        contextOptions: { ...devices['Pixel 7'] }
    }
};

// ---------------------------------------------------------------- result tracking

const results = [];

function record(project, scenario, status, label, detail = '') {
    results.push({ project, scenario, status, label, detail });
    const mark = { PASS: '✅', FAIL: '❌', XFAIL: '🟡', XPASS: '🔵' }[status];
    console.log(`  ${mark} ${status.padEnd(5)} ${label}${detail ? ` — ${detail}` : ''}`);
}

function makeTester(project, scenario) {
    return {
        check(label, ok, detail = '') {
            record(project, scenario, ok ? 'PASS' : 'FAIL', label, ok ? '' : detail);
            return ok;
        },
        // ok === true means the correct behaviour was observed (defect fixed).
        knownDefect(id, label, ok, detail = '') {
            record(project, scenario, ok ? 'XPASS' : 'XFAIL', `[${id}] ${label}`, detail);
        }
    };
}

// ---------------------------------------------------------------- page helpers

function act(page, touch, selector, options = {}) {
    const locator = typeof selector === 'string' ? page.locator(selector).first() : selector;
    return touch ? locator.tap(options) : locator.click(options);
}

async function boot(page, touch, url) {
    await page.goto(url);
    await act(page, touch, '#clickToStart');
    await page.waitForFunction(() =>
        document.getElementById('introContainer').style.display === 'flex' ||
        document.getElementById('startModal').classList.contains('modal-visible'));
    // Skip the intro the way a player does (tap anywhere). Corner tap avoids the credit link.
    if (await page.evaluate(() => document.getElementById('introContainer').style.display === 'flex')) {
        await act(page, touch, '#introContainer', { position: { x: 15, y: 15 } });
    }
    await page.waitForFunction(() => {
        const modal = document.getElementById('startModal');
        return modal.classList.contains('modal-visible') && modal.style.display === 'flex';
    }, null, { timeout: 5000 });
}

const readMeta = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), META_KEY);
const isShown = (page, id) => page.evaluate(elId => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}, id);
const collectionTotal = meta => Object.values(meta?.collection || {}).reduce((sum, n) => sum + n, 0);

async function openMenu(page, touch, label) {
    await act(page, touch, page.locator('#mainMenu button', { hasText: label }).first());
}

async function startMatch(page, touch, { mode = 'single', elements = ['fire'] } = {}) {
    await openMenu(page, touch, 'NEW GAME');
    await act(page, touch, `.deck-mode-btn[data-deck-mode="${mode}"]`);
    for (const element of elements) {
        await act(page, touch, `.element-btn[data-element="${element}"]`);
    }
    await act(page, touch, '#startBtn');
    await page.waitForFunction(() => document.getElementById('gameContainer').style.display === 'flex');
    await waitForPlayerTurn(page);
}

function waitForPlayerTurn(page, timeout = 25000) {
    return page.waitForFunction(() =>
        gameState.matchFinalized ||
        (gameState.turn === 'player' && gameState.phase === 'main' && !isProcessingAction), null, { timeout });
}

// Test setup: swap lands from the library into the hand so land checks never depend on the shuffle
// (a 20-land / 60-card deck opens with no land ~5% of the time). Hand and library sizes are unchanged.
async function ensureLandsInHand(page, wanted = 2) {
    await page.evaluate(count => {
        let lands = gameState.playerHand.filter(card => card.type === 'land').length;
        while (lands < count) {
            const deckIndex = gameState.playerDeck.findIndex(card => card.type === 'land');
            const handIndex = gameState.playerHand.findIndex(card => card.type !== 'land');
            if (deckIndex < 0 || handIndex < 0) break;
            [gameState.playerDeck[deckIndex], gameState.playerHand[handIndex]] = [gameState.playerHand[handIndex], gameState.playerDeck[deckIndex]];
            lands++;
        }
        updateUI({ immediate: true });
    }, wanted);
}

async function touchDrag(page, from, to, steps = 10) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

async function longPress(page, point, ms = 600) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

async function dragAcross(page, touch, selector, direction = 1) {
    const box = await page.locator(selector).boundingBox();
    const y = box.y + box.height / 2;
    const left = { x: box.x + 10, y };
    const right = { x: box.x + box.width - 10, y };
    const [from, to] = direction > 0 ? [left, right] : [right, left];
    if (touch) {
        await touchDrag(page, from, to);
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up();
    }
}

// Rips the sealed pack, then walks every revealed card. Returns the card names seen.
async function openPackInOverlay(page, touch, t) {
    t.check('pack overlay opens', await page.waitForFunction(() =>
        document.getElementById('packOpeningOverlay').classList.contains('show'), null, { timeout: 3000 }).then(() => true, () => false));
    await dragAcross(page, touch, '#packTearSurface');
    const revealed = await page.waitForFunction(() =>
        document.getElementById('packRevealStage').classList.contains('pack-stage-active'), null, { timeout: 3000 }).then(() => true, () => false);
    t.check(`${touch ? 'swipe' : 'drag'} rips pack open`, revealed);
    if (!revealed) return [];

    const names = [await page.textContent('#packCardName')];
    const total = await page.evaluate(() => packOpeningState.cards.length);
    t.check('pack contains 5 cards', total === 5, `got ${total}`);
    if (touch) {
        // A normal ~150px flick should advance exactly one card.
        const box = await page.locator('#packCardViewport').boundingBox();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await touchDrag(page, { x: center.x + 75, y: center.y }, { x: center.x - 75, y: center.y }, 8);
        const counter = await page.textContent('#packCardCounter');
        t.check('one 150px swipe advances exactly one card', counter === `Card 2 of ${total}`, counter);
        names.push(await page.textContent('#packCardName'));
    }
    while (!(await page.locator('#packNextBtn').isDisabled())) {
        await act(page, touch, '#packNextBtn');
        names.push(await page.textContent('#packCardName'));
    }
    const counter = await page.textContent('#packCardCounter');
    t.check('NEXT reaches last card', counter === `Card ${total} of ${total}`, counter);
    await page.waitForTimeout(250);
    t.check('last card is revealed', await page.evaluate(() => packOpeningState.cardRevealed));
    return names;
}

// Card conservation: every non-token card of a side must be in deck, hand, board or graveyard.
function cardConservation(page) {
    return page.evaluate(() => {
        const count = zones => zones.flat().filter(card => card.cardType !== 'Creature Token').length;
        return {
            player: count([gameState.playerDeck, gameState.playerHand, gameState.playerBoard, gameState.playerGraveyard]),
            enemy: count([gameState.enemyDeck, gameState.enemyHand, gameState.enemyBoard, gameState.enemyGraveyard])
        };
    });
}

// ---------------------------------------------------------------- scenarios

const SCENARIOS = [];
const scenario = (name, fn, { projects = ['desktop', 'mobile'] } = {}) => SCENARIOS.push({ name, fn, projects });

scenario('boot-and-menu', async ({ page, touch, t, url, project }) => {
    await boot(page, touch, url);
    t.check('click-to-start → intro → main menu', await isShown(page, 'mainMenu'));
    const meta = await readMeta(page);
    t.check('fresh meta seeded', meta?.version === 1 && meta?.initialized === true);
    t.check('starter credits = 100', meta?.wallet?.credits === 100, `got ${meta?.wallet?.credits}`);
    t.check('15 starter deck keys (5 mono + 10 dual)', Object.keys(meta?.decks || {}).length === 15,
        Object.keys(meta?.decks || {}).join(','));
    t.check('selectedDeckKey defaults to FIRE', meta?.selectedDeckKey === 'FIRE');
    const cardCount = await page.evaluate(() => window.__ALL_CARDS.length);
    t.check('card database loaded (268 cards)', cardCount === 268, `got ${cardCount}`);
    if (project === 'mobile') {
        t.check('mobile UA detected (isMobile)', await page.evaluate(() => isMobile));
    }
    await page.screenshot({ path: path.join(OUT_DIR, `${project}-menu.png`) });
});

scenario('intro-fallback', async ({ page, t, url }) => {
    // Was D11: if the mp4 cannot be decoded (no H.264, e.g. Playwright Chromium / some Linux builds),
    // the 3 s watchdog did not fire because play() stays pending; the menu only appeared at 15 s.
    await page.goto(url);
    const h264 = await page.evaluate(() => document.getElementById('introVideo').canPlayType('video/mp4; codecs="avc1.42E01E"'));
    if (h264) {
        t.check('intro video decodable here; fallback path not exercised', true);
        return;
    }
    await page.click('#clickToStart');
    await page.waitForTimeout(4500);
    t.check('menu appears within ~4 s when intro video cannot play',
        await page.evaluate(() => document.getElementById('startModal').classList.contains('modal-visible')),
        'menu still hidden at 4.5 s (waits for 15 s max-duration timer)');
}, { projects: ['desktop'] });

scenario('menu-navigation', async ({ page, touch, t, url }) => {
    await boot(page, touch, url);
    const nav = await page.evaluate(() => window.__qaNavSmoke());
    t.check('__qaNavSmoke() all checks pass', nav.failed === 0 && nav.total > 0,
        nav.results.filter(r => !r.pass).map(r => r.label).join(', '));

    const screens = [
        ['NEW GAME', 'elementSelectionScreen', '#elementSelectionScreen button:has-text("BACK")'],
        ['DECK BUILDER', 'deckBuilderScreen', '#deckBuilderScreen > button:has-text("BACK TO MENU")'],
        ['PACK SHOP', 'packShopScreen', '#packShopScreen button:has-text("BACK TO MENU")'],
        ['BINDER', 'binderScreen', '#binderScreen button:has-text("BACK TO MENU")'],
        ['HOW TO PLAY', 'howToPlayScreen', '#howToPlayScreen > button:has-text("BACK TO MENU")'],
        ['GAME STATS', 'statsScreen', '#statsScreen button:has-text("BACK TO MENU")']
    ];
    for (const [label, screenId, backSelector] of screens) {
        await openMenu(page, touch, label);
        const opened = await isShown(page, screenId);
        await act(page, touch, backSelector);
        const back = await isShown(page, 'mainMenu');
        t.check(`${label}: opens and BACK returns to menu`, opened && back, `opened=${opened} back=${back}`);
    }

    await openMenu(page, touch, 'HOW TO PLAY');
    await act(page, touch, '.howto-nav-btn:has-text("PAGE 2")');
    t.check('How To Play page 2', (await page.textContent('#howToPlayPageIndicator')) === 'Page 2/2');
    await act(page, touch, '#howToPlayScreen > button:has-text("BACK TO MENU")');

    await openMenu(page, touch, 'BINDER');
    const summary = await page.textContent('#binderSummaryBadge');
    t.check('binder lists starter collection', /\d+ unique cards/.test(summary) && !summary.startsWith('🗂️ 0 '), summary);
});

scenario('deck-builder', async ({ page, touch, t, url }) => {
    await boot(page, touch, url);
    await openMenu(page, touch, 'DECK BUILDER');
    const options = await page.$$eval('#deckBuilderDeckKey option', els => els.map(o => o.value));
    t.check('deck selector lists 15 decks', options.length === 15, options.join(','));
    t.check('FIRE preselected', (await page.inputValue('#deckBuilderDeckKey')) === 'FIRE');
    const status = await page.textContent('#deckBuilderStatus');
    t.check('FIRE starter shows 60/60', status.includes('Deck size: 60/60'), status);

    // Remove one non-land card, re-add the same card: count and Save-button gating.
    const label = await page.evaluate(() => {
        const card = window.__CARD_BY_ID[deckBuilderState.workingCardIds.find(id => window.__CARD_BY_ID[id].type !== 'land')];
        return `${card.emoji} ${card.name}`;
    });
    const rowFor = list => page.locator(`${list} .deck-builder-row`)
        .filter({ has: page.getByText(label, { exact: true }) }).locator('button');
    await act(page, touch, rowFor('#deckBuilderDeck'));
    t.check('removing a card → 59/60', (await page.textContent('#deckBuilderStatus')).includes('59/60'));
    t.check('save disabled when size ≠ 60', await page.locator('#deckBuilderScreen button:has-text("SAVE DECK")').isDisabled());
    await act(page, touch, rowFor('#deckBuilderPool'));
    t.check('re-adding a card → 60/60', (await page.textContent('#deckBuilderStatus')).includes('60/60'));

    // Saving an untouched starter deck must succeed (was D2: basic lands hit the 2-copy limit).
    await act(page, touch, '#deckBuilderScreen button:has-text("RESET TO STARTER")');
    await act(page, touch, '#deckBuilderScreen button:has-text("SAVE DECK")');
    const afterSave = await page.textContent('#deckBuilderStatus');
    t.check('unmodified FIRE starter deck saves', !/exceeds|must contain/i.test(afterSave), afterSave.slice(0, 160));
    const validation = await page.evaluate(() => validateDeckBuild('FIRE', gameMeta.decks.FIRE.starterCardIds, gameMeta));
    t.check('validateDeckBuild accepts FIRE starter list', validation.ok, validation.errors.join(' | '));
    const saved = (await readMeta(page)).decks.FIRE.cardIds.length;
    t.check('saved FIRE deck persisted with 60 cards', saved === 60, `saved ${saved}`);

    // Special lands: Rainbow ("any color") must be offered to a FIRE deck; colorless Crystal Wasteland is not
    // deck-legal (pending design decision), so it must not be offered only to fail on save.
    await page.evaluate(() => {
        gameMeta.collection['lands-rainbow'] = 1;          // test setup, not a player grant
        gameMeta.collection['lands-crystal-wasteland'] = 1;
        initializeDeckBuilder();
    });
    const poolNames = await page.$$eval('#deckBuilderPool .deck-builder-name', els => els.map(el => el.textContent));
    t.check('owned Rainbow is offered for FIRE deck', poolNames.includes('🌈 Rainbow'));
    t.check('colorless Crystal Wasteland is not offered', !poolNames.some(name => name.includes('Crystal Wasteland')));

    await act(page, touch, '#deckBuilderScreen button:has-text("DECK BUILDER GUIDE")');
    t.check('guide overlay opens', await isShown(page, 'deckBuilderGuideOverlay'));
    await act(page, touch, '.guide-close-btn');
    t.check('guide overlay closes', !(await isShown(page, 'deckBuilderGuideOverlay')));
});

scenario('dual-deck-persistence', async ({ page, touch, t, url }) => {
    await boot(page, touch, url);
    const before = await readMeta(page);
    const starterSize = before.decks.FIRE_SWAMP.starterCardIds.length;
    t.check('FIRE_SWAMP starter has 60 cards', starterSize === 60, `got ${starterSize}`);
    await boot(page, touch, url); // reload → validateMeta() runs on the saved meta
    const after = await readMeta(page);
    const shrunk = Object.entries(after.decks)
        .filter(([, deck]) => deck.cardIds.length !== deck.starterCardIds.length)
        .map(([key, deck]) => `${key}:${deck.cardIds.length}`);
    t.check('dual starter decks keep 60 cards after a reload', shrunk.length === 0, shrunk.join(' '));
    // Was D10: FIRE_SWAMP's starter included Web Trap, which no starter grants (PROGRESSION.md P1.2).
    await startMatch(page, touch, { mode: 'dual', elements: ['fire', 'swamp'] });
    const size = await page.evaluate(() => gameState.playerDeck.length + gameState.playerHand.length);
    t.check('FIRE_SWAMP match starts with a 60-card deck', size === 60, `deck+hand=${size}`);
}, { projects: ['desktop'] });

scenario('pack-shop', async ({ page, touch, t, url, project }) => {
    await boot(page, touch, url);
    await openMenu(page, touch, 'PACK SHOP');
    t.check('credits badge shows 100', (await page.textContent('#shopCreditsBadge')).includes('100'));
    const before = await readMeta(page);
    await act(page, touch, '.shop-pack-btn[data-theme="fantasy"]');
    await openPackInOverlay(page, touch, t);
    await page.screenshot({ path: path.join(OUT_DIR, `${project}-pack-reveal.png`) });
    t.check('no QA debug text in player-facing pack overlay',
        !(await isShown(page, 'packQaDebug')), await page.textContent('#packQaDebug'));
    await act(page, touch, '#packCloseBtn');
    t.check('pack overlay closes back to shop', !(await isShown(page, 'packOpeningOverlay')) && await isShown(page, 'packShopScreen'));

    const after = await readMeta(page);
    t.check('fantasy pack costs 60 credits', after.wallet.credits === 40, `credits=${after.wallet.credits}`);
    t.check('collection +5 cards', collectionTotal(after) === collectionTotal(before) + 5,
        `${collectionTotal(before)} → ${collectionTotal(after)}`);
    t.check('lastPack saved', after.lastPack?.themeKey === 'fantasy' && after.lastPack.cardIds.length === 5);
    t.check('credits badge updated', (await page.textContent('#shopCreditsBadge')).includes('40'));

    await act(page, touch, '.shop-pack-btn[data-theme="fantasy"]');
    const message = await page.textContent('#packShopMessage');
    t.check('second fantasy pack blocked (40/60 credits)', /Not enough credits/.test(message) && !(await isShown(page, 'packOpeningOverlay')), message);
    await act(page, touch, '.shop-pack-btn[data-theme="lands"]');
    await openPackInOverlay(page, touch, t);
    await act(page, touch, '#packCloseBtn');
    t.check('lands pack (40) leaves 0 credits', (await readMeta(page)).wallet.credits === 0);
});

scenario('match-turn-cycle', async ({ page, touch, t, url, project }) => {
    await boot(page, touch, url);
    await startMatch(page, touch);
    const state = await page.evaluate(() => ({
        hand: gameState.playerHand.length, enemyHand: gameState.enemyHand.length,
        deck: gameState.playerDeck.length, life: [gameState.playerLife, gameState.enemyLife],
        shownDeck: document.getElementById('playerDeckCount').textContent
    }));
    t.check('opening hands are 7 cards', state.hand === 7 && state.enemyHand === 7, JSON.stringify(state));
    t.check('player library 53 after draw', state.deck === 53 && state.shownDeck === '53', JSON.stringify(state));
    t.check('both players at 20 life', state.life.join('/') === '20/20');
    t.check('selectedDeckKey saved as FIRE', (await readMeta(page)).selectedDeckKey === 'FIRE');
    await page.screenshot({ path: path.join(OUT_DIR, `${project}-match.png`) });

    const endTurnBox = await page.locator('#endTurnBtn').boundingBox();
    const viewport = page.viewportSize();
    t.check('END TURN button fully inside viewport', endTurnBox && endTurnBox.y >= 0 && endTurnBox.x >= 0 &&
        endTurnBox.y + endTurnBox.height <= viewport.height && endTurnBox.x + endTurnBox.width <= viewport.width,
        JSON.stringify(endTurnBox));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t.check('no horizontal overflow in match', overflow <= 1, `overflow=${overflow}px`);

    await ensureLandsInHand(page, 2);
    await act(page, touch, '#playerHand .card.land');
    await page.waitForTimeout(300);
    t.check('playing a land puts it on the board', await page.locator('#playerBoard .land-stack-card').count() === 1);
    await act(page, touch, '#playerHand .card.land');
    await page.waitForTimeout(300);
    const landsOnBoard = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'land').length);
    t.check('second land same turn is refused', landsOnBoard === 1, `lands on board=${landsOnBoard}`);
    await act(page, touch, '#playerBoard .land-stack-card');
    await page.waitForTimeout(200);
    const mana = await page.evaluate(() => gameState.playerMana.fire);
    t.check('tapping land adds 1 fire mana', mana === 1, `mana=${mana}`);

    if (touch) {
        await act(page, touch, '#endTurnBtn');
    } else {
        await page.keyboard.press('Space'); // documented shortcut
    }
    const enemyTurn = await page.waitForFunction(() => gameState.turn === 'enemy', null, { timeout: 3000 }).then(() => true, () => false);
    t.check(`${touch ? 'END TURN' : 'Space'} passes to enemy turn`, enemyTurn);
    await waitForPlayerTurn(page);
    const next = await page.evaluate(() => ({ deck: gameState.playerDeck.length, mana: Object.keys(gameState.playerMana).length, turn: gameState.turn }));
    t.check('AI turn completes and player draws', next.turn === 'player' && next.deck === 52, JSON.stringify(next));
    t.check('mana pool emptied between turns', next.mana === 0);

    if (!touch) {
        await page.keyboard.press('Escape');
        t.check('Esc pauses the game', await page.evaluate(() => document.getElementById('pauseModal').classList.contains('show')));
        await page.click('#pauseModal button:has-text("RESUME")');
        t.check('RESUME closes pause', !(await page.evaluate(() => document.getElementById('pauseModal').classList.contains('show'))));
    }
    await act(page, touch, '#gameContainer .menu-icon-btn');
    await act(page, touch, '#pauseModal button:has-text("MAIN MENU")');
    await act(page, touch, '#gameConfirmYesBtn');
    await page.waitForTimeout(300);
    t.check('pause → MAIN MENU → YES quits to menu', await isShown(page, 'mainMenu') && !(await isShown(page, 'gameContainer')));
});

scenario('match-natural-play', async ({ page, t, url, turns }) => {
    // Plays real turns through the UI with a naive bot; checks invariants after each AI turn.
    await boot(page, false, url);
    await startMatch(page, false, { mode: 'single', elements: ['earth'] });
    let completed = 0;
    for (let turn = 0; turn < turns; turn++) {
        if (await page.evaluate(() => gameState.matchFinalized)) break;
        if (await page.evaluate(() => gameState.landsPlayedThisTurn === 0) && await page.locator('#playerHand .card.land').count()) {
            await page.click('#playerHand .card.land');
            await page.waitForTimeout(250);
        }
        for (let guard = 0; guard < 30; guard++) {
            const stack = page.locator('#playerBoard .land-stack-card:not(.all-tapped)').first();
            if (!(await stack.count())) break;
            await stack.click();
            if (await page.locator('#manaChoiceModal.show .mana-choice-btn').count()) {
                await page.locator('#manaChoiceModal .mana-choice-btn').first().click();
            }
            await page.waitForTimeout(60);
        }
        for (let guard = 0; guard < 8; guard++) {
            await page.waitForTimeout(300);
            const playable = page.locator('#playerHand .card.playable:not(.land)').first();
            if (!(await playable.count())) break;
            await playable.click();
            await page.evaluate(() => hideCardDetail());
        }
        await page.waitForFunction(() => !isProcessingAction);
        const attackers = await page.evaluate(() => gameState.playerBoard
            .filter(c => c.type === 'creature' && !c.tapped && !c.summoningSick && !c.abilities?.includes('defender'))
            .map(c => c.id));
        if (attackers.length && !(await page.evaluate(() => gameState.matchFinalized))) {
            await page.click('#attackBtn');
            for (const id of attackers) await page.click(`[id="card-player-${id}"]`);
            await page.click('#attackBtn');
            await page.waitForFunction(() => !isProcessingAction);
        }
        if (await page.evaluate(() => gameState.matchFinalized)) break;
        await page.click('#endTurnBtn');
        await waitForPlayerTurn(page);
        completed++;
        const counts = await cardConservation(page);
        const lives = await page.evaluate(() => [gameState.playerLife, gameState.enemyLife]);
        if (counts.player !== 60 || counts.enemy !== 60 || !lives.every(Number.isFinite)) {
            t.check(`turn ${turn + 1}: card conservation and finite life`, false, JSON.stringify({ counts, lives }));
        }
    }
    const final = await page.evaluate(() => ({ finalized: gameState.matchFinalized, life: [gameState.playerLife, gameState.enemyLife] }));
    t.check(`${completed} full turn(s) played through the UI without errors`, completed > 0 || final.finalized, JSON.stringify(final));
}, { projects: ['desktop'] });

scenario('win-flow', async ({ page, touch, t, url, project }) => {
    await boot(page, touch, url);
    const before = await readMeta(page);
    await startMatch(page, touch);
    await page.evaluate(() => changeEnemyLife(-gameState.enemyLife)); // test hook: lethal damage
    const reward = await page.waitForFunction(() =>
        document.getElementById('matchRewardOverlay').classList.contains('show'), null, { timeout: 3000 }).then(() => true, () => false);
    t.check('win shows MATCH REWARDS overlay', reward);
    t.check('reward shows +25 credits / 1 pack',
        (await page.textContent('#rewardCreditsAmount')) === '+25' && (await page.textContent('#rewardPackAmount')) === '1');
    const openBooster = page.locator('#matchRewardOverlay button');
    // The overlay fades in (opacity 0.3s); its button is not focusable/hittable until then.
    await page.waitForFunction(() => getComputedStyle(document.getElementById('matchRewardOverlay')).opacity === '1');
    // Real pointer input at the button's centre, exactly as a player would click/tap it.
    const box = await openBooster.boundingBox();
    if (touch) {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => document.getElementById('packOpeningOverlay').classList.contains('show'));
    t.check(`${touch ? 'tapping' : 'clicking'} OPEN BOOSTER opens the pack`, opened,
        'OPEN BOOSTER did not respond (was D1: .overlay-btn pointer-events)');
    if (!opened && touch) {
        await openBooster.dispatchEvent('click'); // D1 workaround: no pointer path exists on touch
    } else if (!opened) {
        await openBooster.focus(); // D1 workaround: keyboard still reaches the button
        await page.keyboard.press('Enter');
    }
    await openPackInOverlay(page, touch, t);
    await act(page, touch, '#packCloseBtn');
    t.check('closing pack shows VICTORY overlay', await page.evaluate(() =>
        document.getElementById('victoryOverlay').classList.contains('show')));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('victoryOverlay')).opacity === '1');
    await page.screenshot({ path: path.join(OUT_DIR, `${project}-victory.png`) });

    const after = await readMeta(page);
    t.check('meta wins = 1', after.stats.wins === 1);
    t.check('credits 100 → 125', after.wallet.credits === 125, `credits=${after.wallet.credits}`);
    t.check('packsOpened = 1', after.stats.packsOpened === 1);
    t.check('win pack added 5 cards to collection', collectionTotal(after) === collectionTotal(before) + 5);
    t.check('legacy emojiElementsStats mirrored', await page.evaluate(() => JSON.parse(localStorage.getItem('emojiElementsStats')).wins === 1));

    await act(page, touch, '#victoryOverlay button:has-text("MAIN MENU")');
    await openMenu(page, touch, 'GAME STATS');
    t.check('stats screen: 1 won / 100%', (await page.textContent('#gamesWon')) === '1' && (await page.textContent('#winRate')) === '100%');

    await boot(page, touch, url);
    await openMenu(page, touch, 'GAME STATS');
    t.check('stats persist across reload', (await page.textContent('#gamesWon')) === '1');
});

scenario('loss-flow', async ({ page, touch, t, url }) => {
    await boot(page, touch, url);
    await startMatch(page, touch);
    await page.evaluate(() => changePlayerLife(-gameState.playerLife)); // test hook: lethal damage
    t.check('loss shows DEFEAT overlay', await page.waitForFunction(() =>
        document.getElementById('loseOverlay').classList.contains('show'), null, { timeout: 3000 }).then(() => true, () => false));
    const meta = await readMeta(page);
    t.check('meta losses = 1, credits 100 → 110', meta.stats.losses === 1 && meta.wallet.credits === 110,
        JSON.stringify({ losses: meta.stats.losses, credits: meta.wallet.credits }));
    t.check('no pack on loss', meta.lastPack === null && meta.stats.packsOpened === 0);
    await act(page, touch, '#loseOverlay button:has-text("TRY AGAIN")');
    t.check('TRY AGAIN opens element selection', await isShown(page, 'elementSelectionScreen'));
});

scenario('corrupt-save-recovery', async ({ page, t, url }) => {
    await boot(page, false, url);
    await page.evaluate(key => localStorage.setItem(key, '{not valid json'), META_KEY);
    await boot(page, false, url);
    const meta = await readMeta(page);
    t.check('corrupt meta JSON → game boots with fresh meta', meta?.wallet?.credits === 100 && Object.keys(meta.decks).length === 15);
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, initialized: true, decks: { FIRE: { cardIds: ['bogus-id'] } }, wallet: { credits: 'NaN' } })), META_KEY);
    await boot(page, false, url);
    await startMatch(page, false);
    const deck = await page.evaluate(() => gameState.playerDeck.length + gameState.playerHand.length);
    t.check('partially corrupt meta → match still starts with a 60-card deck', deck === 60, `deck+hand=${deck}`);
}, { projects: ['desktop'] });

scenario('known-defect-probes', async ({ page, t, url }) => {
    await boot(page, false, url);

    // D3 (AI dealt a "colorless" colour) is fixed and covered by tests/rules.test.mjs.
    await startMatch(page, false);
    // Was D4: untapping a land after its mana was spent gave unlimited mana (RULES.md R4.4).
    const exploit = await page.evaluate(() => {
        const land = { ...window.__CARD_BY_ID['lands-volcanic-peak'], id: 0.4242, tapped: false };
        gameState.playerBoard.push(land);
        tapLand(land.id);                              // +1 fire
        payCost({ fire: 1 }, gameState.playerMana);    // same as casting a 1-cost card
        tapLand(land.id);                              // click again: untaps, nothing to refund
        tapLand(land.id);                              // tap again
        return gameState.playerMana.fire || 0;
    });
    t.check('a land cannot produce mana twice per turn', exploit === 0, `extra fire mana=${exploit}`);

    // Was D5: player creatures untapped at the end of the player's own turn (RULES.md R5.3).
    const untap = await page.evaluate(() => {
        const bear = { ...window.__ALL_CARDS.find(c => c.type === 'creature' && !c.abilities?.includes('vigilance')), id: 0.777, tapped: true, summoningSick: false, damage: 0 };
        gameState.playerBoard.push(bear);
        isProcessingAction = false;
        endTurn();
        return gameState.playerBoard.find(c => c.id === 0.777).tapped;
    });
    t.check('attacking creature stays tapped during the enemy turn', untap === true, 'untapped by endTurn()');
    await waitForPlayerTurn(page);

    // Was D7: revive returned the top graveyard card of any type (RULES.md C10).
    const revived = await page.evaluate(() => {
        const spell = window.__ALL_CARDS.find(c => c.type === 'instant');
        gameState.playerGraveyard.push({ ...spell, id: 0.555 });
        resolveSpell({ effect: 'revive', name: 'probe', emoji: '' }, 'player');
        return gameState.playerBoard.find(c => c.id !== 0.555 && c.name === spell.name)?.type || null;
    });
    t.check('revive never puts a non-creature on the battlefield', revived === null, `revived a ${revived}`);
}, { projects: ['desktop'] });

scenario('reset-progress', async ({ page, t, url }) => {
    // Was D9: RESET PROGRESS kept in-memory stats, and the next match wrote old totals back (PROGRESSION.md P5.2).
    await boot(page, false, url);
    await startMatch(page, false);
    await page.evaluate(() => changeEnemyLife(-gameState.enemyLife));
    await page.evaluate(() => returnToMainMenu());
    await openMenu(page, false, 'GAME STATS');
    await page.click('#statsScreen button:has-text("RESET PROGRESS")');
    await page.click('#gameConfirmYesBtn');
    await page.waitForTimeout(300);
    t.check('reset restores 100 credits', (await readMeta(page)).wallet.credits === 100);
    t.check('stats screen shows 0 wins after RESET PROGRESS',
        (await page.textContent('#gamesWon')) === '0', `shows ${await page.textContent('#gamesWon')}`);
    await page.click('#statsScreen button:has-text("BACK TO MENU")');
    await startMatch(page, false);
    await page.evaluate(() => changePlayerLife(-gameState.playerLife));
    const stats = (await readMeta(page)).stats;
    t.check('a loss after reset records 0 wins / 1 loss', stats.wins === 0 && stats.losses === 1, JSON.stringify(stats));
}, { projects: ['desktop'] });

scenario('mobile-touch', async ({ page, touch, t, url, project }) => {
    await boot(page, touch, url);
    const menuOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t.check('no horizontal overflow on menu', menuOverflow <= 1, `overflow=${menuOverflow}px`);
    await startMatch(page, touch);
    const handCards = await page.locator('#playerHand .card').count();
    t.check('7 hand cards rendered', handCards === 7, `got ${handCards}`);

    // Was D6: a long-press showed the card details and then also played the card on release.
    await ensureLandsInHand(page, 1);
    // The hand scrolls sideways on a phone; bring the land on screen first, as a player would.
    const landCard = page.locator('#playerHand .card.land').first();
    await landCard.scrollIntoViewIfNeeded();
    const box = await landCard.boundingBox();
    await longPress(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(300);
    const detail = await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show'));
    const played = await page.evaluate(() => gameState.playerBoard.some(c => c.type === 'land'));
    t.check('long-press opens card detail', detail);
    t.check('long-press to inspect does not play the card', !played, 'land was played on release');
    await page.evaluate(() => hideCardDetail());
    await page.screenshot({ path: path.join(OUT_DIR, `${project}-match-touch.png`) });
}, { projects: ['mobile'] });

// ---------------------------------------------------------------- runner

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const server = await startServer();
    // ?qa=1 turns on the game's QA helpers (window.__qaNavSmoke etc.); players never get them.
    const url = `http://127.0.0.1:${server.address().port}/?qa=1`;
    const projectNames = args.project ? String(args.project).split(',') : Object.keys(PROJECTS);
    const only = args.only ? String(args.only).split(',') : null;
    const turns = Number(args.turns) || 3;

    const browser = await chromium.launch({
        headless: !args.headed,
        args: ['--autoplay-policy=no-user-gesture-required']
    });
    const browserVersion = browser.version();
    console.log(`Chromium ${browserVersion} · serving ${ROOT} at ${url}`);

    for (const projectName of projectNames) {
        const project = PROJECTS[projectName];
        if (!project) throw new Error(`Unknown project "${projectName}"`);
        for (const { name, fn, projects } of SCENARIOS) {
            if (!projects.includes(projectName)) continue;
            if (only && !only.some(part => name.includes(part))) continue;
            console.log(`\n[${projectName}] ${name}`);
            const context = await browser.newContext(project.contextOptions);
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('console', msg => {
                if (msg.type() === 'error') pageErrors.push(msg.text());
                if (args.verbose) console.log(`    [console.${msg.type()}] ${msg.text()}`);
            });
            page.on('dialog', dialog => {
                pageErrors.push(`unexpected dialog: ${dialog.message()}`);
                dialog.dismiss();
            });
            const t = makeTester(projectName, name);
            const started = Date.now();
            try {
                await fn({ page, touch: project.touch, t, url, project: projectName, turns });
            } catch (error) {
                t.check('scenario completed', false, error.message.split('\n')[0]);
                await page.screenshot({ path: path.join(OUT_DIR, `${projectName}-${name}-failure.png`) }).catch(() => {});
            }
            t.check('no uncaught page errors / console errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
            console.log(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
            await context.close();
        }
    }

    await browser.close();
    server.close();

    const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    fs.writeFileSync(path.join(OUT_DIR, 'smoke-results.json'), JSON.stringify({ chromium: browserVersion, tally, results }, null, 2));
    console.log(`\nSummary: ${['PASS', 'FAIL', 'XFAIL', 'XPASS'].map(s => `${s} ${tally[s] || 0}`).join(' · ')}`);
    if (tally.XPASS) console.log('XPASS = a known defect no longer reproduces; update QA_BASELINE.md.');
    process.exit(tally.FAIL ? 1 : 0);
}

main().catch(error => {
    console.error('Smoke runner crashed:', error);
    process.exit(2);
});
