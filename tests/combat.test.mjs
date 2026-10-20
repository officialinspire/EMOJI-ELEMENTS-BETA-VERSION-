// Combat rules for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/combat.test.mjs        (or: npm run combat)
//
// The scenario table runs every row twice: once with the player attacking (ATTACK → select → CONFIRM,
// the AI blocks) and once with the AI attacking on its turn (the player's creatures block). Both sides
// must follow the same rules. The house rules are written down in RULES.md §8.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGamePage, openGame, startMatch, act, setup, passTurn, snapshot } from './lib/game.mjs';

useGameBrowser();

// Card shorthands (stats from CARD_DATABASE; overrides only where a scenario needs exact numbers).
const LOBSTER = 'creatures-fire-lobster';          // 2/2
const BEETLE = 'creatures-ember-beetle';           // 1/2
const SWAN = 'creatures-crystal-swan';             // 2/2 flying
const SQUID = 'creatures-giant-squid';             // 3/3 reach
const SHARK = 'creatures-great-shark';             // 4/3 menace
const WEREWOLF = 'creatures-werewolf';             // 4/3 double_strike
const SNAKE = 'creatures-venom-snake';             // 2/1 deathtouch
const RAM = 'creatures-fire-ram';                  // 2/2 first_strike
const DEER = 'creatures-noble-deer';               // 2/2 vigilance
const SNAIL = 'creatures-armored-snail';           // 0/3 defender
const TURTLE = 'creatures-ancient-turtle';         // 0/6 defender, hexproof
const OTTER = 'creatures-otter-scout';             // 2/2 unblockable
const DOLPHIN = 'creatures-mystic-dolphin';        // 2/2 flash
const PANDA = 'creatures-bamboo-panda';            // 2/4 lifelink
const SCORPION = 'creatures-death-scorpion';       // 1/1 deathtouch, first_strike
const LION = 'creatures-fire-lion';                // 4/3 trample
const OCTOPUS = 'creatures-giant-octopus';         // 2/4 defender, reach

