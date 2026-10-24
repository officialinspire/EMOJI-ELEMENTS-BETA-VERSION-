// Achievements (achievements.js, ACHIEVEMENTS.md), run against the real game in headless Chromium.
//
//   node --test tests/achievements.test.mjs        (or: npm run achievements)
//
// Part 1 checks the catalog: exactly 400 entries, unique ids, names and icons, and every event a trigger listens
// for is one index.js really reports.
// Part 2 is the coverage test: every one of the 400 is unlocked by a scenario that drives the real game
// (playCard, tapLand, enterAttackPhase → confirmAttackers, the AI's turn, purchasePack, finalizeMatch...).
// Long counts (500 land taps, 50 wins) start from a saved counter or profile one short of the goal, and the last
// step is a real event. A few scenarios fix a random choice for repeatability (which cards a pack holds, which
// creatures the AI attacks with); the code path that reports the outcome is the game's own.
// Part 3 covers behaviour: unlock once, reloads, storage migration, backfill, QA isolation, the screen, the
// notices, and the cost of a long match.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCatalog } from './achievements-doc.mjs';
import { useGameBrowser, openGame, openGamePage, act, setup, passTurn, waitUntilStartable, clickAt, QUIET_ENEMY } from './lib/game.mjs';

useGameBrowser();

const STORE_KEY = 'emoji_elements_achievements_v1';
const META_KEY = 'emoji_elements_meta_v1';
const withCounters = counters => ({ [STORE_KEY]: JSON.stringify({ version: 1, unlocked: {}, counters, prefs: { notify: true } }) });

// ------------------------------------------------------------------ helpers (all real game functions)

async function begin(page, { elements = ['fire'], difficulty = 'medium' } = {}) {
    await waitUntilStartable(page);
    await page.evaluate(({ elements, difficulty }) => {
        if (document.getElementById('gameContainer').style.display === 'flex') returnToMainMenu();
        showElementSelection();
        setDeckMode(elements.length > 1 ? 'dual' : 'single');
        elements.forEach(element => selectElement(element));
        selectDifficulty(difficulty);
        startGame();
    }, { elements, difficulty });
    await page.clock.runFor(400);
    assert.equal(await page.evaluate(() => document.getElementById('gameContainer').style.display), 'flex', 'match did not start');
    await setup(page, QUIET_ENEMY);
}

// Plays one card from the hand. Colourless mana pays any cost (RULES.md house rule).
async function play(page, card, extra = {}) {
    await setup(page, { playerHand: [card], playerMana: { colorless: 30 }, landsPlayedThisTurn: 0, ...extra });
    await act(page, () => playCard(gameState.playerHand[0].id));
}

async function attackWithAll(page) {
    await act(page, () => enterAttackPhase());
    await act(page, () => gameState.playerBoard.filter(c => c.type === 'creature').forEach(c => selectAttacker(c.id)));
    await act(page, () => confirmAttackers());
}

// The AI attacks with every creature that can (its own judgement is tested in ai.test.mjs); blocks are automatic
async function enemyAttacks(page) {
    await page.evaluate(() => { window.chooseEnemyAttackers = eligible => eligible; });
    await passTurn(page);
}

const win = page => act(page, () => changeEnemyLife(-gameState.enemyLife));
const lose = page => act(page, () => changePlayerLife(-gameState.playerLife));
const unlockedIds = page => page.evaluate(() => Achievements.catalog.filter(a => Achievements.isUnlocked(a.id)).map(a => a.id));

// Buys a pack whose 5 cards are fixed (generatePack is the only stand-in), then tears it open or closes it
async function openPack(page, theme, cardIds, { tear = true } = {}) {
    await page.evaluate(({ theme, cardIds }) => {
        gameMeta.wallet.credits = Math.max(gameMeta.wallet.credits, 200);
        if (cardIds) window.generatePack = () => [...cardIds];
        purchasePack(theme);
    }, { theme, cardIds });
    await page.clock.runFor(300);
    await page.evaluate(tear => (tear ? triggerPackOpenAnimation() : closePackOpeningOverlay()), tear);
    await page.clock.runFor(800);
    await page.evaluate(() => { if (packOpeningState.active) closePackOpeningOverlay(); });
    await page.clock.runFor(300);
}

// ------------------------------------------------------------------ Part 2 scenarios
// ids: what the scenario must unlock. match: start a match first (options for begin). storage: saved data.

const LOBSTER = 'creatures-fire-lobster';      // 2/2
const BEETLE = 'creatures-ember-beetle';       // 1/2
const FOX = 'creatures-fire-fox';
const DRAGON = 'creatures-ancient-dragon';     // legendary 6/6 flying trample

const DECK_KEYS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT', 'FIRE_WATER', 'FIRE_EARTH', 'FIRE_SWAMP', 'FIRE_LIGHT',
    'WATER_EARTH', 'WATER_SWAMP', 'WATER_LIGHT', 'EARTH_SWAMP', 'EARTH_LIGHT', 'SWAMP_LIGHT'];

