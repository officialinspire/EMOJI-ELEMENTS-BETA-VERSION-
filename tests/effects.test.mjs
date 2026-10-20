// Spell and artifact effects for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/effects.test.mjs        (or: npm run effects)
//
// Part 1 casts every instant and artifact in CARD_DATABASE twice, once by the player (playCard) and once
// by the AI (aiPlayCard, the AI's own play path), on the same mirrored board, and checks the exact result
// for its effect. Part 2 covers timing and persistence: upkeep effects, mana artifacts, "until end of
// turn", Deep Freeze, cards leaving the battlefield, hexproof, empty zones and lethal effects.
// The rules are written down in EFFECTS.md.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGamePage, openGame, startMatch, act, setup, passTurn, finishEnemyTurn } from './lib/game.mjs';

useGameBrowser();

const LOBSTER = 'creatures-fire-lobster';          // 2/2
const WITCH_CAT = 'creatures-witch-cat';           // 2/2 hexproof
const LION = 'creatures-fire-lion';                // 4/3 trample
const BEETLE = 'creatures-ember-beetle';           // 1/2
const GHOST = 'creatures-restless-ghost';          // 2/1 flying, hexproof
const DEER = 'creatures-noble-deer';               // 2/2 vigilance
const SNAIL = 'creatures-armored-snail';           // 0/3 defender
const DRAGON = 'creatures-ancient-dragon';         // 6/6, never castable here (no lands)
const FIREBALL = 'spells-fireball';
const PEAK = 'lands-volcanic-peak';
const GROVE = 'lands-ancient-grove';

// Every instant and artifact id, so each gets its own named test. 'the per-card list matches the catalog'
// fails if a card is added or removed without updating this list.
const EFFECT_CARD_IDS = [
    'spells-fireball', 'spells-explosion', 'spells-inferno', 'spells-meteor-strike', 'spells-flame-jet', 'spells-anger',
    'spells-freeze', 'spells-tsunami', 'spells-bubble-shield', 'spells-healing-rain', 'spells-whirlpool', 'spells-deep-freeze',
    'spells-surf', 'spells-coral-shield', 'spells-earthquake', 'spells-growth', 'spells-tangling-roots', 'spells-avalanche',
    'spells-harvest', 'spells-wrestle', 'spells-mushroom-power', 'spells-curse', 'spells-drain-life', 'spells-poison',
    'spells-necromancy', 'spells-terror', 'spells-heal', 'spells-divine-smite', 'spells-blessing', 'spells-light-beam',
    'spells-resurrection', 'spells-in-the-clouds', 'spells-meditate', 'spells-feather', 'spells-summon-spirits',
    'spells-raise-army', 'spells-call-of-the-forest', 'spells-web-trap', 'spells-comet-strike', 'spells-mind-rot',
    'spells-thought-steal',
    'artifacts-flaming-sword', 'artifacts-earth-shield', 'artifacts-crown-of-power', 'artifacts-mana-gem', 'artifacts-bomb',
    'artifacts-holy-chalice', 'artifacts-dark-scroll', 'artifacts-cursed-orb', 'artifacts-war-horn', 'artifacts-protective-amulet',
    'artifacts-magic-ring', 'artifacts-heavy-armor', 'artifacts-battle-axe', 'artifacts-elven-bow', 'artifacts-magic-wand',
    'artifacts-halo', 'artifacts-dna-sequence', 'artifacts-fingerprint-scanner', 'artifacts-footsteps', 'artifacts-prism-core',
    'artifacts-gravity-boots', 'artifacts-chrono-watch', 'artifacts-nano-shield', 'artifacts-signal-tower', 'artifacts-mech-claw',
    'artifacts-aether-lens', 'artifacts-repair-drone', 'artifacts-void-compass', 'artifacts-relic-cache'
];

// Upkeep and activated artifacts stay on the battlefield; everything else is used up when it resolves.
const PERSISTENT_ARTIFACT_EFFECTS = ['draw', 'heal', 'damage', 'mana'];
const isPersistent = card => card.type === 'artifact' && PERSISTENT_ARTIFACT_EFFECTS.includes(card.effect);

