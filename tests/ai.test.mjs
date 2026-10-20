// AI rules and decisions for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/ai.test.mjs        (or: npm run ai)
//
// Part 1: targeted scenarios. The AI follows the same land, mana, timing, tapping, combat, targeting and
// deck-building rules as the player, and makes the decisions described in AI.md §3.
// Part 2: a seeded simulation of every starter deck against every difficulty (tests/lib/ai-sim.mjs), checked
// for illegal plays, stalled turns, loops and errors. The larger measured sample is `npm run ai:sim`.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, startMatch, act, setup, passTurn, snapshot } from './lib/game.mjs';
import { loadPlaywright, startServer } from './lib/harness.mjs';
import { STANDARD_DECKS, DIFFICULTIES, runMatch, assertNoViolations } from './lib/ai-sim.mjs';

useGameBrowser();

const PEAK = 'lands-volcanic-peak';
const SPRINGS = 'lands-mystic-springs';
const RAINBOW = 'lands-rainbow';
const DRAGON = 'creatures-ancient-dragon';           // fire 6: never castable in these scenarios
const LOBSTER = 'creatures-fire-lobster';            // fire 2, 2/2
const BEETLE = 'creatures-ember-beetle';             // fire 1, 1/2
const SWAN = 'creatures-crystal-swan';               // water 2, 2/2 flying
const SQUID = 'creatures-giant-squid';               // water 3, 3/3 reach
const SNAIL = 'creatures-armored-snail';             // 0/3 defender
const WITCH_CAT = 'creatures-witch-cat';             // 2/2 hexproof
const QUIET_DECK = { enemyDeck: Array(10).fill(DRAGON), playerDeck: Array(10).fill(DRAGON) };

// Runs one full AI turn from the given position.
async function aiTurnFrom(page, spec) {
    await setup(page, { playerHand: [], enemyGraveyard: [], playerGraveyard: [], playerLife: 20, enemyLife: 20, ...QUIET_DECK, ...spec });
    await passTurn(page);
    return page.evaluate(() => ({
        life: [gameState.playerLife, gameState.enemyLife],
        finalized: gameState.matchFinalized,
        enemyBoard: gameState.enemyBoard.map(c => `${c.name}${c.tapped ? ':tapped' : ''}`),
        enemyHand: gameState.enemyHand.map(c => c.name),
        enemyLands: gameState.enemyBoard.filter(c => c.type === 'land').length,
        enemyGraveyard: gameState.enemyGraveyard.map(c => c.name)
    }));
}

describe('the AI plays by the player rules', () => {
    for (const difficulty of DIFFICULTIES) {
        test(`one land per turn (${difficulty})`, { timeout: 60000 }, async t => {
            const page = await openGame(t);
            await startMatch(page);
            const s = await aiTurnFrom(page, { difficulty, enemyBoard: [], enemyHand: [PEAK, PEAK, SPRINGS] });
            assert.equal(s.enemyLands, 1);
            assert.equal(s.enemyHand.filter(n => /Peak|Springs/.test(n)).length, 2);
        });
    }

    test('it only casts what its lands can pay for', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const s = await aiTurnFrom(page, { difficulty: 'hard', enemyBoard: [PEAK, PEAK], enemyHand: [SQUID, 'spells-inferno', DRAGON] });
        assert.deepEqual(s.enemyBoard.filter(n => !/Peak/.test(n)), [], 'nothing castable with 2 fire');
    });

    test('creatures that are frozen, defenders, or new this turn do not attack', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const s = await aiTurnFrom(page, {
            difficulty: 'hard',
            playerBoard: [],
            enemyBoard: [PEAK, PEAK, { card: LOBSTER, tapped: true, frozen: true }, SNAIL],
            enemyHand: [BEETLE]
        });
        assert.deepEqual(s.life, [20, 20], 'no attack: frozen lobster, defender snail, summoning-sick beetle');
    });

    test('no AI action after the match ends during its turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        // The upkeep Signal Tower kills the player before the AI's main phase.
        const s = await aiTurnFrom(page, {
            difficulty: 'hard', playerLife: 1,
            enemyBoard: ['artifacts-signal-tower', PEAK, PEAK, LOBSTER], enemyHand: [LOBSTER, PEAK]
        });
        assert.equal(s.finalized, true);
        assert.equal(s.enemyLands, 2, 'no land played after the match ended');
        assert.deepEqual(s.enemyHand.sort(), ['Ancient Dragon', 'Fire Lobster', 'Volcanic Peak'], 'its draw happened; nothing was played');
    });

    test('generated AI decks follow the deck-building copy limits (2, legendary 1) and hold 60 cards', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const problems = await page.evaluate(() => {
            const colors = ['fire', 'water', 'earth', 'swamp', 'light'];
            const sets = [...colors.map(c => [c]), ...colors.flatMap((a, i) => colors.slice(i + 1).map(b => [a, b]))];
            const found = [];
            for (const set of sets) {
                for (let n = 0; n < 6; n++) {
                    const deck = generateDeck(set);
                    if (deck.length !== 60) found.push(`${set}: ${deck.length} cards`);
                    const counts = {};
                    deck.forEach(c => { counts[c.__id] = (counts[c.__id] || 0) + 1; });
                    Object.entries(counts).forEach(([id, count]) => {
                        const card = window.__CARD_BY_ID[id];
                        if (card.type !== 'land' && count > getDeckCardCopyLimit(card)) found.push(`${set}: ${count}× ${card.name}`);
                    });
                }
            }
            return found;
        });
        assert.deepEqual(problems, []);
    });

    test('every difficulty profile is defined, and none changes a rule', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const profiles = await page.evaluate(() => AI_PROFILES);
        assert.deepEqual(Object.keys(profiles), DIFFICULTIES);
        for (const p of Object.values(profiles)) {
            assert.deepEqual(Object.keys(p).sort(), ['attacks', 'castsInstants', 'keepsBlockers', 'maxPlays', 'seesLethal']);
        }
        assert.ok(profiles.easy.maxPlays <= profiles.medium.maxPlays && profiles.medium.maxPlays <= profiles.hard.maxPlays);
    });
});