// Each row: attackers and blockers (as board fixtures), expected life change for the defending player and
// for the attacking player, and which creatures are left on each side. Blocks are chosen automatically.
const SCENARIOS = [
    { name: 'unblocked attacker deals its power', keywords: [], attackers: [LOBSTER], blockers: [], defenderLoss: 2, attackersLeft: ['Fire Lobster'], blockersLeft: [] },
    { name: 'flying cannot be blocked by a ground creature', keywords: ['flying'], attackers: [SWAN], blockers: [BEETLE], defenderLoss: 2, attackersLeft: ['Crystal Swan'], blockersLeft: ['Ember Beetle'] },
    { name: 'flying is blocked by a flyer (2/2 trade)', keywords: ['flying'], attackers: [SWAN], blockers: [SWAN], defenderLoss: 0, attackersLeft: [], blockersLeft: [] },
    { name: 'reach blocks flying', keywords: ['flying', 'reach'], attackers: [SWAN], blockers: [SQUID], defenderLoss: 0, attackersLeft: [], blockersLeft: ['Giant Squid'] },
    { name: 'menace gets through when only one blocker is available', keywords: ['menace'], attackers: [SHARK], blockers: [LOBSTER], defenderLoss: 4, attackersLeft: ['Great Shark'], blockersLeft: ['Fire Lobster'] },
    { name: 'menace is blocked by two; damage goes toughest blocker first', keywords: ['menace'], attackers: [SHARK], blockers: [LOBSTER, SQUID], defenderLoss: 0, attackersLeft: [], blockersLeft: ['Fire Lobster'] },
    { name: 'defender cannot attack but blocks', keywords: ['defender'], attackers: [LOBSTER], blockers: [SNAIL], defenderLoss: 0, attackersLeft: ['Fire Lobster'], blockersLeft: ['Armored Snail'] },
    { name: 'defender with reach blocks a flyer', keywords: ['defender', 'reach'], attackers: [SWAN], blockers: [OCTOPUS], defenderLoss: 0, attackersLeft: [], blockersLeft: ['Giant Octopus'] },
    { name: 'trample: damage beyond lethal goes to the defending player', keywords: ['trample'], attackers: [LION], blockers: [BEETLE], defenderLoss: 2, attackersLeft: ['Fire Lion'], blockersLeft: [] },
    { name: 'deathtouch attacker kills a bigger blocker (and dies to it)', keywords: ['deathtouch'], attackers: [SNAKE], blockers: [{ card: LION, abilities: [] }], defenderLoss: 0, attackersLeft: [], blockersLeft: [] },
    { name: 'deathtouch blocker kills a trampling attacker; 1 damage is lethal so 3 trample over', keywords: ['deathtouch', 'trample'], attackers: [LION], blockers: [SNAKE], defenderLoss: 3, attackersLeft: [], blockersLeft: [] },
    { name: 'deathtouch + trample: 1 to each blocker, the rest to the player', keywords: ['deathtouch', 'trample', 'menace'], attackers: [{ card: LION, power: 6, toughness: 6, abilities: ['deathtouch', 'trample', 'menace'] }], blockers: [LOBSTER, SQUID], defenderLoss: 4, attackersLeft: ['Fire Lion'], blockersLeft: [] },
    { name: 'first strike attacker kills its blocker before it strikes back', keywords: ['first_strike'], attackers: [RAM], blockers: [LOBSTER], defenderLoss: 0, attackersLeft: ['Fire Ram'], blockersLeft: [] },
    { name: 'first strike blocker kills the attacker first', keywords: ['first_strike'], attackers: [LOBSTER], blockers: [RAM], defenderLoss: 0, attackersLeft: [], blockersLeft: ['Fire Ram'] },
    { name: 'first strike on both sides trades', keywords: ['first_strike'], attackers: [RAM], blockers: [RAM], defenderLoss: 0, attackersLeft: [], blockersLeft: [] },
    { name: 'deathtouch + first strike blocker kills any attacker unharmed', keywords: ['deathtouch', 'first_strike', 'trample'], attackers: [LION], blockers: [SCORPION], defenderLoss: 0, attackersLeft: [], blockersLeft: ['Death Scorpion'] },
    { name: 'double strike: blocker dies to the first hit; no second hit without trample', keywords: ['double_strike'], attackers: [WEREWOLF], blockers: [LOBSTER], defenderLoss: 0, attackersLeft: ['Werewolf'], blockersLeft: [] },
    { name: 'double strike: both hits land on a tough blocker (4 + 4 vs 7)', keywords: ['double_strike'], attackers: [WEREWOLF], blockers: [{ card: LOBSTER, power: 1, toughness: 7 }], defenderLoss: 0, attackersLeft: ['Werewolf'], blockersLeft: [] },
    { name: 'double strike + trample: blocker dies to the first hit, the second hit all tramples', keywords: ['double_strike', 'trample'], attackers: [{ card: WEREWOLF, abilities: ['double_strike', 'trample'] }], blockers: [BEETLE], defenderLoss: 6, attackersLeft: ['Werewolf'], blockersLeft: [] },
    { name: 'double strike unblocked hits twice', keywords: ['double_strike'], attackers: [WEREWOLF], blockers: [], defenderLoss: 8, attackersLeft: ['Werewolf'], blockersLeft: [] },
    { name: 'lifelink unblocked: controller gains the damage dealt', keywords: ['lifelink'], attackers: [PANDA], blockers: [], defenderLoss: 2, attackerGain: 2, attackersLeft: ['Bamboo Panda'], blockersLeft: [] },
    { name: 'lifelink blocked: gains only the damage the blocker can take (excess is lost)', keywords: ['lifelink'], attackers: [{ card: PANDA, power: 5 }], blockers: [LOBSTER], defenderLoss: 0, attackerGain: 2, attackersLeft: ['Bamboo Panda'], blockersLeft: [] },
    { name: 'lifelink blocker: the defending player gains', keywords: ['lifelink'], attackers: [LOBSTER], blockers: [PANDA], defenderLoss: 0, defenderGain: 2, attackersLeft: [], blockersLeft: ['Bamboo Panda'] },
    { name: 'lifelink + trample: gains for blocker damage and trample damage', keywords: ['lifelink', 'trample'], attackers: [{ card: LION, abilities: ['trample', 'lifelink'] }], blockers: [BEETLE], defenderLoss: 2, attackerGain: 4, attackersLeft: ['Fire Lion'], blockersLeft: [] },
    { name: 'lifelink + double strike unblocked gains twice', keywords: ['lifelink', 'double_strike'], attackers: [{ card: WEREWOLF, abilities: ['double_strike', 'lifelink'] }], blockers: [], defenderLoss: 8, attackerGain: 8, attackersLeft: ['Werewolf'], blockersLeft: [] },
    { name: 'vigilance: attacker stays untapped', keywords: ['vigilance'], attackers: [DEER], blockers: [], defenderLoss: 2, attackersLeft: ['Noble Deer'], blockersLeft: [], attackerTapped: false },
    { name: 'without vigilance the attacker taps', keywords: [], attackers: [LOBSTER], blockers: [], defenderLoss: 2, attackersLeft: ['Fire Lobster'], blockersLeft: [], attackerTapped: true },
    { name: 'unblockable cannot be blocked', keywords: ['unblockable'], attackers: [OTTER], blockers: [LOBSTER], defenderLoss: 2, attackersLeft: ['Otter Scout'], blockersLeft: ['Fire Lobster'] },
    { name: 'hexproof does not affect combat', keywords: ['hexproof', 'defender'], attackers: [LOBSTER], blockers: [TURTLE], defenderLoss: 0, attackersLeft: ['Fire Lobster'], blockersLeft: ['Ancient Turtle'] },
    { name: 'flash has no combat effect', keywords: ['flash'], attackers: [DOLPHIN], blockers: [], defenderLoss: 2, attackersLeft: ['Mystic Dolphin'], blockersLeft: [] },
    { name: 'two attackers: the first in order takes the toughest blocker, the second is unblocked', keywords: ['trample'], attackers: [LION, LOBSTER], blockers: [SQUID], defenderLoss: 3, attackersLeft: ['Fire Lobster'], blockersLeft: [] }
];

