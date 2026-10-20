// Turn and resource rules for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/rules.test.mjs        (or: npm run rules)
//
// Determinism: Math.random is replaced by a seeded PRNG before index.js loads, and Playwright's fake
// clock drives every setTimeout/requestAnimationFrame, so AI turns run instantly and identically.
// Fixtures put exact cards into gameState zones; actions go through the same functions the UI calls.
// The house rules being tested are written down in RULES.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    useGameBrowser, openGame, clickAt, startMatch, act, setup, finishEnemyTurn, passTurn,
    snapshot, readMeta, hasClass, QUIET_ENEMY
} from './lib/game.mjs';

useGameBrowser();

// ------------------------------------------------------------------ opening hands

describe('opening hands', () => {
    test('each player gets 7 cards from a 60-card deck; the player goes first and does not draw on turn 1', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const s = await snapshot(page);
        assert.equal(s.hand.length, 7);
        assert.equal(s.enemyHand, 7);
        assert.equal(s.deck, 53);
        assert.equal(s.enemyDeck, 53);
        assert.deepEqual(s.life, [20, 20]);
        assert.equal(s.turn, 'player');
        assert.equal(s.phase, 'main');
        assert.deepEqual(s.mana, {});
        assert.equal(s.landsPlayed, 0);
        assert.equal(await page.isDisabled('#mulliganBtn'), false);
    });

    test('the same seed deals the same opening hands', { timeout: 60000 }, async t => {
        const hands = [];
        for (let i = 0; i < 2; i++) {
            const page = await openGame(t, { seed: 77 });
            await startMatch(page);
            hands.push(await page.evaluate(() => [gameState.playerHand, gameState.enemyHand].map(h => h.map(c => c.name).join(','))));
        }
        assert.deepEqual(hands[0], hands[1]);
    });

    test('AI decks only use the five real colours (no "colorless" placeholder cards)', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 3 });
        const broken = [];
        for (let match = 0; match < 40; match++) {
            await startMatch(page);
            const bad = await page.evaluate(() => [...gameState.enemyDeck, ...gameState.enemyHand].filter(c => !c.type || !c.name).length);
            if (bad) broken.push(`match ${match}: ${bad} typeless cards`);
        }
        assert.deepEqual(broken, []);
    });
});

// ------------------------------------------------------------------ mulligan

describe('mulligan', () => {
    test('once per match, to six cards, before the first action', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await clickAt(page, '#mulliganBtn');
        await clickAt(page, '#mulliganYesBtn');
        await page.clock.runFor(400);
        let s = await snapshot(page);
        assert.equal(s.hand.length, 6);
        assert.equal(s.deck, 54);
        assert.equal(await page.isDisabled('#mulliganBtn'), true);

        await act(page, () => mulligan());
        assert.equal(await hasClass(page, 'mulliganConfirmModal', 'show'), false, 'second mulligan must not open');
        await act(page, () => performMulligan());
        s = await snapshot(page);
        assert.equal(s.hand.length, 6, 'second mulligan must not redraw');
    });

    test('not after the first turn has ended', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, QUIET_ENEMY);
        await passTurn(page);
        const before = await snapshot(page);
        await act(page, () => mulligan());
        await act(page, () => performMulligan());
        assert.equal(await hasClass(page, 'mulliganConfirmModal', 'show'), false);
        assert.deepEqual((await snapshot(page)).hand, before.hand);
    });

    test('not after playing a card, even if the confirm dialog was already open', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['lands-volcanic-peak', ...Array(6).fill('spells-fireball')] });

        await act(page, () => mulligan()); // dialog open
        await act(page, () => playCard(window.__rt.find('playerHand', 'Volcanic Peak').id));
        const handAfterLand = (await snapshot(page)).hand;
        await clickAt(page, '#mulliganYesBtn');
        await page.clock.runFor(400);
        assert.deepEqual((await snapshot(page)).hand, handAfterLand, 'the same six cards, not a redraw');

        await act(page, () => mulligan());
        assert.equal(await hasClass(page, 'mulliganConfirmModal', 'show'), false);
        assert.deepEqual((await snapshot(page)).hand, handAfterLand);
    });

    test('not after tapping a land for mana', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: ['lands-volcanic-peak'] });
        await act(page, () => tapLand(gameState.playerBoard[0].id));
        await act(page, () => performMulligan());
        assert.equal((await snapshot(page)).hand.length, 7);
    });
});

// ------------------------------------------------------------------ lands and mana