describe('AI decisions', () => {
    test('land drop: the colour its hand needs', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        // Volcanic Peak comes first in hand; the swan needs a second water.
        const s = await aiTurnFrom(page, { difficulty: 'easy', enemyBoard: [SPRINGS], enemyHand: [PEAK, SPRINGS, SWAN] });
        assert.equal(s.enemyBoard.filter(n => n.startsWith('Mystic Springs')).length, 2, `played Mystic Springs (board: ${s.enemyBoard})`);
        assert.ok(s.enemyBoard.some(n => n.startsWith('Crystal Swan')), 'and could then cast the water card');
    });

    test('a land that makes any colour is tapped for the colour that casts a card', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        // Rainbow's first colour is fire; the swan needs 2 water.
        const s = await aiTurnFrom(page, { difficulty: 'easy', enemyBoard: [RAINBOW, SPRINGS], enemyHand: [SWAN] });
        assert.ok(s.enemyBoard.some(n => n.startsWith('Crystal Swan')), `swan cast (board: ${s.enemyBoard})`);
    });

    for (const difficulty of DIFFICULTIES) {
        test(`no card is cast that would do nothing or deck it out (${difficulty})`, { timeout: 60000 }, async t => {
            const page = await openGame(t);
            await startMatch(page);
            const s = await aiTurnFrom(page, {
                difficulty,
                enemyBoard: ['lands-ancient-grove', 'lands-ancient-grove', 'lands-cursed-bog', 'lands-cursed-bog', 'lands-cursed-bog'],
                enemyHand: ['spells-growth', 'spells-curse', 'spells-harvest'],
                enemyDeck: [DRAGON],               // Harvest (draw 2) would deck it out
                playerBoard: [WITCH_CAT]           // Curse has no legal (non-hexproof) target
            });
            assert.deepEqual(s.enemyGraveyard, [], `nothing wasted (graveyard: ${s.enemyGraveyard})`);
        });
    }

    test('medium and hard cast lethal burn; easy never casts instants', { timeout: 60000 }, async t => {
        for (const [difficulty, expectWin] of [['easy', false], ['medium', true], ['hard', true]]) {
            const page = await openGame(t);
            await startMatch(page);
            const s = await aiTurnFrom(page, {
                difficulty, playerLife: 3, playerBoard: [SNAIL],
                enemyBoard: [PEAK, PEAK, PEAK], enemyHand: ['spells-fireball', LOBSTER]
            });
            assert.equal(s.finalized && s.life[0] === 0, expectWin, `${difficulty}: ${JSON.stringify(s.life)}`);
        }
    });

    test('medium and hard attack all-in when the damage that gets through is lethal, ordering attackers to beat the blocks', { timeout: 60000 }, async t => {
        for (const difficulty of ['medium', 'hard']) {
            const page = await openGame(t);
            await startMatch(page);
            // One 3/3 blocker: if it blocks the 4/3 first, only 1 gets through; ordering the 1/2 first lets 4 through.
            const s = await aiTurnFrom(page, {
                difficulty, playerLife: 4, playerBoard: [SQUID],
                enemyBoard: [{ card: 'creatures-fire-lion', abilities: [] }, BEETLE], enemyHand: []
            });
            assert.equal(s.life[0], 0, `${difficulty}: player life ${s.life[0]}`);
        }
    });

    test('medium and hard skip an attack that only loses a creature', { timeout: 60000 }, async t => {
        for (const difficulty of ['medium', 'hard']) {
            const page = await openGame(t);
            await startMatch(page);
            const s = await aiTurnFrom(page, { difficulty, playerBoard: [SQUID], enemyBoard: [LOBSTER], enemyHand: [] });
            assert.ok(s.enemyBoard.some(n => n.startsWith('Fire Lobster')), `${difficulty}: lobster stayed alive`);
            assert.deepEqual(s.life, [20, 20]);
        }
    });

    test('hard keeps blockers home when your board threatens lethal; medium does not', { timeout: 60000 }, async t => {
        const results = {};
        for (const difficulty of ['medium', 'hard']) {
            const page = await openGame(t);
            await startMatch(page);
            // Your three 3/3s are tapped (they attacked); they untap on your turn: 9 damage vs the AI's 6 life.
            const s = await aiTurnFrom(page, {
                difficulty, enemyLife: 6,
                playerBoard: [{ card: SQUID, tapped: true }, { card: SQUID, tapped: true }, { card: SQUID, tapped: true }],
                enemyBoard: [LOBSTER, LOBSTER, LOBSTER], enemyHand: []
            });
            results[difficulty] = s.life[0];
        }
        assert.deepEqual(results, { medium: 14, hard: 20 });
    });
});