// Reads the result in attacker/defender terms so one expectation works for both directions.
function readCombat(page, attackerSide) {
    return page.evaluate(attackerSide => {
        const sides = {
            player: { board: gameState.playerBoard, graveyard: gameState.playerGraveyard, life: gameState.playerLife },
            enemy: { board: gameState.enemyBoard, graveyard: gameState.enemyGraveyard, life: gameState.enemyLife }
        };
        const attacker = sides[attackerSide];
        const defender = sides[attackerSide === 'player' ? 'enemy' : 'player'];
        const names = list => list.filter(c => c.type === 'creature').map(c => c.name).sort();
        const graveyardOk = list => list.every(c => !c.tapped && !c.damage);
        return {
            attackersLeft: names(attacker.board),
            blockersLeft: names(defender.board),
            attackerGraveyard: names(attacker.graveyard),
            defenderGraveyard: names(defender.graveyard),
            graveyardsClean: graveyardOk(attacker.graveyard) && graveyardOk(defender.graveyard),
            attackerLife: attacker.life,
            defenderLife: defender.life,
            attackerTapped: attacker.board.filter(c => c.type === 'creature').map(c => c.tapped)
        };
    }, attackerSide);
}

function nameOf(spec) {
    return { [LOBSTER]: 'Fire Lobster', [BEETLE]: 'Ember Beetle', [SWAN]: 'Crystal Swan', [SQUID]: 'Giant Squid', [SHARK]: 'Great Shark',
        [WEREWOLF]: 'Werewolf', [SNAKE]: 'Venom Snake', [RAM]: 'Fire Ram', [DEER]: 'Noble Deer', [SNAIL]: 'Armored Snail',
        [TURTLE]: 'Ancient Turtle', [OTTER]: 'Otter Scout', [DOLPHIN]: 'Mystic Dolphin', [PANDA]: 'Bamboo Panda',
        [SCORPION]: 'Death Scorpion', [LION]: 'Fire Lion', [OCTOPUS]: 'Giant Octopus', 'creatures-fire-fox': 'Fire Fox'
    }[typeof spec === 'string' ? spec : spec.card];
}