// The mirrored board for part 1, from the caster's point of view.
//   mine: Fire Lobster 2/2, Witch Cat 2/2 hexproof; graveyard Fire Lion then Fireball; 2 cards in hand.
//   theirs: Ember Beetle 1/2 (untapped), Restless Ghost 2/1 hexproof (untapped), Noble Deer 2/2 (tapped).
function mirroredBoard(casterSide, cardId, cost) {
    const mine = {
        Hand: [cardId, PEAK, PEAK],
        Board: [LOBSTER, WITCH_CAT],
        Graveyard: [LION, FIREBALL],
        Deck: Array(10).fill(DRAGON)
    };
    const theirs = {
        Hand: [DRAGON, DRAGON, DRAGON],
        Board: [BEETLE, GHOST, { card: DEER, tapped: true }],
        Graveyard: [],
        Deck: Array(10).fill(DRAGON)
    };
    const [me, them] = casterSide === 'player' ? ['player', 'enemy'] : ['enemy', 'player'];
    const spec = { playerLife: 20, enemyLife: 20, playerMana: {}, enemyMana: {} };
    for (const zone of Object.keys(mine)) {
        spec[`${me}${zone}`] = mine[zone];
        spec[`${them}${zone}`] = theirs[zone];
    }
    spec[`${me}Mana`] = { ...cost };
    return spec;
}

// Reads both sides as "me" (the caster) and "them".
function readSides(page, casterSide) {
    return page.evaluate(casterSide => {
        const side = prefix => ({
            life: gameState[`${prefix}Life`],
            hand: gameState[`${prefix}Hand`].map(c => c.name),
            deck: gameState[`${prefix}Deck`].length,
            creatures: gameState[`${prefix}Board`].filter(c => c.type === 'creature').map(c => ({
                name: c.name, power: c.power, toughness: c.toughness, tapped: !!c.tapped,
                abilities: [...(c.abilities || [])].sort()
            })),
            artifacts: gameState[`${prefix}Board`].filter(c => c.type === 'artifact').map(c => c.name),
            graveyard: gameState[`${prefix}Graveyard`].map(c => c.name)
        });
        const them = casterSide === 'player' ? 'enemy' : 'player';
        return { me: side(casterSide), them: side(them), finalized: gameState.matchFinalized };
    }, casterSide);
}

// Casts the card in the caster's hand through that side's real play path.
async function castFromHand(page, casterSide, name) {
    await act(page, ({ casterSide, name }) => {
        if (casterSide === 'player') {
            playCard(gameState.playerHand.find(c => c.name === name).id);
        } else {
            aiPlayCard(gameState.enemyHand.find(c => c.name === name));
        }
    }, { casterSide, name });
}

const count = (list, name) => list.filter(n => n === name).length;
const names = creatures => creatures.map(c => c.name).sort();
const byName = (creatures, name) => creatures.find(c => c.name === name);