describe('lands and mana', () => {
    test('one land per turn; the allowance resets next turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerHand: Array(3).fill('lands-volcanic-peak'), playerDeck: Array(5).fill('lands-volcanic-peak') });

        await clickAt(page, '#playerHand .card.land');
        await page.clock.runFor(400);
        await clickAt(page, '#playerHand .card.land');
        await page.clock.runFor(400);
        let s = await snapshot(page);
        assert.equal(s.board.length, 1, 'second land refused');
        assert.equal(s.hand.length, 2);

        await passTurn(page);
        s = await snapshot(page);
        assert.equal(s.landsPlayed, 0);
        await act(page, () => playCard(gameState.playerHand.find(c => c.type === 'land').id));
        assert.equal((await snapshot(page)).board.length, 2);
    });

    test('the AI also plays at most one land per turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyHand: Array(3).fill('lands-mystic-springs'), enemyBoard: [], enemyDeck: Array(5).fill('creatures-ancient-dragon') });
        await passTurn(page);
        const s = await snapshot(page);
        assert.equal(s.enemyBoard.length, 1);
        assert.equal(s.enemyHand, 3, '2 lands left + 1 drawn');
    });

    test('lands add one mana of their colour; the pool empties when the turn ends', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerBoard: ['lands-volcanic-peak', 'lands-volcanic-peak', 'lands-mystic-springs'] });
        await clickAt(page, '#playerBoard .land-stack-card:has-text("🔥")');
        await page.clock.runFor(100);
        assert.deepEqual((await snapshot(page)).mana, { fire: 1 });
        await act(page, () => tapAllLandsOfType('fire'));
        await act(page, () => tapLand(window.__rt.find('playerBoard', 'Mystic Springs').id));
        assert.deepEqual((await snapshot(page)).mana, { fire: 2, water: 1 });

        await act(page, () => endTurn());
        assert.deepEqual((await snapshot(page)).mana, {}, 'unused mana is lost at end of turn');
        await finishEnemyTurn(page);
        const s = await snapshot(page);
        assert.deepEqual(s.mana, {});
        assert.ok(s.board.every(entry => entry.endsWith(':ready')), 'lands untap at the start of your turn');
    });

    test('dual and universal lands ask for a colour; Crystal Wasteland adds colourless', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: ['lands-distant-planet', 'lands-rainbow', 'lands-crystal-wasteland'] });

        await act(page, () => tapLand(window.__rt.find('playerBoard', 'Distant Planet').id));
        assert.equal(await page.locator('#manaChoiceOptions button').count(), 3, '2 colours + cancel');
        await clickAt(page, '#manaChoiceOptions button[title="swamp"]');
        await act(page, () => tapLand(window.__rt.find('playerBoard', 'Rainbow').id));
        assert.equal(await page.locator('#manaChoiceOptions button').count(), 6, '5 colours + cancel');
        await clickAt(page, '#manaChoiceOptions button.cancel-btn');
        await page.clock.runFor(300);
        assert.equal(await page.evaluate(() => window.__rt.find('playerBoard', 'Rainbow').tapped), false, 'cancel leaves it untapped');
        await act(page, () => tapLand(window.__rt.find('playerBoard', 'Rainbow').id));
        await clickAt(page, '#manaChoiceOptions button[title="earth"]');
        await act(page, () => tapLand(window.__rt.find('playerBoard', 'Crystal Wasteland').id));
        assert.deepEqual((await snapshot(page)).mana, { swamp: 1, earth: 1, colorless: 1 });
    });

    test('canPayCost and payCost agree on 3000 seeded random pools and costs', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 11 });
        const failures = await page.evaluate(() => {
            const colors = ['fire', 'water', 'earth', 'swamp', 'light'];
            const rand = n => Math.floor(Math.random() * n);
            const failed = [];
            for (let i = 0; i < 3000; i++) {
                const pool = { colorless: rand(3) };
                colors.forEach(color => { if (Math.random() < 0.5) pool[color] = rand(4); });
                const cost = {};
                const picked = [...colors].sort(() => Math.random() - 0.5).slice(0, 1 + rand(2));
                picked.forEach(color => { cost[color] = 1 + rand(3); });
                if (Math.random() < 0.4) cost.colorless = 1 + rand(3);
                // Independent oracle for the house rule: coloured costs use that colour, any shortfall may be
                // covered by colourless mana, and the generic part may use anything left.
                let wild = pool.colorless || 0;
                let ok = true;
                for (const color of picked) {
                    const short = Math.max(0, cost[color] - (pool[color] || 0));
                    if (short > wild) ok = false;
                    wild -= short;
                }
                const total = Object.values(pool).reduce((a, b) => a + b, 0);
                const due = Object.values(cost).reduce((a, b) => a + b, 0);
                if (total < due) ok = false;
                const can = canPayCost(cost, { ...pool });
                if (can !== ok) { failed.push({ pool, cost, can, expected: ok }); continue; }
                if (!can) continue;
                const after = { ...pool };
                payCost(cost, after);
                const left = Object.values(after).reduce((a, b) => a + b, 0);
                if (Object.values(after).some(n => n < 0) || left !== total - due) failed.push({ pool, cost, after });
            }
            return failed.slice(0, 5);
        });
        assert.deepEqual(failures, []);
    });

    test('casting spends exactly the cost; an unaffordable card is refused with nothing changed', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-fireball', 'creatures-fire-fox'], playerMana: { fire: 2, water: 1 } });
        const before = await snapshot(page);
        await act(page, () => playCard(window.__rt.find('playerHand', 'Fireball').id));
        await act(page, () => hideCardDetail());
        let s = await snapshot(page);
        assert.deepEqual([s.hand, s.mana, s.life], [before.hand, before.mana, before.life]);

        await act(page, () => playCard(window.__rt.find('playerHand', 'Fire Fox').id));
        s = await snapshot(page);
        assert.deepEqual(s.mana, { water: 1 });
        assert.deepEqual(s.board, ['Fire Fox:ready']);
    });

    test('house rule: colourless mana can pay coloured costs', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['creatures-fire-fox'], playerMana: { colorless: 2 } });
        await act(page, () => playCard(gameState.playerHand[0].id));
        const s = await snapshot(page);
        assert.deepEqual(s.board, ['Fire Fox:ready']);
        assert.deepEqual(s.mana, {});
    });

    test('a tapped land untaps only to refund its unspent mana', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: ['lands-volcanic-peak'], playerHand: ['creatures-hot-pepper-sprite'] });
        const landId = await page.evaluate(() => gameState.playerBoard[0].id);

        await act(page, id => tapLand(id), landId);
        await act(page, id => tapLand(id), landId); // change of mind: refund
        let s = await snapshot(page);
        assert.deepEqual([s.board[0], s.mana], ['Volcanic Peak:ready', {}]);

        await act(page, id => tapLand(id), landId);
        await act(page, () => playCard(window.__rt.find('playerHand', 'Hot Pepper Sprite').id)); // spends the fire
        await act(page, id => tapLand(id), landId);
        await clickAt(page, '#playerBoard .land-stack-card');
        await page.clock.runFor(300);
        await act(page, id => tapLand(id), landId);
        s = await snapshot(page);
        assert.equal(s.board.find(b => b.startsWith('Volcanic Peak')), 'Volcanic Peak:tapped', 'spent land stays tapped');
        assert.deepEqual(s.mana, {}, 'no second mana from the same land');
    });

    test('a dual-land colour picked after the turn has ended adds nothing', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerBoard: ['lands-distant-planet'] });
        await act(page, () => tapLand(gameState.playerBoard[0].id)); // dialog open
        await page.evaluate(() => endTurn());
        await clickAt(page, '#manaChoiceOptions button[title="light"]');
        const s = await snapshot(page);
        assert.deepEqual(s.mana, {});
        assert.deepEqual(s.board, ['Distant Planet:ready']);
    });
});