function checkResult(row, result) {
    const dead = (all, left) => {
        const remaining = [...left];
        return all.map(nameOf).filter(name => {
            const i = remaining.indexOf(name);
            if (i >= 0) { remaining.splice(i, 1); return false; }
            return true;
        }).sort();
    };
    assert.equal(20 - result.defenderLife + (row.defenderGain || 0), row.defenderLoss, 'defending player life loss');
    assert.equal(result.attackerLife - 20, row.attackerGain || 0, 'attacking player life gain');
    assert.deepEqual(result.attackersLeft, [...row.attackersLeft].sort(), 'attackers left');
    assert.deepEqual(result.blockersLeft, [...row.blockersLeft].sort(), 'blockers left');
    assert.deepEqual(result.attackerGraveyard, dead(row.attackers, row.attackersLeft), "dead attackers in their owner's graveyard");
    assert.deepEqual(result.defenderGraveyard, dead(row.blockers, row.blockersLeft), "dead blockers in their owner's graveyard");
    assert.ok(result.graveyardsClean, 'graveyard cards are untapped and undamaged');
}

describe('combat table: the player attacks, the AI blocks', () => {
    let session;
    before(async () => {
        session = await openGamePage({ seed: 5 });
        await startMatch(session.page);
    });
    after(() => session.close());

    for (const row of SCENARIOS) {
        test(row.name, { timeout: 30000 }, async () => {
            const { page } = session;
            await setup(page, {
                playerBoard: row.attackers, enemyBoard: row.blockers, enemyHand: [],
                playerGraveyard: [], enemyGraveyard: [], playerLife: 20, enemyLife: 20, hasAttackedThisTurn: false
            });
            await act(page, () => enterAttackPhase());
            await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
            await act(page, () => confirmAttackers());
            const result = await readCombat(page, 'player');
            checkResult(row, result);
            if (row.attackerTapped !== undefined) assert.deepEqual(result.attackerTapped, [row.attackerTapped]);
            const s = await snapshot(page);
            assert.equal(s.phase, 'main', 'back to the main phase');
            assert.equal(s.attackers, 0, 'attacker list cleared');
        });
    }
});

describe('combat table: the AI attacks, the player blocks', () => {
    let session;
    before(async () => {
        session = await openGamePage({ seed: 6 });
        await startMatch(session.page);
        // These rows test combat resolution, not AI judgement: the AI declares every eligible attacker
        // (its real choice would skip the losing attacks; that is tested in tests/ai.test.mjs).
        await session.page.evaluate(() => { window.chooseEnemyAttackers = eligible => eligible; });
    });
    after(() => session.close());

    for (const row of SCENARIOS) {
        test(row.name, { timeout: 30000 }, async () => {
            const { page } = session;
            await setup(page, {
                difficulty: 'hard',
                enemyBoard: row.attackers, playerBoard: row.blockers, enemyHand: [],
                enemyDeck: Array(5).fill('creatures-ancient-dragon'),
                playerGraveyard: [], enemyGraveyard: [], playerLife: 20, enemyLife: 20
            });
            // Read after the whole AI turn: the player's next turn start only clears marked damage and untaps
            // the player's (non-attacking) creatures, which these checks don't look at.
            await passTurn(page);
            const result = await readCombat(page, 'enemy');
            checkResult(row, result);
            if (row.attackerTapped !== undefined) assert.deepEqual(result.attackerTapped, [row.attackerTapped]);
        });
    }
});