// The expected result of each effect on the mirrored board (before → after).
function checkEffect(card, b, a) {
    const v = card.value;
    const handDelta = a.me.hand.length - (b.me.hand.length - 1);
    const unchangedCreatures = side => assert.deepEqual(a[side].creatures, b[side].creatures, `${side} creatures unchanged`);

    // One-shot cards end in the graveyard exactly once; persistent artifacts stay on the board.
    if (isPersistent(card)) {
        assert.equal(count(a.me.artifacts, card.name), 1, 'artifact stays on the battlefield');
        assert.equal(count(a.me.graveyard, card.name), 0, 'artifact not in the graveyard');
    } else {
        assert.equal(count(a.me.graveyard, card.name) - count(b.me.graveyard, card.name), 1, 'card goes to the graveyard once');
        assert.equal(count(a.me.artifacts, card.name), 0, 'one-shot card not left on the battlefield');
    }

    if (isPersistent(card)) {
        // Nothing happens when it is played: draw/heal/damage wait for upkeep; mana waits for a tap.
        assert.deepEqual([a.me.life, a.them.life, handDelta], [20, 20, 0], 'no effect on the turn it is played');
        unchangedCreatures('me');
        unchangedCreatures('them');
        return;
    }

    switch (card.effect) {
        case 'damage':
            if (card.target === 'all') {
                // Every creature on both sides takes the damage; all of them have toughness <= 2 here.
                assert.deepEqual(names(a.me.creatures), [], 'your creatures are hit too');
                assert.deepEqual(names(a.them.creatures), [], 'enemy creatures are hit, hexproof included');
                assert.deepEqual([a.me.life, a.them.life], [20, 20]);
            } else {
                assert.deepEqual([a.me.life, a.them.life], [20, 20 - v], 'damage goes to the opponent');
                unchangedCreatures('them');
            }
            break;
        case 'heal':
            assert.deepEqual([a.me.life, a.them.life], [20 + v, 20]);
            break;
        case 'heal_draw':
            assert.deepEqual([a.me.life, handDelta], [20 + v, card.drawCards]);
            break;
        case 'draw':
        case 'draw_on_play':
            assert.equal(handDelta, v, `draws ${v}`);
            assert.equal(a.me.deck, b.me.deck - v);
            break;
        case 'drain':
            assert.deepEqual([a.me.life, a.them.life], [20 + v, 20 - v]);
            break;
        case 'destroy': {
            const gone = names(b.them.creatures).filter(n => !names(a.them.creatures).includes(n));
            assert.equal(gone.length, 1, 'exactly one creature destroyed');
            assert.ok(['Ember Beetle', 'Noble Deer'].includes(gone[0]), `never the hexproof Restless Ghost (got ${gone[0]})`);
            assert.deepEqual(a.them.graveyard, gone, 'destroyed creature goes to its owner\'s graveyard');
            break;
        }
        case 'buff':
        case 'buff_defense': {
            const dp = card.effect === 'buff' ? v : 0;
            const dt = card.effect === 'buff' && card.buffType !== 'power' ? v : (card.effect === 'buff_defense' ? v : 0);
            const grants = card.grantAbilities || [];
            const changed = b.me.creatures.filter(before => {
                const after = byName(a.me.creatures, before.name);
                return JSON.stringify(after) !== JSON.stringify(before);
            });
            assert.equal(changed.length, card.targetAll ? 2 : 1, card.targetAll ? 'all your creatures' : 'one of your creatures (hexproof allowed)');
            for (const before of changed) {
                const after = byName(a.me.creatures, before.name);
                assert.deepEqual([after.power, after.toughness], [before.power + dp, before.toughness + dt], `${before.name} gets +${dp}/+${dt}`);
                assert.deepEqual(after.abilities, [...new Set([...before.abilities, ...grants])].sort(), 'granted keywords');
            }
            unchangedCreatures('them');
            break;
        }
        case 'tap': {
            // Only the untapped, non-hexproof Ember Beetle can be chosen.
            const tapped = Object.fromEntries(a.them.creatures.map(c => [c.name, c.tapped]));
            assert.deepEqual(tapped, { 'Ember Beetle': true, 'Restless Ghost': false, 'Noble Deer': true });
            break;
        }
        case 'bounce':
            assert.deepEqual(names(a.them.creatures), ['Restless Ghost'], 'hexproof creature stays');
            assert.deepEqual(a.them.hand.slice(-2).sort(), ['Ember Beetle', 'Noble Deer'], 'up to 2 creatures return to hand');
            break;
        case 'revive':
            assert.deepEqual(names(a.me.creatures), ['Fire Lion', 'Fire Lobster', 'Witch Cat']);
            assert.deepEqual(a.me.graveyard.filter(n => n !== card.name), ['Fireball'], 'the creature leaves the graveyard');
            break;
        case 'aoe':
            assert.deepEqual(names(a.them.creatures), [], `${v} damage to each enemy creature, hexproof included`);
            unchangedCreatures('me');
            break;
        case 'token': {
            const tokens = a.me.creatures.filter(c => !b.me.creatures.some(old => old.name === c.name));
            assert.equal(tokens.length, v, `${v} tokens`);
            assert.ok(tokens.every(t => t.name === tokens[0].name && /Token$/.test(t.name)));
            break;
        }
        case 'discard':
            assert.equal(a.them.hand.length, b.them.hand.length - Math.min(v, b.them.hand.length));
            assert.equal(a.them.graveyard.length, Math.min(v, b.them.hand.length));
            break;
        case 'discard_draw':
            assert.equal(a.them.hand.length, b.them.hand.length - v);
            assert.equal(handDelta, v);
            break;
        default:
            assert.fail(`no expectation for effect ${card.effect}`);
    }
}