// ------------------------------------------------------------------ timing

describe('timing', () => {
    test('nothing can be played, tapped, attacked or ended during the enemy turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            ...QUIET_ENEMY,
            playerHand: ['lands-volcanic-peak', 'spells-flame-jet'],
            playerBoard: ['lands-volcanic-peak', 'artifacts-mana-gem', { card: 'creatures-fire-fox' }]
        });
        await page.evaluate(() => endTurn());
        await page.clock.runFor(100);
        const before = await snapshot(page);
        assert.equal(before.turn, 'enemy');
        await page.evaluate(() => {
            gameState.playerHand.forEach(c => playCard(c.id));
            gameState.playerBoard.forEach(c => { tapLand(c.id); activateArtifact(c.id); });
            tapAllLandsOfType('fire');
            enterAttackPhase();
            endTurn();
            mulligan();
        });
        await page.keyboard.press('a');
        await page.keyboard.press('Space');
        const after = await snapshot(page);
        assert.deepEqual(after, before);
    });

    test('the turn cannot end while attackers are being declared; one attack per turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerBoard: ['creatures-noble-deer'] }); // vigilance: stays untapped
        await act(page, () => enterAttackPhase());
        await act(page, () => endTurn());
        assert.equal((await snapshot(page)).turn, 'player', 'cannot end turn mid-declaration');
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        await act(page, () => confirmAttackers());
        assert.deepEqual((await snapshot(page)).life, [20, 18]);
        await act(page, () => enterAttackPhase());
        const s = await snapshot(page);
        assert.equal(s.phase, 'main', 'second attack refused');
        assert.deepEqual(s.life, [20, 18]);
    });
});

