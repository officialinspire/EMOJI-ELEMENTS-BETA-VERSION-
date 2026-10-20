// Shared helpers for the browser rules suites (tests/rules.test.mjs, tests/combat.test.mjs).
// Determinism: Math.random is replaced by a seeded PRNG before index.js loads, and Playwright's fake
// clock drives every setTimeout/requestAnimationFrame, so AI turns run instantly and identically.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright, startServer } from './harness.mjs';

const { chromium } = loadPlaywright();
let browser;
let server;
let url;

export function useGameBrowser() {
before(async () => {
    server = await startServer();
    url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch();
});

after(async () => {
    await browser?.close();
    server?.close();
});
}

// Runs in the page before index.js: seeded RNG plus fixture helpers.
function pageInit(seed) {
    let state = seed;
    Math.random = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let nextId = 1000;
    const card = spec => {
        const { card: cardId, ...extra } = typeof spec === 'string' ? { card: spec } : spec;
        const base = window.__CARD_BY_ID[cardId];
        if (!base) throw new Error(`Unknown card id ${cardId}`);
        const instance = { ...base, id: ++nextId, ...extra };
        if (instance.type !== 'instant') instance.tapped ??= false;
        if (instance.type === 'creature') {
            instance.summoningSick ??= false;
            instance.damage ??= 0;
        }
        return instance;
    };
    window.__rt = {
        card,
        // Zones are listed top-first for decks (drawCard pops from the end of the array).
        setup(spec) {
            for (const zone of ['playerHand', 'playerBoard', 'playerGraveyard', 'enemyHand', 'enemyBoard', 'enemyGraveyard']) {
                if (spec[zone]) gameState[zone] = spec[zone].map(card);
            }
            for (const zone of ['playerDeck', 'enemyDeck']) {
                if (spec[zone]) gameState[zone] = spec[zone].map(card).reverse();
            }
            for (const key of ['playerLife', 'enemyLife', 'landsPlayedThisTurn', 'difficulty', 'hasAttackedThisTurn']) {
                if (spec[key] !== undefined) gameState[key] = spec[key];
            }
            if (spec.playerMana) gameState.playerMana = { ...spec.playerMana };
            updateUI({ immediate: true });
            updateDeckCounters();
            return gameState.playerHand.map(c => c.id);
        },
        find(zone, name) {
            return gameState[zone].find(c => c.name === name);
        }
    };
}

// A fresh browser context (fresh save) with the seeded RNG and fake clock. Returns the page plus a
// close() that also asserts the page raised no errors.
export async function openGamePage({ seed = 1 } = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(`dialog: ${dialog.message()}`); dialog.dismiss(); });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.addInitScript(pageInit, seed);
    await page.goto(url);
    // Skip the CLICK TO START / intro screens (covered by tests/smoke.mjs); they would swallow clicks.
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    return {
        page,
        async close() {
            await context.close();
            assert.deepEqual(errors, [], 'page raised errors');
        }
    };
}

// Per-test page: closed (and checked for page errors) when the test ends.
export async function openGame(t, options) {
    const { page, close } = await openGamePage(options);
    t.after(close);
    return page;
}

// Real mouse input at the element's centre. page.click() would wait for a real animation frame while
// scrolling, which never comes under the fake clock; every target here is already on screen.
export async function clickAt(page, selector) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(box, `${selector} is not visible`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// The game ignores NEW GAME input for a short debounce after a start (isStartingGame). Under the fake
// clock that timer can fire later than its 300 ms, so wait on the flag itself rather than a fixed delay.
export async function waitUntilStartable(page) {
    for (let i = 0; i < 100 && await page.evaluate(() => isStartingGame); i++) await page.clock.runFor(100);
}

// Starts a match exactly as the NEW GAME screen does (leaving any match on screen first, like PLAY AGAIN).
export async function startMatch(page, { mode = 'single', elements = ['fire'] } = {}) {
    await waitUntilStartable(page);
    await page.evaluate(({ mode, elements }) => {
        if (document.getElementById('gameContainer').style.display === 'flex') returnToMainMenu();
        showElementSelection();
        setDeckMode(mode);
        elements.forEach(element => selectElement(element));
        startGame();
    }, { mode, elements });
    await page.clock.runFor(400);
    assert.equal(await page.evaluate(() => document.getElementById('gameContainer').style.display), 'flex', 'match did not start');
}

// Runs an action in the page, then lets short UI locks (playCard 200 ms, combat 300 ms) expire.
export async function act(page, fn, arg) {
    const result = await page.evaluate(fn, arg);
    await page.clock.runFor(400);
    return result;
}

export const setup = (page, spec) => act(page, s => window.__rt.setup(s), spec);
export const finishEnemyTurn = page => page.clock.runFor(12000);
export async function passTurn(page) {
    await act(page, () => endTurn());
    await finishEnemyTurn(page);
}

export const snapshot = page => page.evaluate(() => ({
    turn: gameState.turn,
    phase: gameState.phase,
    finalized: gameState.matchFinalized,
    life: [gameState.playerLife, gameState.enemyLife],
    hand: gameState.playerHand.map(c => c.id),
    deck: gameState.playerDeck.length,
    board: gameState.playerBoard.map(c => `${c.name}:${c.tapped ? 'tapped' : 'ready'}`),
    graveyard: gameState.playerGraveyard.length,
    enemyHand: gameState.enemyHand.length,
    enemyDeck: gameState.enemyDeck.length,
    enemyBoard: gameState.enemyBoard.map(c => `${c.name}:${c.tapped ? 'tapped' : 'ready'}`),
    mana: Object.fromEntries(Object.entries(gameState.playerMana).filter(([, n]) => n > 0)),
    landsPlayed: gameState.landsPlayedThisTurn,
    attackers: gameState.attackers.length
}));

export const readMeta = page => page.evaluate(() => JSON.parse(localStorage.getItem('emoji_elements_meta_v1')));
export const hasClass = (page, id, cls) => page.evaluate(([id, cls]) => document.getElementById(id).classList.contains(cls), [id, cls]);

// A quiet enemy: no creatures, nothing castable, a deck to draw from.
export const QUIET_ENEMY = {
    enemyHand: [],
    enemyBoard: [],
    enemyDeck: Array(10).fill('creatures-ancient-dragon')
};