// ------------------------------------------------------------------ eligibility and selection

describe('attack eligibility and selection', () => {
    test('tapped, summoning-sick and defender creatures cannot be selected, and the log says why', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            ...{ enemyBoard: [], enemyHand: [] },
            playerBoard: [LOBSTER, { card: BEETLE, tapped: true }, { card: SWAN, summoningSick: true }, SNAIL]
        });
        await act(page, () => enterAttackPhase());
        const reasons = [];
        for (const name of ['Ember Beetle', 'Crystal Swan', 'Armored Snail']) {
            await page.evaluate(n => selectAttacker(window.__rt.find('playerBoard', n).id), name);
            reasons.push(await page.textContent('#gameLog'));
        }
        await act(page, () => selectAttacker(window.__rt.find('playerBoard', 'Fire Lobster').id));
        const attackers = await page.evaluate(() => gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id).name));
        assert.deepEqual(attackers, ['Fire Lobster']);
        assert.match(reasons[0], /tapped/i);
        assert.match(reasons[1], /summoning sickness|can't attack this turn/i);
        assert.match(reasons[2], /defender/i);
    });

    test('haste: a creature cast this turn can attack; one without haste cannot', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyBoard: [], enemyHand: [], playerHand: ['creatures-fire-fox', LOBSTER], playerMana: { fire: 4 } });
        await act(page, () => gameState.playerHand.slice().forEach(c => playCard(c.id)));
        await page.clock.runFor(400);
        await act(page, () => playCard(gameState.playerHand[0]?.id));
        await act(page, () => enterAttackPhase());
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        await act(page, () => confirmAttackers());
        assert.deepEqual((await snapshot(page)).life, [20, 18], 'only the fox attacked');
    });

    test('selecting an attacker twice deselects it; confirming with none cancels the attack', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyBoard: [], enemyHand: [], playerBoard: [LOBSTER] });
        await act(page, () => enterAttackPhase());
        await act(page, () => { const id = gameState.playerBoard[0].id; selectAttacker(id); selectAttacker(id); });
        await act(page, () => confirmAttackers());
        const s = await snapshot(page);
        assert.deepEqual([s.phase, s.life, s.board], ['main', [20, 20], ['Fire Lobster:ready']]);
        assert.equal(await page.evaluate(() => gameState.hasAttackedThisTurn), false, 'cancelling does not use the attack');
    });

    test('a lethal attack ends the match immediately; later attackers do nothing', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyBoard: [], enemyHand: [], enemyLife: 2, playerBoard: [LOBSTER, { card: PANDA }] });
        await act(page, () => enterAttackPhase());
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        await act(page, () => confirmAttackers());
        const s = await snapshot(page);
        assert.equal(s.finalized, true);
        assert.deepEqual(s.life, [20, 0], 'the panda after the lethal hit gains no life');
    });
});

// ------------------------------------------------------------------ keyword details outside the table