// ------------------------------------------------------------------ summoning sickness

describe('summoning sickness', () => {
    test('player creatures cannot attack the turn they arrive unless they have haste', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerHand: ['creatures-fire-lobster', 'creatures-fire-fox'], playerMana: { fire: 4 } });
        await act(page, () => playCard(window.__rt.find('playerHand', 'Fire Lobster').id));
        await act(page, () => playCard(window.__rt.find('playerHand', 'Fire Fox').id));
        await act(page, () => enterAttackPhase());
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        const attackers = await page.evaluate(() => gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id).name));
        assert.deepEqual(attackers, ['Fire Fox']);
        await act(page, () => confirmAttackers());

        await passTurn(page);
        await act(page, () => enterAttackPhase());
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        const nextTurn = await page.evaluate(() => gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id).name).sort());
        assert.deepEqual(nextTurn, ['Fire Fox', 'Fire Lobster']);
    });

    test('AI creatures wait a turn unless they have haste', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            difficulty: 'hard', // hard AI attacks with every eligible creature
            enemyBoard: ['lands-volcanic-peak', 'lands-volcanic-peak'],
            enemyHand: ['creatures-fire-lobster'],
            enemyDeck: Array(5).fill('creatures-ancient-dragon')
        });
        await passTurn(page);
        let s = await snapshot(page);
        assert.ok(s.enemyBoard.includes('Fire Lobster:ready'), 'lobster arrived and did not attack');
        assert.deepEqual(s.life, [20, 20]);
        await passTurn(page);
        assert.deepEqual((await snapshot(page)).life, [18, 20], 'lobster attacks the next turn');

        const fresh = await openGame(t);
        await startMatch(fresh);
        await setup(fresh, { difficulty: 'hard', enemyBoard: ['lands-volcanic-peak', 'lands-volcanic-peak'], enemyHand: ['creatures-fire-fox'], enemyDeck: Array(5).fill('creatures-ancient-dragon') });
        await passTurn(fresh);
        assert.deepEqual((await snapshot(fresh)).life, [18, 20], 'haste attacks immediately');
    });
});

// ------------------------------------------------------------------ tapping and untapping

describe('tapping and untapping', () => {
    test('attacking taps a creature; vigilance does not', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerBoard: ['creatures-fire-lobster', 'creatures-noble-deer'] });
        await act(page, () => enterAttackPhase());
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        await act(page, () => confirmAttackers());
        assert.deepEqual((await snapshot(page)).board, ['Fire Lobster:tapped', 'Noble Deer:ready']);
    });

    test("permanents untap at the start of their controller's turn, not at the end of it", { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            difficulty: 'hard',
            playerBoard: ['creatures-fire-lobster'],
            enemyBoard: [{ card: 'creatures-fire-fox', tapped: true }], // untaps at the AI's turn start
            enemyHand: [],
            enemyDeck: Array(5).fill('creatures-ancient-dragon')
        });
        await act(page, () => enterAttackPhase());
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        await act(page, () => confirmAttackers());
        await page.evaluate(() => endTurn());
        await page.clock.runFor(100);
        assert.deepEqual((await snapshot(page)).board, ['Fire Lobster:tapped'], 'your attacker is still tapped on the enemy turn');

        await finishEnemyTurn(page);
        const s = await snapshot(page);
        assert.deepEqual(s.life, [18, 18], 'the tapped lobster could not block the fox');
        assert.deepEqual(s.board, ['Fire Lobster:ready'], 'untapped at the start of your turn');
        assert.deepEqual(s.enemyBoard, ['Fire Fox:tapped'], 'the enemy attacker stays tapped through your turn');
    });
});

// ------------------------------------------------------------------ empty deck