// ------------------------------------------------------------------ part 1: every card, both casters

for (const casterSide of ['player', 'enemy']) {
    describe(`every instant and artifact, cast by the ${casterSide === 'player' ? 'player' : 'AI'}`, () => {
        let page;
        let close;
        let cards;
        before(async () => {
            ({ page, close } = await openGamePage({ seed: 7 }));
            await startMatch(page);
            cards = await page.evaluate(() => window.__ALL_CARDS
                .filter(c => c.type === 'instant' || c.type === 'artifact')
                .map(({ __id, name, type, effect, value, target, targetAll, buffType, grantAbilities, drawCards, tokenType, cost }) =>
                    ({ id: __id, name, type, effect, value, target, targetAll, buffType, grantAbilities, drawCards, tokenType, cost })));
        });
        after(() => close());

        test('the catalog has instants and artifacts to check', () => {
            assert.ok(cards.length >= 70, `${cards.length} effect cards`);
        });

        // node:test registers tests synchronously, so the per-card list comes from a fixed id list that a
        // separate test keeps in step with the catalog.
        for (const id of EFFECT_CARD_IDS) {
            test(id, { timeout: 30000 }, async () => {
                const card = cards.find(c => c.id === id);
                assert.ok(card, `${id} is in the catalog`);
                await setup(page, mirroredBoard(casterSide, id, card.cost));
                const before = await readSides(page, casterSide);
                await castFromHand(page, casterSide, card.name);
                const after = await readSides(page, casterSide);
                assert.equal(after.finalized, false, 'match continues');
                checkEffect(card, before, after);
            });
        }

        test('the per-card list matches the catalog', () => {
            assert.deepEqual([...EFFECT_CARD_IDS].sort(), cards.map(c => c.id).sort());
        });
    });
}

// ------------------------------------------------------------------ part 2: timing and persistence

describe('upkeep artifacts', () => {
    test('heal, damage and draw artifacts act once at their owner\'s upkeep, every turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerLife: 15, enemyLife: 15,
            playerHand: [], playerBoard: ['artifacts-holy-chalice', 'artifacts-cursed-orb', 'artifacts-crown-of-power'],
            playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: ['artifacts-repair-drone', 'artifacts-signal-tower'], enemyDeck: Array(10).fill(DRAGON)
        });
        await act(page, () => endTurn());
        await page.clock.runFor(1600); // the AI turn has started: its upkeep only
        assert.deepEqual(await page.evaluate(() => [gameState.playerLife, gameState.enemyLife]), [14, 16], 'AI upkeep: Repair Drone +1, Signal Tower -1');
        await finishEnemyTurn(page);
        const one = await page.evaluate(() => [gameState.playerLife, gameState.enemyLife, gameState.playerHand.length]);
        assert.deepEqual(one, [15, 15, 2], 'your upkeep: Chalice +1, Orb -1, Crown 1 extra card');
        await passTurn(page);
        const two = await page.evaluate(() => [gameState.playerLife, gameState.enemyLife, gameState.playerHand.length]);
        assert.deepEqual(two, [15, 15, 4], 'same again next turn, no stacking');
    });

    test('two copies each count; a removed artifact stops at once', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerLife: 10, playerBoard: ['artifacts-holy-chalice', 'artifacts-holy-chalice'], playerHand: [],
            playerDeck: Array(10).fill(DRAGON), ...{ enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON) }
        });
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.playerLife), 12);
        await act(page, () => sendBoardCardToGraveyard(gameState.playerBoard[0].id, 'player'));
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.playerLife), 13, 'only the copy still on the battlefield heals');
    });

    test('upkeep damage can win or lose the match, and nothing acts afterwards', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerLife: 10, enemyLife: 1, playerHand: [], playerBoard: ['artifacts-cursed-orb'], playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON)
        });
        await passTurn(page);
        assert.deepEqual(await page.evaluate(() => [gameState.matchFinalized, gameState.enemyLife]), [true, 0], 'Cursed Orb wins at your upkeep');

        const page2 = await openGame(t);
        await startMatch(page2);
        await setup(page2, {
            playerLife: 1, enemyLife: 20, playerHand: [], playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: ['artifacts-signal-tower', 'artifacts-repair-drone'], enemyDeck: Array(10).fill(DRAGON)
        });
        await passTurn(page2);
        const s = await page2.evaluate(() => [gameState.matchFinalized, gameState.playerLife, gameState.enemyLife]);
        assert.deepEqual(s, [true, 0, 20], 'Signal Tower wins for the AI; Repair Drone does not heal after the match ends');
    });

    test('one-shot artifacts resolve once and never again at upkeep', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerHand: ['artifacts-dna-sequence'], playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON)
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await page.evaluate(() => gameState.playerHand.length), 1, 'draws 1 when played');
        await passTurn(page);
        const s = await page.evaluate(() => ({
            hand: gameState.playerHand.length,
            board: gameState.playerBoard.map(c => c.name),
            graveyard: gameState.playerGraveyard.map(c => c.name)
        }));
        assert.deepEqual(s, { hand: 2, board: [], graveyard: ['DNA Sequence'] }, 'only the normal draw next turn');
    });
});