const SCENARIOS = [
    // ---- first steps, wins and losses
    { ids: ['first-match', 'first-win', 'flawless', 'speedrun', 'spellbound', 'pacifist', 'shoestring', 'win-medium'], match: {}, run: win },
    { ids: ['first-loss'], match: {}, run: lose },
    { ids: ['first-land'], match: {}, run: p => play(p, 'lands-volcanic-peak') },
    { ids: ['first-creature'], match: {}, run: p => play(p, FOX) },
    { ids: ['first-instant'], match: {}, run: p => play(p, 'spells-fireball') },
    { ids: ['first-artifact'], match: {}, run: p => play(p, 'artifacts-flaming-sword') },
    { ids: ['first-attack'], match: {}, run: async p => { await setup(p, { playerBoard: [FOX] }); await attackWithAll(p); } },
    { ids: ['first-mulligan'], match: {}, run: p => act(p, () => performMulligan()) },
    { ids: ['first-deck'], run: p => p.evaluate(() => { showDeckBuilder(); saveDeckBuilderDeck(); }) },
    // The saved profile one win short (set after loading, so nothing is backfilled), then a real win
    { ids: ['wins-10', 'matches-100'], run: async p => {
        await p.evaluate(() => { gameStats.wins = 9; gameStats.losses = 90; gameStats.total = 99; saveStats(); });
        await begin(p);
        await win(p);
    } },
    { ids: ['wins-50'], run: async p => {
        await p.evaluate(() => { gameStats.wins = 49; gameStats.total = 49; saveStats(); });
        await begin(p);
        await win(p);
    } },
    { ids: ['streak-10'], storage: withCounters({ streak: 9 }), match: {}, run: win },
    { ids: ['comeback'], match: {}, run: async p => { await act(p, () => changePlayerLife(-17)); await win(p); } },
    { ids: ['marathon'], match: {}, run: async p => { await p.evaluate(() => { gameState.round = 20; }); await win(p); } },
    { ids: ['so-close'], match: {}, run: async p => { await act(p, () => changeEnemyLife(-17)); await lose(p); } },
    { ids: ['rematch'], match: {}, run: async p => { await lose(p); await begin(p); await win(p); } },

    // ---- difficulty (three wins in a row also makes a streak of 3)
    { ids: ['win-easy', 'win-hard', 'all-difficulties', 'streak-3', 'hard-mono', 'hard-dominant'], run: async p => {
        await begin(p, { difficulty: 'easy' }); await win(p);
        await begin(p, { difficulty: 'medium' }); await win(p);
        await begin(p, { difficulty: 'hard' }); await win(p);
    } },
    { ids: ['hard-5'], storage: withCounters({ hardWins: 4 }), match: { difficulty: 'hard' }, run: win },
    { ids: ['hard-clutch', 'by-a-thread'], match: { difficulty: 'hard' }, run: async p => { await act(p, () => changePlayerLife(-19)); await win(p); } },
    { ids: ['hard-underdog', 'lone-wolf'], match: { difficulty: 'hard' }, run: async p => {
        await setup(p, { playerBoard: [FOX], enemyBoard: [LOBSTER, BEETLE] });
        await win(p);
    } },

    // ---- the 15 decks
    ...DECK_KEYS.map(key => ({
        ids: [`deck-${key.toLowerCase().replace('_', '-')}`],
        match: { elements: key.toLowerCase().split('_') },
        run: win
    })),

    // ---- elements
    { ids: ['fire-30', 'water-30', 'earth-30', 'swamp-30', 'light-30'],
        storage: withCounters({ 'plays.fire': 29, 'plays.water': 29, 'plays.earth': 29, 'plays.swamp': 29, 'plays.light': 29 }),
        match: {}, run: async p => {
            for (const card of [FOX, 'creatures-mystic-dolphin', 'creatures-mech-part', 'creatures-witch-cat', 'creatures-forest-fairy']) await play(p, card);
        } },
    { ids: ['fire-meteor', 'hot-potato', 'instants-turn-3'], match: {}, run: async p => {
        for (const card of ['spells-meteor-strike', 'spells-inferno', 'spells-explosion']) await play(p, card);
    } },
    { ids: ['water-tsunami', 'return-sender'], match: {}, run: p => play(p, 'spells-tsunami', { enemyBoard: [DRAGON, LOBSTER] }) },
    { ids: ['earth-heavy'], match: {}, run: p => play(p, 'creatures-battle-mech') },
    { ids: ['swamp-necro', 'second-coming'], match: {}, run: p => play(p, 'spells-necromancy', { playerGraveyard: [DRAGON] }) },
    { ids: ['light-heal', 'brink'], match: {}, run: async p => {
        await act(p, () => changePlayerLife(-16));
        for (let i = 0; i < 4; i++) await play(p, 'spells-heal');
    } },

    // ---- card types
    { ids: ['creatures-100', 'instants-50', 'artifacts-25', 'lands-100'],
        storage: withCounters({ 'played.creature': 99, 'played.instant': 49, 'played.artifact': 24, 'played.land': 99 }),
        match: {}, run: async p => {
            for (const card of [FOX, 'spells-fireball', 'artifacts-flaming-sword', 'lands-volcanic-peak']) await play(p, card);
        } },
    { ids: ['creatures-match-8'], match: {}, run: async p => { for (let i = 0; i < 8; i++) await play(p, FOX); } },
    { ids: ['tokens-10', 'token-horde'], match: {}, run: async p => { for (let i = 0; i < 4; i++) await play(p, 'spells-raise-army'); } },
    { ids: ['legendary-play'], match: {}, run: p => play(p, DRAGON) },

    // ---- mana and lands
    { ids: ['taps-500'], storage: withCounters({ landTaps: 499 }), match: {}, run: async p => {
        await setup(p, { playerBoard: ['lands-volcanic-peak'], playerMana: {} });
        await act(p, () => tapLand(gameState.playerBoard[0].id));
    } },
    { ids: ['lands-8', 'mana-7', 'mana-10', 'tap-all'], match: {}, run: async p => {
        await play(p, 'lands-volcanic-peak', { playerBoard: Array(9).fill('lands-volcanic-peak'), playerMana: {} });
        await act(p, () => tapAllLandsOfType('fire'));
    } },
    { ids: ['exact-change'], match: {}, run: p => play(p, 'creatures-armored-rhino', { playerMana: { colorless: 5 } }) },
    { ids: ['rainbow'], match: {}, run: async p => {
        await setup(p, { playerBoard: ['lands-rainbow'], playerMana: {} });
        await act(p, () => tapLand(gameState.playerBoard[0].id));
        await act(p, () => document.querySelector('#manaChoiceOptions .mana-choice-btn:not(.cancel-btn)').click());
    } },
    { ids: ['distant-planet'], match: {}, run: p => play(p, 'lands-distant-planet') },
    { ids: ['mana-artifact'], match: {}, run: async p => {
        await setup(p, { playerBoard: ['artifacts-mana-gem'], playerMana: {} });
        await act(p, () => activateArtifact(gameState.playerBoard[0].id));
    } },
    { ids: ['prism'], match: {}, run: async p => {
        await setup(p, { playerBoard: ['lands-volcanic-peak', 'lands-mystic-springs', 'lands-ancient-grove'], playerMana: {} });
        for (let i = 0; i < 3; i++) await act(p, i => tapLand(gameState.playerBoard[i].id), i);
    } },

    // ---- combat: the player attacks (the AI's blocks are automatic)
    { ids: ['air-mail'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-crystal-swan'], enemyBoard: [] }); await attackWithAll(p); } },
    { ids: ['steamroller'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-battle-mech'], enemyBoard: [BEETLE] }); await attackWithAll(p); } },
    { ids: ['vampiric'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-ancient-vampire'], enemyBoard: [] }); await attackWithAll(p); } },
    { ids: ['quick-draw'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-fire-ram'], enemyBoard: [LOBSTER] }); await attackWithAll(p); } },
    { ids: ['double-strike'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-werewolf'], enemyBoard: [] }); await attackWithAll(p); } },
    { ids: ['scary-face'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-great-shark'], enemyBoard: [LOBSTER] }); await attackWithAll(p); } },
    { ids: ['slippery'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-otter-scout'], enemyBoard: [LOBSTER] }); await attackWithAll(p); } },
    { ids: ['no-time'], match: {}, run: async p => { await play(p, 'creatures-blazing-tiger', { playerBoard: [] }); await attackWithAll(p); } },
    { ids: ['alpha-strike'], match: {}, run: async p => { await setup(p, { playerBoard: [DRAGON, 'creatures-werewolf'], enemyBoard: [] }); await attackWithAll(p); } },
    { ids: ['all-in'], match: {}, run: async p => { await setup(p, { playerBoard: Array(5).fill(FOX), enemyBoard: [] }); await attackWithAll(p); } },
    { ids: ['fair-trade'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-crystal-swan'], enemyBoard: ['creatures-crystal-swan'] }); await attackWithAll(p); } },
    { ids: ['clean-sweep'], match: {}, run: async p => { await setup(p, { playerBoard: Array(3).fill('creatures-fire-lion'), enemyBoard: Array(3).fill(LOBSTER) }); await attackWithAll(p); } },
    { ids: ['coup'], match: {}, run: async p => {
        await setup(p, { playerBoard: [LOBSTER], enemyBoard: [], enemyLife: 2 });
        await attackWithAll(p);
    } },

    // ---- combat: the AI attacks (the player's blocks are automatic)
    { ids: ['swat-team'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-giant-squid'], enemyBoard: ['creatures-crystal-swan'] }); await enemyAttacks(p); } },
    { ids: ['tiny-deadly'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-venom-snake'], enemyBoard: ['creatures-mirror-knight'] }); await enemyAttacks(p); } },
    { ids: ['brick-wall'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-armored-snail'], enemyBoard: [LOBSTER] }); await enemyAttacks(p); } },
    { ids: ['bodyguard'], match: {}, run: async p => { await setup(p, { playerBoard: ['creatures-giant-squid'], enemyBoard: [LOBSTER] }); await enemyAttacks(p); } },
    { ids: ['double-team'], match: {}, run: async p => { await setup(p, { playerBoard: [LOBSTER, 'creatures-giant-squid'], enemyBoard: ['creatures-great-shark'] }); await enemyAttacks(p); } },
    { ids: ['night-watch'], match: {}, run: async p => {
        await setup(p, { playerBoard: ['creatures-noble-deer'], enemyBoard: [] });
        await attackWithAll(p);
        await setup(p, { enemyBoard: [BEETLE] });
        await enemyAttacks(p);
    } },
    { ids: ['shell-game'], match: {}, run: p => play(p, 'creatures-witch-cat', { playerBoard: ['creatures-restless-ghost', 'creatures-cyber-brain'] }) },

    // ---- spells and artifacts
    { ids: ['burned-out', 'overkill'], match: {}, run: async p => { await act(p, () => changeEnemyLife(-19)); await play(p, 'spells-meteor-strike'); } },
    { ids: ['blood-bank'], match: {}, run: async p => { await act(p, () => changeEnemyLife(-18)); await play(p, 'spells-drain-life'); } },
    { ids: ['avalanche'], match: {}, run: p => play(p, 'spells-avalanche', { playerBoard: [LOBSTER], enemyBoard: [LOBSTER, LOBSTER] }) },
    { ids: ['kaboom'], match: {}, run: p => play(p, 'artifacts-bomb', { enemyBoard: [LOBSTER, LOBSTER] }) },
    { ids: ['giant-slayer'], match: {}, run: p => play(p, 'spells-curse', { enemyBoard: [DRAGON] }) },
    { ids: ['chill-out'], match: {}, run: p => play(p, 'spells-deep-freeze', { enemyBoard: [{ card: LOBSTER, tapped: true }] }) },
    { ids: ['pumped', 'road-rage'], match: {}, run: async p => { await play(p, 'spells-anger', { playerBoard: [FOX] }); await win(p); } },
    { ids: ['mind-wipe'], match: {}, run: p => play(p, 'spells-mind-rot', { enemyHand: [LOBSTER] }) },
    { ids: ['bookworm'], match: {}, run: async p => {
        await setup(p, { playerDeck: Array(10).fill(FOX) });
        await play(p, 'spells-harvest');
        await play(p, 'spells-harvest');
    } },
    { ids: ['upkeep-3'], match: {}, run: p => play(p, 'artifacts-cursed-orb', { playerBoard: ['artifacts-crown-of-power', 'artifacts-holy-chalice'] }) },

    // ---- collection and packs. The collection is set in the page after loading, so nothing is backfilled first.
    { ids: ['first-pack', 'own-175', 'own-200', 'own-250', 'own-all', 'own-legendary', 'own-all-legendary', 'own-all-epic', 'own-scifi',
        'golden-ticket', 'fresh-stock', 'jackpot'], run: async p => {
        const missing = ['creatures-ancient-dragon', 'creatures-phoenix', 'creatures-battle-rocket', 'creatures-restless-ghost', FOX];
        await p.evaluate(missing => {
            gameMeta.collection = Object.fromEntries(Object.keys(__CARD_BY_ID).filter(id => !missing.includes(id)).map(id => [id, 1]));
        }, missing);
        await openPack(p, 'fantasy', missing);
    } },
    { ids: ['deja-vu', 'triple-crown'], run: async p => {
        await p.evaluate(() => { gameMeta.collection['creatures-ancient-dragon'] = 2; });
        const owned = await p.evaluate(() => Object.keys(gameMeta.collection).filter(id => gameMeta.collection[id] > 0 && id !== 'creatures-ancient-dragon').slice(0, 4));
        await openPack(p, 'fantasy', ['creatures-ancient-dragon', ...owned], { tear: false });
    } },
    { ids: ['packs-10', 'packs-50'], run: async p => { await p.evaluate(() => { gameMeta.stats.packsOpened = 49; metaSave(gameMeta); }); await openPack(p, 'robot'); } },
    { ids: ['pack-sampler'], run: async p => { for (const theme of ['fantasy', 'scifi', 'tech', 'alien', 'robot', 'lands']) await openPack(p, theme, null, { tear: false }); } },
    { ids: ['big-spender'], storage: withCounters({ creditsSpent: 960 }), run: p => openPack(p, 'alien') },
    { ids: ['savings'], match: {}, run: async p => { await p.evaluate(() => { gameMeta.wallet.credits = 495; }); await win(p); } },

    // ---- rare match conditions
    { ids: ['library'], match: {}, run: async p => { await setup(p, { enemyDeck: [] }); await passTurn(p); } },
    { ids: ['overdrawn'], match: {}, run: async p => { await setup(p, { playerDeck: [] }); await passTurn(p); } },
    { ids: ['healthy'], match: {}, run: async p => { await act(p, () => changePlayerLife(10)); await win(p); } },
    { ids: ['scorched-earth'], match: {}, run: async p => { await setup(p, { playerBoard: Array(5).fill(FOX), enemyBoard: [] }); await win(p); } },

    // ---- combinations: two on the battlefield, the third played
    { ids: ['spooky-season'], match: {}, run: p => play(p, 'creatures-skeleton-warrior', { playerBoard: ['creatures-risen-zombie', 'creatures-restless-ghost'] }) },
    { ids: ['phoenix-rising'], match: {}, run: p => play(p, 'creatures-phoenix-firebird', { playerBoard: ['creatures-phoenix'] }) },
    { ids: ['shark-week'], match: {}, run: p => play(p, 'creatures-great-white-shark', { playerBoard: ['creatures-great-shark'] }) },
    { ids: ['fairy-tale'], match: {}, run: p => play(p, 'creatures-forest-fairy', { playerBoard: ['creatures-sacred-unicorn', 'creatures-winged-pegasus'] }) },
    { ids: ['big-cat-energy'], match: {}, run: p => play(p, 'creatures-fire-lion', { playerBoard: ['creatures-blazing-tiger', 'creatures-bengal-tiger'] }) },
    { ids: ['some-assembly'], match: {}, run: p => play(p, 'creatures-mech-part', { playerBoard: ['creatures-battle-mech', 'creatures-combat-robot'] }) },

    // ---- just for fun
    { ids: ['flash-mob'], match: {}, run: p => play(p, 'creatures-swamp-frog', { playerBoard: ['creatures-mystic-dolphin', 'creatures-river-otter'] }) },
    { ids: ['poop-happens'], match: {}, run: p => play(p, 'creatures-poop') },
    { ids: ['clown-car'], match: {}, run: p => play(p, 'creatures-dread-clown', { playerBoard: ['creatures-demonic-clown'] }) },
    { ids: ['rage-quit'], match: {}, run: async p => {
        await act(p, () => changePlayerLife(-10));
        await p.evaluate(() => { confirmQuit(); document.getElementById('gameConfirmYesBtn').click(); });
    } },
    { ids: ['card-inspector'], storage: withCounters({ cardDetails: 49 }), match: {}, run: async p => { const b=await p.locator('#playerHand .card').first().boundingBox(); await p.mouse.click(b.x+b.width/2,b.y+b.height/2,{button:'right'}); } },
    { ids: ['decorator'], run: async p => { await p.evaluate(() => showThemePicker()); await p.clock.runFor(100); await clickAt(p, '[data-ui-theme="deep-space"]'); await clickAt(p, '[data-ui-theme="neon"]'); } }
];

const covered = new Set();

describe('catalog', () => {
    test('exactly 400 achievements with unique ids, names and icons, in known categories and tiers', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const c = await page.evaluate(() => ({
            list: Achievements.catalog.map(a => ({ id: a.id, name: a.name, icon: a.icon, cat: a.cat, tier: a.tier, desc: a.desc, on: a.on, goal: a.goal || 0, counted: typeof a.progress === 'function', tested: typeof a.test === 'function' })),
            cats: Achievements.categories.map(([key]) => key)
        }));
        assert.equal(c.list.length, 400);
        for (const key of ['id', 'name']) assert.equal(new Set(c.list.map(a => a[key])).size, 400, `unique ${key}s`);
        for (const a of c.list) {
            assert.ok(c.cats.includes(a.cat), `${a.id}: category ${a.cat}`);
            assert.ok(['common', 'rare', 'epic', 'legendary'].includes(a.tier), `${a.id}: tier`);
            assert.ok(a.desc.length > 8 && a.name.length > 2, `${a.id}: name and description`);
            assert.ok(a.goal ? a.counted : a.tested, `${a.id}: a trigger (test or goal + progress)`);
            assert.match(a.id, /^[a-z0-9-]+$/, `${a.id}: stable id`);
        }
        // Every category has entries; the 15 decks have one each
        for (const cat of c.cats) assert.ok(c.list.some(a => a.cat === cat), `category ${cat} is used`);
        assert.equal(c.list.filter(a => a.cat === 'decks').length, 165);
    });

    test('every event a trigger listens for is reported by index.js', () => {
        const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
        const reported = new Set([...source.matchAll(/reportAchievement\('([a-z:]+)'/g)].map(m => m[1]));
        const { catalog } = loadCatalog();
        const listened = new Set(catalog.flatMap(def => def.on));
        listened.delete('board'); // checked after every board-changing event (BOARD_EVENTS)
        assert.deepEqual([...listened].filter(type => !reported.has(type)), []);
    });

    test('ACHIEVEMENTS.md lists all 400 with their exact triggers (generated from the code)', async () => {
        const { renderTable } = await import('./achievements-doc.mjs');
        const doc = fs.readFileSync(new URL('../ACHIEVEMENTS.md', import.meta.url), 'utf8');
        const table = renderTable();
        assert.ok(doc.includes(table), 'ACHIEVEMENTS.md is out of date: run npm run achievements:doc');
        assert.equal(table.split('\n').filter(line => /^\| \d+ \| `/.test(line)).length, 400);
    });
});

describe('coverage: every achievement unlocks from real game events', { concurrency: 6 }, () => {
    for (const scenario of SCENARIOS) {
        test(scenario.ids.join(', '), { timeout: 90000 }, async t => {
            const page = await openGame(t, { seed: 11, storage: scenario.storage });
            const before = await unlockedIds(page);
            assert.deepEqual(scenario.ids.filter(id => before.includes(id)), [], 'already unlocked before the scenario');
            if (scenario.match) await begin(page, scenario.match);
            await scenario.run(page);
            await page.clock.runFor(200);
            const after = await page.evaluate(ids => ids.map(id => ({ id, at: Achievements.unlockedAt(id), backfilled: !!JSON.parse(localStorage.getItem('emoji_elements_achievements_v1') || '{}').unlocked?.[id]?.backfilled })), scenario.ids);
            assert.deepEqual(after.filter(a => !a.at).map(a => a.id), [], 'not unlocked');
            assert.deepEqual(after.filter(a => a.backfilled).map(a => a.id), [], 'unlocked by an event, not by backfill');
            scenario.ids.forEach(id => covered.add(id));
        });
    }
});

describe('coverage summary', () => {
    test('the original scenarios still unlock all 150 original achievements', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        const ids = await page.evaluate(() => Achievements.catalog.slice(0, 150).map(a => a.id));
        assert.deepEqual(ids.filter(id => !covered.has(id)), [], 'achievements no scenario unlocked');
    });
});

// ------------------------------------------------------------------ Part 3: behaviour

describe('unlocking and storage', () => {
    test('each achievement unlocks once: repeats, re-renders and reloads change nothing', { timeout: 90000 }, async t => {
        const { page, close } = await openGamePage({ seed: 3 });
        t.after(close);
        await page.evaluate(() => { window.__unlocks = []; Achievements.onUnlock(def => window.__unlocks.push(def.id)); });
        await begin(page);
        await play(page, 'lands-volcanic-peak');
        const firstAt = await page.evaluate(() => Achievements.unlockedAt('first-land'));
        assert.ok(firstAt);
        await page.clock.runFor(1000);
        await play(page, 'lands-volcanic-peak');
        for (let i = 0; i < 5; i++) await page.evaluate(() => { showAchievementsDialog(); hideAchievementsDialog(); });
        assert.deepEqual(await page.evaluate(() => window.__unlocks.filter(id => id === 'first-land')), ['first-land']);
        assert.equal(await page.evaluate(() => Achievements.unlockedAt('first-land')), firstAt);

        await page.reload();
        await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; window.__unlocks = []; Achievements.onUnlock(def => window.__unlocks.push(def.id)); });
        assert.equal(await page.evaluate(() => Achievements.unlockedAt('first-land')), firstAt, 'survives a reload with its date');
        await begin(page);
        await play(page, 'lands-volcanic-peak');
        assert.deepEqual(await page.evaluate(() => window.__unlocks.filter(id => !id.startsWith('mastery-'))), [], 'no second unlock of existing achievements after reload');
    });

    test('counters are saved (batched) and continue after a reload', { timeout: 90000 }, async t => {
        const { page, close } = await openGamePage({ seed: 3 });
        t.after(close);
        await begin(page);
        for (let i = 0; i < 3; i++) await play(page, FOX);
        await page.clock.runFor(1000);
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).counters['played.creature'], STORE_KEY);
        assert.equal(saved, 3);
        await page.reload();
        await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
        assert.deepEqual(await page.evaluate(() => Achievements.progressOf(Achievements.get('creatures-100'))), { value: 3, goal: 100 });
    });

    test('migration: a corrupt store is backed up and rebuilt; unknown ids and fields are handled', { timeout: 90000 }, async t => {
        const corrupt = await openGame(t, { storage: { [STORE_KEY]: '{not json' } });
        assert.equal(await corrupt.evaluate(() => localStorage.getItem('emoji_elements_achievements_backup')), '{not json');
        assert.equal(await corrupt.evaluate(key => JSON.parse(localStorage.getItem(key)).version, STORE_KEY), 1);

        const odd = await openGame(t, { storage: { [STORE_KEY]: JSON.stringify({
            version: 1,
            unlocked: { 'first-land': { at: '2026-01-02T00:00:00.000Z' }, 'from-a-later-build': { at: '2026-01-03T00:00:00.000Z' }, 'first-win': 'yes' },
            counters: { landTaps: 12, streak: 'many', themes: ['arcane', 7], junk: { a: 1 } },
            prefs: { notify: false },
            extra: 'dropped'
        }) } });
        const r = await odd.evaluate(key => ({ store: JSON.parse(localStorage.getItem(key)), count: Achievements.unlockedCount(), notify: Achievements.notify }), STORE_KEY);
        assert.equal(r.store.unlocked['first-land'].at, '2026-01-02T00:00:00.000Z');
        assert.ok(r.store.unlocked['from-a-later-build'], 'an id this build does not know is kept');
        assert.equal(r.store.unlocked['first-win'].at, '1970-01-01T00:00:00.000Z', 'a malformed entry keeps the unlock without a date');
        assert.equal(r.store.counters.landTaps, 12);
        assert.equal(r.store.counters.streak, 0, 'a malformed numeric counter cannot satisfy a threshold');
        assert.deepEqual(r.store.counters.themes, ['arcane']);
        assert.equal(r.store.counters.junk, undefined);
        assert.equal(r.store.extra, undefined);
        assert.equal(r.count, 2, 'only known ids count toward the 400');
        assert.equal(r.notify, false);
    });

    test('a store from a newer version is read but never overwritten', { timeout: 90000 }, async t => {
        const newer = JSON.stringify({ version: 2, unlocked: { 'first-land': { at: '2027-01-01T00:00:00.000Z' } }, counters: {}, prefs: {}, future: true });
        const page = await openGame(t, { storage: { [STORE_KEY]: newer } });
        await begin(page);
        await play(page, FOX);
        await page.clock.runFor(1000);
        const r = await page.evaluate(key => ({ raw: localStorage.getItem(key), persisting: Achievements.persisting, creature: Achievements.isUnlocked('first-creature') }), STORE_KEY);
        assert.equal(r.raw, newer);
        assert.equal(r.persisting, false);
        assert.ok(r.creature, 'still works for this visit');
    });

    test('backfill recognises only what the saved profile proves, quietly, and leaves the profile untouched', { timeout: 90000 }, async t => {
        // A returning player from before achievements existed: 12 wins, 3 losses, 11 packs, 640 credits, one legendary
        const seedPage = await openGame(t);
        const meta = await seedPage.evaluate(() => {
            gameMeta.stats = { wins: 12, losses: 3, packsOpened: 11 };
            gameMeta.wallet.credits = 640;
            gameMeta.collection['creatures-ancient-dragon'] = 1;
            return JSON.stringify(gameMeta);
        });
        const page = await openGame(t, { storage: { [META_KEY]: meta, [STORE_KEY]: null } });
        await page.evaluate(() => {
            window.__cues = [];
            const original = GameFeedback.play;
            GameFeedback.play = (cue, ...rest) => { window.__cues.push(cue); return original.call(GameFeedback, cue, ...rest); };
        });
        await page.clock.runFor(700);
        const r = await page.evaluate(key => ({
            store: JSON.parse(localStorage.getItem(key)),
            meta: localStorage.getItem('emoji_elements_meta_v1'),
            toast: document.getElementById('achievementToast').textContent.replace(/\s+/g, ' '),
            sound: window.__cues.includes('achievement')
        }), STORE_KEY);
        const ids = Object.keys(r.store.unlocked).sort();
        assert.deepEqual(ids, ['first-loss', 'first-match', 'first-pack', 'first-win', 'mastery-career-3', 'mastery-career-5', 'own-legendary', 'packs-10', 'savings', 'wins-10']);
        assert.ok(ids.every(id => r.store.unlocked[id].backfilled), 'marked as recognised from saved progress');
        assert.equal(r.meta, meta, 'credits, cards, decks and stats are unchanged');
        assert.match(r.toast, /Recognised from your saved progress 10 achievements/, 'one summary notice, not one per achievement');
        assert.equal(r.sound, false, 'the summary is quiet');
        await page.evaluate(() => showAchievements());
        assert.match(await page.evaluate(() => document.querySelector('[data-id="wins-10"]').textContent), /From your saved progress/);
    });

    test('QA mode never saves achievements, so QA tools and resets cannot award a real profile', { timeout: 90000 }, async t => {
        const page = await openGame(t, { storage: { emojiElementsQA: '1' } });
        assert.equal(await page.evaluate(() => Achievements.persisting), false);
        await begin(page);
        await play(page, FOX);
        await win(page);
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => Achievements.isUnlocked('first-win')), false, 'QA actions cannot grant progress');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), STORE_KEY), null, 'nothing saved');
        assert.match(await page.evaluate(() => { returnToMainMenu(); showAchievements(); return document.getElementById('achievementsMenuView').textContent; }), /not saved/);
        // The QA reset reloads the page: still nothing saved, nothing carried over
        const reloaded = page.waitForEvent('framenavigated');
        await page.evaluate(() => { window.confirm = () => true; window.__qaResetMeta(); }).catch(() => { /* the page navigates away */ });
        await reloaded;
        await page.waitForLoadState('load');
        assert.equal(await page.evaluate(() => Achievements.unlockedCount()), 0);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), STORE_KEY), null);
    });
});

describe('the Achievements screen and notices', () => {
    test('menu screen: filters, progress, locked, unlocked and hidden entries', { timeout: 90000 }, async t => {
        const page = await openGame(t, { storage: withCounters({ landTaps: 120 }) });
        await begin(page);
        await play(page, 'lands-volcanic-peak');
        await page.evaluate(() => returnToMainMenu());
        await page.evaluate(() => showAchievements());
        const r = await page.evaluate(() => {
            const view = document.getElementById('achievementsMenuView');
            const item = id => view.querySelector(`[data-id="${id}"]`);
            return {
                items: view.querySelectorAll('.ach-item').length,
                landState: item('first-land').dataset.state,
                landText: item('first-land').textContent,
                taps: item('taps-500').querySelector('.ach-progress')?.getAttribute('aria-label'),
                hidden: item('overdrawn').textContent,
                hiddenState: item('overdrawn').dataset.state,
                count: view.querySelector('.ach-count').textContent,
                menuDesc: document.getElementById('menuAchievements').textContent
            };
        });
        assert.equal(r.items, 400);
        assert.equal(r.landState, 'unlocked');
        assert.match(r.landText, /Plot of Land[\s\S]*Unlocked/);
        assert.equal(r.taps, '120 of 500');
        assert.equal(r.hiddenState, 'secret');
        assert.doesNotMatch(r.hidden, /Overdrawn|ran out/, 'a hidden achievement keeps its secret until unlocked');
        assert.match(r.count, /1 of 400/);
        assert.equal(r.menuDesc, '1 of 400 unlocked');

        await page.evaluate(() => document.querySelector('.ach-filter[data-filter="mana"]').click());
        assert.equal(await page.evaluate(() => document.querySelectorAll('#achievementsMenuView .ach-item').length), 10);
        await page.evaluate(() => document.querySelector('.ach-filter[data-filter="unlocked"]').click());
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#achievementsMenuView .ach-item')].map(el => el.dataset.id)), ['first-land']);
        assert.equal(await page.evaluate(() => document.querySelector('.ach-filter[aria-pressed="true"]').dataset.filter), 'unlocked');
    });

    test('pause menu opens the same list; Esc returns to the pause panel', { timeout: 90000 }, async t => {
        const page = await openGame(t);
        await begin(page);
        await act(page, () => pauseGame());
        assert.match(await page.evaluate(() => document.getElementById('pauseAchievementsNote').textContent), /0 of 400 unlocked/);
        await page.evaluate(() => document.querySelector('.pause-achievements-btn').click());
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => document.querySelectorAll('#achievementsDialogView .ach-item').length), 400);
        await page.keyboard.press('Escape');
        await page.clock.runFor(200);
        const r = await page.evaluate(() => ({ dialog: document.getElementById('achievementsDialog').classList.contains('show'), paused: gamePaused }));
        assert.deepEqual(r, { dialog: false, paused: true });
    });

    test('notices queue one at a time, wait while paused, stay clear of the match controls, and respect the setting', { timeout: 90000 }, async t => {
        const page = await openGame(t);
        await begin(page);
        await page.evaluate(() => {
            window.__cues = [];
            const original = GameFeedback.play;
            GameFeedback.play = (cue, ...rest) => { window.__cues.push(cue); return original.call(GameFeedback, cue, ...rest); };
        });
        // One win unlocks several at once
        await win(page);
        await page.clock.runFor(100);
        const first = await page.evaluate(() => ({ text: document.getElementById('achievementToast').textContent.replace(/\s+/g, ' '), cues: window.__cues.filter(c => c === 'achievement').length }));
        assert.match(first.text, /Achievement unlocked · \d+ more/);
        assert.equal(first.cues, 1, 'one sound per notice, not per unlock');
        await page.clock.runFor(3600);
        assert.equal(await page.evaluate(() => window.__cues.filter(c => c === 'achievement').length), 2, 'the next notice follows the first');

        // In a match: never over the hand, the turn buttons or the life totals
        await begin(page);
        await page.evaluate(() => { while (achievementNoticeQueue.length) achievementNoticeQueue.shift(); });
        await page.clock.runFor(4000);
        await play(page, 'lands-volcanic-peak');
        await page.clock.runFor(100);
        const overlap = await page.evaluate(() => {
            const toast = document.getElementById('achievementToast').getBoundingClientRect();
            const hits = [];
            document.querySelectorAll('#endTurnBtn, #attackBtn, #mulliganBtn, #playerHand .card, #playerLife, #enemyLife, .game-controls button').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.width && r.height && r.left < toast.right && r.right > toast.left && r.top < toast.bottom && r.bottom > toast.top) hits.push(el.id || el.className);
            });
            return { shown: !document.getElementById('achievementToast').hidden, hits, clicks: getComputedStyle(document.getElementById('achievementToast')).pointerEvents };
        });
        assert.ok(overlap.shown);
        assert.deepEqual(overlap.hits, []);
        assert.equal(overlap.clicks, 'none');

        // PAUSE takes the notice on screen down at once (it covered the panel's title on phones); it returns after
        await act(page, () => pauseGame());
        assert.equal(await page.evaluate(() => document.getElementById('achievementToast').hidden), true, 'down while paused');
        await act(page, () => resumeGame());
        await page.clock.runFor(800);
        assert.match(await page.evaluate(() => document.getElementById('achievementToast').textContent), /Plot of Land/, 'back after RESUME');

        // Paused: the next notice waits until RESUME
        await page.clock.runFor(4000);
        await act(page, () => pauseGame());
        await page.evaluate(() => Achievements.emit('mulligan', {}));
        await page.clock.runFor(2000);
        assert.equal(await page.evaluate(() => document.getElementById('achievementToast').hidden), true, 'hidden while paused');
        await act(page, () => resumeGame());
        await page.clock.runFor(800);
        assert.match(await page.evaluate(() => document.getElementById('achievementToast').textContent), /Take-Backsies/);

        // Notices without sound or buzz when the player turns that off
        await page.clock.runFor(4000);
        await page.evaluate(() => { Achievements.setNotify(false); window.__cues = []; });
        await play(page, FOX);
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => window.__cues.includes('achievement')), false);
        assert.equal(await page.evaluate(() => document.getElementById('achievementToast').hidden), false, 'the notice itself still shows');
    });

    test('the notice haptic goes through the guarded helper and is silent without vibration support', { timeout: 90000 }, async t => {
        const page = await openGame(t);
        await page.evaluate(() => { try { delete Navigator.prototype.vibrate; } catch (_) { /* not present */ } });
        await begin(page);
        await play(page, FOX);
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => GameFeedback.haptic('achievement')), false);
        assert.match(await page.evaluate(() => document.getElementById('achievementToast').textContent), /It's Alive!/);
    });
});

describe('long matches', () => {
    test('a 60-turn match with constant events stays fast and writes the store sparingly', { timeout: 180000 }, async t => {
        const page = await openGame(t);
        await begin(page);
        await page.evaluate(key => {
            window.__writes = 0;
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) { if (k === key) window.__writes++; return original.call(this, k, v); };
        }, STORE_KEY);
        const r = await page.evaluate(() => {
            const emitted = { n: 0, ms: 0 };
            const realEmit = Achievements.emit;
            Achievements.emit = (type, e) => { const t0 = performance.now(); realEmit(type, e); emitted.ms += performance.now() - t0; emitted.n++; };
            for (let turn = 0; turn < 60; turn++) {
                window.__rt.setup({ playerBoard: [...Array(10).fill('lands-volcanic-peak'), ...Array(6).fill('creatures-fire-fox')], playerHand: Array(4).fill('creatures-fire-fox'), playerMana: {}, landsPlayedThisTurn: 0 });
                gameState.playerBoard.filter(c => c.type === 'land').forEach(c => tapLand(c.id));
                for (let i = 0; i < 4; i++) { isProcessingAction = false; playCard(gameState.playerHand[0].id); }
                Achievements.emit('turn:start', { side: 'player', round: turn });
            }
            Achievements.emit = realEmit;
            return emitted;
        });
        await page.clock.runFor(1000);
        const writes = await page.evaluate(() => window.__writes);
        assert.ok(r.n >= 60 * 15, `events reported: ${r.n}`);
        assert.ok(r.ms / r.n < 1, `average ${(r.ms / r.n).toFixed(3)} ms per event`);
        assert.ok(writes < 40, `store written ${writes} times for ${r.n} events (counters are batched; each unlock saves once)`);
    });
});