describe('drawing from an empty deck', () => {
    test('the player loses when the turn-start draw finds an empty deck', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...QUIET_ENEMY, playerDeck: [] });
        await passTurn(page);
        const s = await snapshot(page);
        assert.equal(s.finalized, true);
        assert.equal(await hasClass(page, 'loseOverlay', 'show'), true);
        assert.equal((await readMeta(page)).stats.losses, 1);
    });

    test('the player wins when the AI must draw from an empty deck, and the AI turn stops', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyHand: ['lands-volcanic-peak', 'creatures-fire-fox'], enemyBoard: ['lands-volcanic-peak', 'lands-volcanic-peak'], enemyDeck: [] });
        const deckBefore = (await snapshot(page)).deck;
        await passTurn(page);
        const s = await snapshot(page);
        assert.equal(s.finalized, true);
        assert.equal(await hasClass(page, 'matchRewardOverlay', 'show'), true);
        assert.equal(s.enemyBoard.length, 2, 'AI played nothing after losing');
        assert.equal(s.deck, deckBefore, 'no player turn started afterwards');
        assert.equal((await readMeta(page)).stats.wins, 1);
    });

    test('a draw effect that runs out of cards also loses', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-harvest'], playerDeck: ['lands-volcanic-peak'], playerMana: { earth: 2 } });
        await act(page, () => playCard(gameState.playerHand[0].id)); // draws 2 with 1 card left
        assert.equal((await snapshot(page)).finalized, true);
        assert.equal(await hasClass(page, 'loseOverlay', 'show'), true);
    });
});

// ------------------------------------------------------------------ life and match end

describe('life and match end', () => {
    test('a spell that brings the enemy to 0 wins once; later damage changes nothing', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-fireball'], playerMana: { fire: 3 }, enemyLife: 3 });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await hasClass(page, 'matchRewardOverlay', 'show'), true);
        await act(page, () => { changeEnemyLife(-5); changePlayerLife(-30); checkGameOver(); finalizeMatch('loss'); });
        const meta = await readMeta(page);
        assert.deepEqual([meta.stats.wins, meta.stats.losses, meta.wallet.credits], [1, 0, 125]);
        assert.deepEqual((await snapshot(page)).life, [20, 0]);
    });

    test('enemy combat damage that reaches 0 life loses the match', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { difficulty: 'hard', playerLife: 2, enemyBoard: ['creatures-fire-fox'], enemyHand: [], enemyDeck: Array(5).fill('creatures-ancient-dragon') });
        await passTurn(page);
        assert.equal((await snapshot(page)).finalized, true);
        assert.equal(await hasClass(page, 'loseOverlay', 'show'), true);
        const meta = await readMeta(page);
        assert.deepEqual([meta.stats.losses, meta.wallet.credits], [1, 110]);
    });

    test('simultaneous lethal: effects resolve in order and the first player at 0 loses; a tie goes against the player', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-drain-life'], playerMana: { swamp: 2 }, playerLife: 1, enemyLife: 2 });
        await act(page, () => playCard(gameState.playerHand[0].id)); // enemy -2 (lethal) happens before your +2
        assert.equal(await hasClass(page, 'matchRewardOverlay', 'show'), true);

        const tie = await openGame(t);
        await startMatch(tie);
        await tie.evaluate(() => { gameState.playerLife = 0; gameState.enemyLife = 0; checkGameOver(); });
        assert.equal(await hasClass(tie, 'loseOverlay', 'show'), true);
    });

    test('no game action works after the match has ended', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerHand: ['lands-volcanic-peak', 'spells-flame-jet'],
            playerBoard: ['lands-volcanic-peak', 'artifacts-mana-gem', 'creatures-fire-fox'],
            playerMana: { fire: 1 }
        });
        await act(page, () => changeEnemyLife(-20));
        const before = await snapshot(page);
        await page.evaluate(() => {
            gameState.playerHand.forEach(c => playCard(c.id));
            gameState.playerBoard.forEach(c => { tapLand(c.id); activateArtifact(c.id); });
            tapAllLandsOfType('fire');
            enterAttackPhase();
            selectAttacker(gameState.playerBoard[2].id);
            confirmAttackers();
            endTurn();
            mulligan();
            performMulligan();
        });
        for (const key of ['a', 'm', 'e', 'Space']) await page.keyboard.press(key);
        await page.clock.runFor(15000);
        assert.deepEqual(await snapshot(page), before);
        assert.equal(await hasClass(page, 'mulliganConfirmModal', 'show'), false);
        assert.equal((await readMeta(page)).stats.wins, 1);
    });

    test('quitting during the enemy turn does not leak that turn into the next match', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyHand: ['lands-volcanic-peak', 'creatures-fire-fox'], enemyBoard: ['lands-volcanic-peak'] });
        await page.evaluate(() => endTurn());
        await page.clock.runFor(2000); // AI turn under way
        await page.evaluate(() => { pauseGame(); confirmQuit(); });
        await clickAt(page, '#gameConfirmYesBtn');
        await page.clock.runFor(400);

        await startMatch(page);
        const before = await snapshot(page);
        await page.clock.runFor(15000);
        const after = await snapshot(page);
        assert.deepEqual(after, before, 'the new match was not touched by the old AI turn');
        assert.equal(after.turn, 'player');
        assert.deepEqual(after.enemyBoard, []);
    });
});