describe('mana artifacts', () => {
    test('tap once per turn for colourless mana; the mana empties at end of turn; untaps next turn', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerHand: [], playerBoard: ['artifacts-mana-gem'], playerMana: {}, playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON)
        });
        const id = await page.evaluate(() => gameState.playerBoard[0].id);
        await act(page, id => activateArtifact(id), id);
        await act(page, id => activateArtifact(id), id);
        assert.deepEqual(await page.evaluate(() => [gameState.playerMana.colorless, gameState.playerBoard[0].tapped]), [1, true], 'one mana per turn');
        await passTurn(page);
        assert.deepEqual(await page.evaluate(() => [gameState.playerMana.colorless || 0, gameState.playerBoard[0].tapped]), [0, false]);
    });

    test('the AI taps its mana artifacts too', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        // 1 land + Mana Gem = 2 mana: enough for Prism Core (2 colourless) only if the Gem is used.
        await setup(page, {
            difficulty: 'easy', playerHand: [], playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: ['artifacts-prism-core'], enemyBoard: [PEAK, 'artifacts-mana-gem'], enemyDeck: Array(10).fill(DRAGON)
        });
        await passTurn(page);
        const board = await page.evaluate(() => gameState.enemyBoard.map(c => c.name));
        assert.ok(board.includes('Prism Core'), `AI cast Prism Core using its Mana Gem (board: ${board})`);
    });
});