describe('keywords outside combat damage', () => {
    test('hexproof: cannot be chosen by an opponent\'s destroy, but is hit by "all creatures" damage', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            enemyBoard: [{ card: TURTLE, toughness: 2 }],
            playerHand: ['spells-curse', 'spells-earthquake'],
            playerMana: { swamp: 3, earth: 4 }
        });
        await act(page, () => playCard(window.__rt.find('playerHand', 'Curse').id));
        assert.deepEqual((await snapshot(page)).enemyBoard, ['Ancient Turtle:ready'], 'Curse finds no legal target');
        await act(page, () => playCard(window.__rt.find('playerHand', 'Earthquake').id));
        assert.deepEqual((await snapshot(page)).enemyBoard, [], 'Earthquake still hits it');
    });

    test('flash: no effect yet; a flash creature follows normal timing and summoning sickness', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { ...{ enemyBoard: [], enemyHand: [], enemyDeck: Array(5).fill('creatures-ancient-dragon') }, playerHand: [DOLPHIN], playerMana: { water: 2 } });
        await act(page, () => endTurn());
        await page.clock.runFor(100);
        await page.evaluate(() => playCard(gameState.playerHand[0].id));
        assert.equal((await snapshot(page)).board.length, 0, 'cannot be cast on the enemy turn');
        await page.clock.runFor(12000);
        await setup(page, { playerMana: { water: 2 } });
        await act(page, () => playCard(window.__rt.find('playerHand', 'Mystic Dolphin').id));
        await act(page, () => enterAttackPhase());
        assert.equal((await snapshot(page)).phase, 'main', 'no eligible attacker: the dolphin is summoning sick');
    });

    test('granted keywords apply only to the creature that received them', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerBoard: [LOBSTER], playerHand: ['spells-feather', LOBSTER], playerMana: { light: 1 },
            enemyBoard: [LOBSTER]
        });
        await act(page, () => playCard(window.__rt.find('playerHand', 'Feather').id));
        const abilities = await page.evaluate(() => ({
            buffed: gameState.playerBoard[0].abilities,
            inHand: gameState.playerHand[0].abilities,
            enemy: gameState.enemyBoard[0].abilities,
            catalog: window.__CARD_BY_ID['creatures-fire-lobster'].abilities
        }));
        assert.deepEqual(abilities, { buffed: ['flying'], inHand: [], enemy: [], catalog: [] });
    });

    test('haste granted after a creature arrives lets it attack that turn (Footsteps)', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyBoard: [], enemyHand: [], playerHand: [LOBSTER, 'artifacts-footsteps'], playerMana: { fire: 2 } });
        await act(page, () => playCard(window.__rt.find('playerHand', 'Fire Lobster').id));
        await act(page, () => playCard(window.__rt.find('playerHand', 'Footsteps').id));
        await act(page, () => enterAttackPhase());
        await act(page, () => selectAttacker(window.__rt.find('playerBoard', 'Fire Lobster').id));
        await act(page, () => confirmAttackers());
        assert.deepEqual((await snapshot(page)).life, [20, 18]);
    });

    test('Surf grants unblockable', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER], playerHand: ['spells-surf'], playerMana: { water: 2 }, enemyBoard: [SQUID], enemyHand: [] });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await act(page, () => enterAttackPhase());
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        await act(page, () => confirmAttackers());
        assert.deepEqual((await snapshot(page)).life, [20, 16], '4/4 Surf-boosted lobster is not blocked by the squid');
    });
});

// ------------------------------------------------------------------ death, graveyards and cleanup

describe('death, graveyards and cleanup', () => {
    test('surviving damage wears off between turns; dead creatures go to their owner\'s graveyard', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [{ card: LOBSTER, power: 1 }], enemyBoard: [SQUID], enemyHand: [], enemyDeck: Array(5).fill('creatures-ancient-dragon') });
        await act(page, () => enterAttackPhase());
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        await act(page, () => confirmAttackers());
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].damage), 1, 'squid keeps 1 damage this turn');
        assert.deepEqual(await page.evaluate(() => gameState.playerGraveyard.map(c => c.name)), ['Fire Lobster']);
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].damage), 0, 'damage cleared after the turn');
    });

    test('tokens that die go to the graveyard (house rule)', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-summon-spirits'], playerMana: { swamp: 3 }, enemyBoard: [], enemyHand: [] });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await act(page, () => { gameState.playerBoard.forEach(c => { c.damage = 5; }); checkStateBasedActions(); });
        const graveyard = await page.evaluate(() => gameState.playerGraveyard.map(c => c.name));
        assert.deepEqual(graveyard, ['Summon Spirits', 'Spirit Token', 'Spirit Token']);
    });

    test('revive returns the most recent creature, never an instant or artifact', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerGraveyard: [LOBSTER, 'spells-fireball', 'artifacts-mana-gem'],
            playerHand: ['spells-necromancy'], playerMana: { swamp: 4 }
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        const s = await page.evaluate(() => ({
            board: gameState.playerBoard.map(c => `${c.name}:${c.summoningSick ? 'sick' : 'ready'}`),
            graveyard: gameState.playerGraveyard.map(c => c.name)
        }));
        assert.deepEqual(s.board, ['Fire Lobster:sick']);
        assert.deepEqual(s.graveyard, ['Fireball', 'Mana Gem', 'Necromancy']);
    });
});