describe('AI turn pacing', () => {
    test('an AI turn that does nothing is short; a busy one is unchanged; the failsafe never fires', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const warnings = [];
        page.on('console', m => { if (/Emergency turn transition/.test(m.text())) warnings.push(m.text()); });
        const timeAiTurn = async spec => {
            await setup(page, { playerHand: [], playerBoard: [], ...QUIET_DECK, ...spec });
            await act(page, () => endTurn());
            const start = await page.evaluate(() => Date.now());
            for (let i = 0; i < 200 && (await snapshot(page)).turn !== 'player'; i++) await page.clock.runFor(100);
            return (await page.evaluate(() => Date.now())) - start;
        };
        const idle = await timeAiTurn({ difficulty: 'hard', enemyBoard: [], enemyHand: [] });
        const busy = await timeAiTurn({ difficulty: 'hard', enemyBoard: [PEAK, PEAK, LOBSTER], enemyHand: [PEAK, BEETLE] });
        // Includes the 1.5 s pause after END TURN before the AI starts (was 8.5 s for every AI turn).
        assert.ok(idle <= 4500, `idle AI turn ${idle} ms`);
        assert.ok(busy <= 8500, `busy AI turn ${busy} ms`);
        assert.deepEqual(warnings, []);
    });
});

// ------------------------------------------------------------------ seeded simulation

describe('seeded simulation: every starter deck × every difficulty', () => {
    let browser;
    let server;
    let url;
    before(async () => {
        server = await startServer();
        url = `http://127.0.0.1:${server.address().port}/`;
        browser = await loadPlaywright().chromium.launch();
    });
    after(async () => {
        await browser?.close();
        server?.close();
    });

    STANDARD_DECKS.forEach((deck, di) => {
        test(`${deck.join('/')}: no illegal play, stall, loop or error at any difficulty`, { timeout: 240000 }, async () => {
            for (const [fi, difficulty] of DIFFICULTIES.entries()) {
                const match = await runMatch(browser, url, { seed: 5000 + di * 10 + fi, deck, difficulty });
                assertNoViolations(match);
                assert.ok(match.winner, `${difficulty}: match ended (${match.reason})`);
            }
        });
    });
});