describe('temporary and lasting effects', () => {
    test('Anger: +3/+0 until end of turn, for the player', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER], playerHand: ['spells-anger'], playerMana: { fire: 2 }, enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON) });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await page.evaluate(() => gameState.playerBoard[0].power), 5, '5 power this turn');
        await act(page, () => endTurn());
        assert.equal(await page.evaluate(() => gameState.playerBoard[0].power), 2, 'back to 2 when the turn ends');
    });

    test('Anger cast by the AI pumps its attacker for that turn only', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            difficulty: 'hard', playerLife: 20, playerHand: [], playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: ['spells-anger'], enemyBoard: [PEAK, PEAK, LOBSTER], enemyDeck: Array(10).fill(DRAGON)
        });
        await passTurn(page);
        const s = await page.evaluate(() => [gameState.playerLife, gameState.enemyBoard.find(c => c.name === 'Fire Lobster').power]);
        assert.deepEqual(s, [15, 2], 'hit for 5, back to 2 on your turn');
    });

    test('Deep Freeze: the creature does not untap at its controller\'s next untap', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerHand: ['spells-deep-freeze'], playerMana: { water: 3 }, playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [SNAIL], enemyDeck: Array(10).fill(DRAGON)
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].tapped), true);
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].tapped), true, 'still tapped after the AI\'s untap');
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].tapped), false, 'untaps the turn after');
    });

    test('Deep Freeze picks an untapped creature first, else freezes a tapped one', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerHand: ['spells-deep-freeze'], playerMana: { water: 3 }, playerBoard: [], playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [{ card: SNAIL, tapped: true }], enemyDeck: Array(10).fill(DRAGON)
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await passTurn(page);
        assert.equal(await page.evaluate(() => gameState.enemyBoard[0].tapped), true, 'a tapped creature is frozen too');
    });

    test('equipment: the bonus stays after the artifact is used up; leaving play ends it', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerBoard: [LOBSTER], playerHand: ['artifacts-battle-axe'], playerMana: { fire: 3 }, playerDeck: Array(10).fill(DRAGON),
            enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON)
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await passTurn(page);
        const s = await page.evaluate(() => ({ lobster: gameState.playerBoard.map(c => `${c.name} ${c.power}/${c.toughness}`), graveyard: gameState.playerGraveyard.map(c => c.name) }));
        assert.deepEqual(s, { lobster: ['Fire Lobster 5/2'], graveyard: ['Battle Axe'] });
        await act(page, () => resolveSpell(window.__CARD_BY_ID['spells-tsunami'], 'enemy'));
        const hand = await page.evaluate(() => gameState.playerHand.filter(c => c.name === 'Fire Lobster').map(c => `${c.power}/${c.toughness}`));
        assert.deepEqual(hand, ['2/2'], 'returns to hand as the printed card');
    });

    test('a creature that leaves the battlefield returns to its printed card (bounce, death, revive)', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER], playerHand: [], playerGraveyard: [], enemyHand: [], enemyBoard: [], enemyDeck: Array(10).fill(DRAGON) });
        const buff = () => act(page, () => {
            resolveSpell(window.__CARD_BY_ID['spells-growth'], 'player');
            resolveSpell(window.__CARD_BY_ID['spells-feather'], 'player');
            resolveSpell(window.__CARD_BY_ID['spells-anger'], 'player');
        });
        await buff();
        assert.deepEqual(await page.evaluate(() => gameState.playerBoard.map(c => `${c.power}/${c.toughness}`)), ['8/5']);

        await act(page, () => resolveSpell(window.__CARD_BY_ID['spells-tsunami'], 'enemy'));
        assert.deepEqual(await page.evaluate(() => gameState.playerHand.map(c => `${c.name} ${c.power}/${c.toughness} [${(c.abilities || []).join(',')}]`)),
            ['Fire Lobster 2/2 []'], 'bounced: printed again');

        await setup(page, { playerBoard: [LOBSTER], playerHand: [], playerGraveyard: [] });
        await buff();
        await act(page, () => resolveSpell(window.__CARD_BY_ID['spells-curse'], 'enemy'));
        assert.deepEqual(await page.evaluate(() => gameState.playerGraveyard.map(c => `${c.name} ${c.power}/${c.toughness} [${(c.abilities || []).join(',')}]`)),
            ['Fire Lobster 2/2 []'], 'destroyed: printed in the graveyard');
        await act(page, () => resolveSpell(window.__CARD_BY_ID['spells-necromancy'], 'player'));
        assert.deepEqual(await page.evaluate(() => gameState.playerBoard.map(c => `${c.name} ${c.power}/${c.toughness} [${(c.abilities || []).join(',')}]`)),
            ['Fire Lobster 2/2 []'], 'revived: printed');
    });

    test('a granted keyword is never listed twice; stat bonuses do stack', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER], playerHand: ['spells-feather', 'spells-feather'], playerMana: { light: 2 } });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await act(page, () => playCard(gameState.playerHand[0].id));
        const c = await page.evaluate(() => { const l = gameState.playerBoard[0]; return [l.power, l.toughness, l.abilities]; });
        assert.deepEqual(c, [4, 4, ['flying']]);
    });

    test('tokens are separate creatures: a bonus on one does not reach the others or the catalog', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerBoard: [], playerHand: ['spells-raise-army', 'artifacts-gravity-boots'], playerMana: { fire: 4, colorless: 2 } });
        await act(page, () => playCard(gameState.playerHand.find(c => c.name === 'Raise Army').id));
        await act(page, () => playCard(gameState.playerHand.find(c => c.name === 'Gravity Boots').id));
        const s = await page.evaluate(() => gameState.playerBoard.map(c => `${c.power}/${c.toughness} ${(c.abilities || []).join(',')}`).sort());
        assert.deepEqual(s, ['1/1 ', '1/1 ', '2/1 haste']);
        assert.deepEqual(await page.evaluate(() => window.__CARD_BY_ID['artifacts-gravity-boots'].grantAbilities), ['haste']);
    });

    test('Thought Steal draws even when the opponent has no cards to discard', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-thought-steal'], playerMana: { swamp: 3 }, playerDeck: Array(5).fill(DRAGON), enemyHand: [] });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await page.evaluate(() => gameState.playerHand.length), 1, 'you draw 1');
    });
});