// ------------------------------------------------------------------ keyword coverage and UI text

describe('keyword coverage and explanations', () => {
    test('every keyword in CARD_DATABASE is covered by a scenario and has a rules explanation', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const keywords = await page.evaluate(() => [...new Set(window.__ALL_CARDS.flatMap(c => [...(c.abilities || []), ...(c.grantAbilities || [])]))].sort());
        const tested = new Set([...SCENARIOS.flatMap(row => row.keywords), 'hexproof', 'flash', 'unblockable', 'haste']);
        assert.deepEqual(keywords.filter(k => !tested.has(k)), [], 'keywords without a combat scenario');
        const explained = await page.evaluate(() => typeof KEYWORD_RULES === 'object' ? Object.keys(KEYWORD_RULES).sort() : []);
        assert.deepEqual(keywords.filter(k => !explained.includes(k)), [], 'keywords without an explanation');
    });

    test('card details explain each keyword with the same text as the rules table', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const shown = await page.evaluate(() => {
            showCardDetail(window.__CARD_BY_ID['creatures-death-scorpion']);
            return document.getElementById('detailContent').textContent.replace(/\s+/g, ' ');
        });
        for (const key of ['deathtouch', 'first_strike']) {
            const rule = await page.evaluate(k => KEYWORD_RULES[k], key);
            assert.ok(shown.includes(rule.label) && shown.includes(rule.text), `${key} explained in card details`);
        }
        const flash = await page.evaluate(() => { showCardDetail(window.__CARD_BY_ID['creatures-mystic-dolphin']); return document.getElementById('detailContent').textContent; });
        assert.match(flash, /no effect/i, 'flash is labelled as not active');
    });

    test('board badges are distinct per keyword and carry the keyword name', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const all = ['flying', 'reach', 'trample', 'lifelink', 'haste', 'vigilance', 'defender', 'deathtouch', 'first_strike', 'double_strike', 'hexproof', 'menace', 'flash', 'unblockable'];
        await setup(page, { playerBoard: [{ card: LOBSTER, abilities: all }] });
        await page.clock.runFor(50);
        const badges = await page.$$eval('#playerBoard .ability-icon', els => els.map(el => ({ text: el.textContent, title: el.title })));
        assert.equal(badges.length, all.length);
        assert.equal(new Set(badges.map(b => b.text)).size, all.length, `badges must be distinct: ${badges.map(b => b.text).join(' ')}`);
        const labels = await page.evaluate(() => Object.fromEntries(Object.entries(KEYWORD_RULES).map(([k, r]) => [k, r.label])));
        assert.deepEqual(badges.map(b => b.title.split(':')[0]), all.map(k => labels[k]));
    });

    test('How To Play lists every keyword with the rules-table text', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const listed = await page.evaluate(() => { showHowToPlay(); return document.getElementById('howToPlayScreen').textContent.replace(/\s+/g, ' '); });
        const rules = await page.evaluate(() => Object.values(KEYWORD_RULES));
        for (const rule of rules) assert.ok(listed.includes(rule.label) && listed.includes(rule.text), `How To Play explains ${rule.label}`);
    });
});