describe('sweepers', () => {
    test('Earthquake hits every creature on both sides; Bomb hits only enemy creatures', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, {
            playerBoard: [LOBSTER, LION], playerHand: ['spells-earthquake'], playerMana: { earth: 4 },
            enemyBoard: [BEETLE, { card: LION }], enemyHand: []
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        const s = await page.evaluate(() => [gameState.playerBoard.map(c => `${c.name} ${c.damage}`), gameState.enemyBoard.map(c => `${c.name} ${c.damage}`)]);
        assert.deepEqual(s, [['Fire Lion 2'], ['Fire Lion 2']], '2/2s die on both sides, the 4/3s survive damaged');

        await setup(page, { playerBoard: [LOBSTER], playerHand: ['artifacts-bomb'], playerMana: { fire: 3 }, enemyBoard: [BEETLE], enemyHand: [] });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.deepEqual(await page.evaluate(() => [gameState.playerBoard.map(c => c.name), gameState.enemyBoard.map(c => c.name)]), [['Fire Lobster'], []]);
    });

    test('the AI only casts a two-sided sweeper when it kills more of your creatures than its own', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const board = { difficulty: 'hard', playerHand: [], playerDeck: Array(10).fill(DRAGON), enemyHand: ['spells-earthquake'], enemyGraveyard: [], enemyDeck: Array(10).fill(DRAGON) };
        await setup(page, { ...board, playerBoard: [BEETLE], enemyBoard: [GROVE, GROVE, GROVE, GROVE, { card: SNAIL, toughness: 2 }, { card: SNAIL, toughness: 2 }] });
        await passTurn(page);
        assert.deepEqual(await page.evaluate(() => gameState.enemyHand.map(c => c.name).filter(n => n === 'Earthquake')), ['Earthquake'], 'held: it would lose 2 for 1');

        await setup(page, { ...board, playerBoard: [LOBSTER, BEETLE], enemyBoard: [GROVE, GROVE, GROVE, GROVE] });
        await passTurn(page);
        const s = await page.evaluate(() => [gameState.playerBoard.filter(c => c.type === 'creature').length, gameState.enemyGraveyard.map(c => c.name)]);
        assert.deepEqual(s, [0, ['Earthquake']], 'cast: kills 2 of yours, none of its own');
    });
});

describe('hexproof and empty zones', () => {
    for (const casterSide of ['player', 'enemy']) {
        const who = casterSide === 'player' ? 'player' : 'AI';
        test(`hexproof stops only the opponent's destroy, tap and bounce (cast by the ${who})`, { timeout: 60000 }, async t => {
            const page = await openGame(t);
            await startMatch(page);
            const [me, them] = casterSide === 'player' ? ['player', 'enemy'] : ['enemy', 'player'];
            const results = {};
            for (const id of ['spells-curse', 'spells-freeze', 'spells-deep-freeze', 'spells-tsunami', 'spells-growth', 'artifacts-bomb']) {
                await setup(page, { [`${me}Board`]: [WITCH_CAT], [`${them}Board`]: [WITCH_CAT], [`${me}Hand`]: [], [`${them}Hand`]: [], [`${me}Graveyard`]: [], [`${them}Graveyard`]: [] });
                results[id] = await page.evaluate(({ id, casterSide, me, them }) => {
                    resolveSpell(window.__CARD_BY_ID[id], casterSide);
                    checkStateBasedActions();
                    const show = board => board.map(c => `${c.power}/${c.toughness}${c.tapped ? ' tapped' : ''}`).join(',');
                    return `mine ${show(gameState[`${me}Board`])} | theirs ${show(gameState[`${them}Board`])}`;
                }, { id, casterSide, me, them });
            }
            assert.deepEqual(results, {
                'spells-curse': 'mine 2/2 | theirs 2/2',
                'spells-freeze': 'mine 2/2 | theirs 2/2',
                'spells-deep-freeze': 'mine 2/2 | theirs 2/2',
                'spells-tsunami': 'mine 2/2 | theirs 2/2',
                'spells-growth': 'mine 4/4 | theirs 2/2',
                'artifacts-bomb': 'mine 2/2 | theirs '
            });
        });

        test(`every effect on empty boards, hands and graveyards is harmless (cast by the ${who})`, { timeout: 120000 }, async t => {
            const page = await openGame(t);
            await startMatch(page);
            const ids = await page.evaluate(() => window.__ALL_CARDS.filter(c => c.type === 'instant' || c.type === 'artifact').map(c => c.__id));
            const problems = [];
            for (const id of ids) {
                await setup(page, {
                    playerBoard: [], enemyBoard: [], playerHand: [], enemyHand: [], playerGraveyard: [], enemyGraveyard: [],
                    playerDeck: Array(5).fill(DRAGON), enemyDeck: Array(5).fill(DRAGON), playerLife: 20, enemyLife: 20
                });
                const r = await page.evaluate(({ id, casterSide }) => {
                    try {
                        const card = { ...window.__CARD_BY_ID[id], id: Math.random() };
                        const side = casterSide === 'player' ? 'player' : 'enemy';
                        if (card.type === 'artifact') {
                            gameState[`${side}Board`].push(card);
                            resolveArtifactOnPlay(card, side);
                            processUpkeepEffects(side === 'player');
                        } else {
                            castInstant(card, side);
                        }
                        updateUI({ immediate: true });
                        return gameState.matchFinalized ? 'match ended' : null;
                    } catch (error) {
                        return error.message;
                    }
                }, { id, casterSide });
                if (r) problems.push(`${id}: ${r}`);
            }
            assert.deepEqual(problems, []);
        });
    }

    test('a draw effect with an empty deck loses the match (RULES.md R6.1) without errors', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { playerHand: ['spells-harvest'], playerMana: { earth: 2 }, playerDeck: [] });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.deepEqual(await page.evaluate(() => [gameState.matchFinalized, gameState.playerDeckedOut]), [true, true]);
    });

    test('lethal spells end the match at once', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        await setup(page, { enemyLife: 2, playerLife: 5, playerHand: ['spells-drain-life', FIREBALL], playerMana: { swamp: 2, fire: 3 } });
        await act(page, () => playCard(gameState.playerHand[0].id));
        await act(page, () => playCard(gameState.playerHand[0]?.id));
        const s = await page.evaluate(() => [gameState.matchFinalized, gameState.enemyLife, gameState.playerLife, gameState.playerHand.map(c => c.name)]);
        assert.deepEqual(s, [true, 0, 7, ['Fireball']], 'Drain wins; Fireball can no longer be cast');
    });
});

describe('player-facing text', () => {
    test('card details show a rules line for every instant and artifact', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const missing = await page.evaluate(() => window.__ALL_CARDS
            .filter(c => c.type === 'instant' || c.type === 'artifact')
            .filter(card => {
                showCardDetail(card);
                const text = document.getElementById('detailContent').textContent.replace(/\s+/g, ' ');
                return !text.includes(`Rules: ${describeEffect(card)}`) || /undefined|NaN/.test(describeEffect(card));
            })
            .map(c => c.__id));
        assert.deepEqual(missing, []);
    });

    test('rules lines say what the engine does', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const lines = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, describeEffect(window.__CARD_BY_ID[id])])), [
            FIREBALL, 'spells-earthquake', 'spells-anger', 'spells-deep-freeze', 'spells-curse', 'artifacts-magic-wand', 'artifacts-flaming-sword', 'artifacts-mana-gem'
        ]);
        assert.match(lines[FIREBALL], /3 damage to your opponent/);
        assert.match(lines['spells-earthquake'], /every creature.*yours too/i);
        assert.match(lines['spells-anger'], /until end of turn/);
        assert.match(lines['spells-deep-freeze'], /doesn't untap/);
        assert.match(lines['spells-curse'], /random enemy creature without Hexproof/);
        assert.match(lines['artifacts-magic-wand'], /start of each of your turns.*2 damage/);
        assert.match(lines['artifacts-flaming-sword'], /random creature you control.*\+2\/\+0/);
        assert.match(lines['artifacts-mana-gem'], /once per turn/i);
    });
});
