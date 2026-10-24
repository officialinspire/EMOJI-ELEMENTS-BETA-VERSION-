// Pack Shop and pack opening for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/packs.test.mjs        (or: npm run packs)
//
// Pack membership is explicit (PACK_MEMBERSHIP in index.js, reviewed per card; CARD_AUDIT.md §7). These tests
// check the pools it builds (Alien and Robot hold aliens and robots, Lands holds only lands, every card can be
// pulled somewhere), that the shop's contents preview and odds match what generatePack really does, that
// prices, pack size and rewards are unchanged and charged once, that NEW compares with what you owned before
// the pack, and that saves keep their format across a reload.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useGameBrowser, openGame, startMatch, act, clickAt, readMeta } from './lib/game.mjs';
import { ROOT } from './lib/harness.mjs';

useGameBrowser();

const META = 'emoji_elements_meta_v1';
const PACKS = ['fantasy', 'scifi', 'tech', 'alien', 'robot', 'fire', 'water', 'earth', 'swamp', 'light', 'artifacts', 'legendary', 'lands'];
const fixture = name => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'saves', name), 'utf8');
const total = collection => Object.values(collection).reduce((a, b) => a + b, 0);
const isOpen = (page, id) => page.evaluate(id => document.getElementById(id).classList.contains('show'), id);

async function openShop(page) {
    await page.evaluate(() => {
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
        showPackShop();
    });
    await page.clock.runFor(300);
}

// ------------------------------------------------------------------ pools

describe('pack pools', () => {
    test('every catalog card has reviewed membership, and every card is in at least one pack', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const r = await page.evaluate(() => ({
            catalog: __ALL_CARDS.map(c => c.__id),
            keys: Object.keys(PACK_MEMBERSHIP),
            empty: __ALL_CARDS.filter(c => !getPackMemberships(c).length).map(c => c.__id),
            union: [...new Set(PACK_THEMES.flatMap(theme => getThemePool(theme.key).map(c => c.__id)))].length
        }));
        assert.equal(r.catalog.length, 268);
        assert.deepEqual([...r.keys].sort(), [...r.catalog].sort(), 'membership keyed by exactly the catalog ids');
        assert.deepEqual(r.empty, []);
        assert.equal(r.union, 268, 'all 268 cards can come from a pack');
    });

    test('Alien and Robot packs hold aliens and robots, not Science Fiction or Nature filler', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const r = await page.evaluate(() => {
            const pool = key => getThemePool(key).map(c => ({ id: c.__id, name: c.name, theme: c.theme, emoji: c.emoji }));
            return { alien: pool('alien'), robot: pool('robot'), scifi: pool('scifi').map(c => c.id),
                sf: __ALL_CARDS.filter(c => c.theme === 'Science Fiction').map(c => c.__id) };
        });
        const ids = list => list.map(c => c.id);
        for (const id of ['creatures-alien-invader', 'creatures-grey-alien', 'creatures-ufo-saucer', 'creatures-men-in-black', 'creatures-astronaut-explorer']) {
            assert.ok(ids(r.alien).includes(id), `${id} is in the Alien pack`);
        }
        for (const id of ['creatures-combat-robot', 'creatures-android-guardian', 'creatures-cyborg-soldier', 'creatures-battle-mech',
            'creatures-attack-drone', 'creatures-repair-bot', 'creatures-hydrobot', 'creatures-healer-bot', 'artifacts-mech-claw']) {
            assert.ok(ids(r.robot).includes(id), `${id} is in the Robot pack`);
        }
        // Robot: only Science Fiction cards; Alien: Science Fiction plus the one cosmic Nature spell
        assert.deepEqual(r.robot.filter(c => c.theme !== 'Science Fiction'), []);
        assert.deepEqual(r.alien.filter(c => c.theme !== 'Science Fiction').map(c => c.id), ['spells-meteor-strike']);
        // Broad Science Fiction membership stays, alongside the specific packs
        assert.deepEqual([...r.scifi].sort(), [...r.sf].sort());
        assert.ok(r.alien.length >= 5 && r.robot.length >= 5);
    });

    test('Lands packs hold every land and nothing else (no Badlands Boar)', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const r = await page.evaluate(() => ({
            pool: getThemePool('lands').map(c => c.__id),
            lands: __ALL_CARDS.filter(c => c.type === 'land').map(c => c.__id),
            boar: getPackMemberships('creatures-badlands-boar')
        }));
        assert.deepEqual(r.pool, r.lands);
        assert.equal(r.pool.length, 8);
        assert.ok(!r.boar.includes('lands'));
    });

    test('generated packs: 5 different cards from the pool, each slot from its planned tiers, every card reachable', { timeout: 120000 }, async t => {
        const page = await openGame(t, { seed: 31 });
        const r = await page.evaluate(packs => packs.map(key => {
            const plan = getPackSlotPlan(key);
            const poolIds = new Set(plan.pool.map(c => c.__id));
            const seen = new Set();
            const problems = [];
            const tierCounts = { common: 0, rare: 0, 'epic+': 0 };
            const N = 3000;
            for (let i = 0; i < N; i++) {
                const ids = generatePack(key);
                if (ids.length !== PACK_SIZE || new Set(ids).size !== ids.length) problems.push(`bad pack ${ids}`);
                ids.forEach((id, slot) => {
                    if (!poolIds.has(id)) problems.push(`${id} not in pool`);
                    const tier = packTierOf(__CARD_BY_ID[id]);
                    if (!plan.slots[slot][0].includes(tier)) problems.push(`slot ${slot + 1} gave ${tier}`);
                    tierCounts[tier]++;
                    seen.add(id);
                });
            }
            const odds = getPackOdds(key);
            return { key, problems: problems.slice(0, 3), unseen: plan.pool.filter(c => !seen.has(c.__id)).map(c => c.__id),
                observed: Object.fromEntries(Object.entries(tierCounts).map(([k, v]) => [k, v / N])), expected: odds.expected };
        }), PACKS);
        for (const pack of r) {
            assert.deepEqual(pack.problems, [], pack.key);
            assert.deepEqual(pack.unseen, [], `${pack.key}: every card in the pool was pulled`);
            // getPackOdds is exact; 3000 seeded packs land within a few hundredths of it
            for (const tier of Object.keys(pack.expected)) {
                assert.ok(Math.abs(pack.observed[tier] - pack.expected[tier]) < 0.05, `${pack.key} ${tier}: ${pack.observed[tier]} vs ${pack.expected[tier]}`);
            }
        }
    });

    test('per-card odds from getPackOdds match how often each card is really pulled', { timeout: 120000 }, async t => {
        const page = await openGame(t, { seed: 32 });
        const r = await page.evaluate(() => ['robot', 'fire', 'water', 'earth', 'swamp', 'light', 'artifacts', 'legendary', 'lands', 'alien'].map(key => {
            const odds = getPackOdds(key);
            const hits = {};
            const N = 6000;
            for (let i = 0; i < N; i++) generatePack(key).forEach(id => { hits[id] = (hits[id] || 0) + 1; });
            return odds.pool.map(card => ({ key, id: card.__id, observed: (hits[card.__id] || 0) / N, expected: odds.perCard[packTierOf(card)] }));
        }).flat());
        for (const row of r) assert.ok(Math.abs(row.observed - row.expected) < 0.035, `${row.key} ${row.id}: ${row.observed} vs ${row.expected}`);
    });

    test('a small pool or a missing tier falls back as documented', { timeout: 30000 }, async t => {
        const page = await openGame(t, { seed: 33 });
        const r = await page.evaluate(() => {
            const robot = getPackSlotPlan('robot');
            // A pool with 3 cards (temporarily): the pack is completed from the catalog, still 5 different cards
            const saved = { ...PACK_MEMBERSHIP };
            ['lands-volcanic-peak', 'lands-mystic-springs', 'lands-rainbow'].forEach(id => { PACK_MEMBERSHIP[id] = ['__tiny']; });
            const tiny = generatePack('__tiny');
            const tinyPlan = getPackSlotPlan('__tiny');
            Object.keys(PACK_MEMBERSHIP).forEach(id => { PACK_MEMBERSHIP[id] = saved[id]; });
            return { robotSlot5: robot.slots[4], robotCounts: robot.counts, notes: describePackSlots('robot').notes,
                tiny, tinyPlanSlot5: tinyPlan.slots[4], unknown: generatePack('nope').length };
        });
        assert.deepEqual(r.robotCounts, { common: 12, rare: 3, 'epic+': 1 });
        assert.deepEqual(r.robotSlot5, [['epic+', 'rare'], ['common']], 'one Epic: the last slot widens to Rare');
        assert.match(r.notes[0], /only 1 Epic\/Legendary card, so it can also be Rare/);
        assert.equal(r.tiny.length, 5);
        assert.equal(new Set(r.tiny).size, 5);
        assert.ok(['lands-volcanic-peak', 'lands-mystic-springs', 'lands-rainbow'].every(id => r.tiny.includes(id)), 'the pool is used up first');
        assert.deepEqual(r.tinyPlanSlot5, [['epic+', 'rare', 'common']]);
        assert.equal(r.unknown, 5);
    });

    test('prices, pack size, win reward and win-pack theme weights are unchanged', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const r = await page.evaluate(() => ({ costs: PACK_SHOP_COSTS, size: PACK_SIZE, win: BASE_WIN_CREDITS,
            weights: Object.fromEntries(PACK_THEMES.map(theme => [theme.key, theme.weight])) }));
        assert.deepEqual(r.costs, { fantasy: 60, scifi: 60, tech: 60, alien: 60, robot: 60, legendary: 1000, lands: 40, fire: 60, water: 60, earth: 60, swamp: 60, light: 60, artifacts: 60 });
        assert.equal(r.size, 5);
        assert.equal(r.win, 25);
        assert.deepEqual(r.weights, { fantasy: 24, scifi: 18, tech: 16, alien: 14, robot: 14, legendary: 0, lands: 14, fire: 0, water: 0, earth: 0, swamp: 0, light: 0, artifacts: 0 });
    });
});

// ------------------------------------------------------------------ the shop

describe('Pack Shop', () => {
    test('each tile shows its art, price, slots and owned count; affordability follows the credits', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        await page.evaluate(() => { gameMeta.wallet.credits = 50; });
        await openShop(page);
        const read = () => page.evaluate(() => [...document.querySelectorAll('#packShopGrid .shop-pack')].map(tile => {
            const key = tile.dataset.theme;
            const buy = tile.querySelector('.shop-pack-btn');
            return {
                key,
                price: tile.querySelector('.shop-pack-price').textContent,
                slots: tile.querySelector('.shop-pack-slots').textContent,
                expectedSlots: describePackSlotsShort(key),
                owned: tile.querySelector('[data-role="owned"]').textContent,
                expectedOwned: `${getPackSlotPlan(key).pool.length} cards · you have ${getPackSlotPlan(key).pool.filter(c => gameMeta.collection[c.__id] > 0).length}`,
                art: tile.querySelectorAll('.shop-pack-art-strip span').length,
                unaffordable: tile.classList.contains('is-unaffordable'),
                ariaLabel: buy.getAttribute('aria-label'),
                label: buy.textContent
            };
        }));
        const tiles = await read();
        assert.deepEqual(tiles.map(t => t.key), PACKS);
        for (const tile of tiles) {
            assert.equal(tile.price, `💳 ${tile.key === 'lands' ? 40 : tile.key === 'legendary' ? 1000 : 60}`);
            assert.equal(tile.slots, tile.expectedSlots);
            assert.equal(tile.owned, tile.expectedOwned);
            assert.ok(tile.art >= 3, `${tile.key} art shows sample cards`);
            const affordable = tile.key === 'lands';
            assert.equal(tile.unaffordable, !affordable, tile.key);
            assert.match(tile.ariaLabel, affordable ? /^Buy .* Pack for 40 credits$/ : tile.key === 'legendary' ? /Pack: you need 950 more credits$/ : /Pack: you need 10 more credits$/);
            assert.equal(tile.label, affordable ? 'BUY · 💳 40' : tile.key === 'legendary' ? 'NEED 950 MORE' : 'NEED 10 MORE');
        }
        await page.evaluate(() => { gameMeta.wallet.credits = 60; updatePackShopCreditsBadge(); });
        assert.ok((await read()).every(tile => tile.unaffordable === (tile.key === 'legendary')), 'standard packs affordable at 60; vault remains premium');
    });

    test('"What\'s inside" lists exactly the pool, with owned counts and the exact odds; Esc closes it', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await openShop(page);
        for (const key of PACKS) {
            await page.evaluate(key => document.querySelector(`.shop-pack-info[data-theme="${key}"]`).click(), key);
            await page.clock.runFor(100);
            const r = await page.evaluate(key => {
                const odds = getPackOdds(key);
                return {
                    open: document.getElementById('packContentsModal').classList.contains('show'),
                    listed: [...document.querySelectorAll('#packContentsList .pack-contents-row')].map(row => row.dataset.cardId),
                    pool: odds.pool.map(c => c.__id),
                    owned: [...document.querySelectorAll('#packContentsList .pack-contents-row')].every(row =>
                        row.querySelector('.pack-contents-owned').textContent === ((gameMeta.collection[row.dataset.cardId] || 0) ? `Owned ×${gameMeta.collection[row.dataset.cardId]}` : 'Not owned')),
                    summary: document.getElementById('packContentsSummary').textContent.replace(/\s+/g, ' '),
                    chances: ['common', 'rare', 'epic+'].filter(t => odds.counts[t]).map(t => formatPackChance(odds.perCard[t])),
                    size: odds.pool.length,
                    slots: describePackSlotsShort(key),
                    notes: describePackSlots(key).notes
                };
            }, key);
            assert.ok(r.open, key);
            assert.deepEqual([...r.listed].sort(), [...r.pool].sort(), `${key}: every card listed once`);
            assert.ok(r.owned, `${key}: owned counts`);
            assert.ok(r.summary.includes(`${r.size} cards can be in this pack`), r.summary);
            assert.ok(r.summary.includes(r.slots), r.summary);
            r.chances.forEach(chance => assert.ok(r.summary.includes(`each in ${chance} of packs`), `${key}: ${chance} in ${r.summary}`));
            r.notes.forEach(note => assert.ok(r.summary.includes(note), note));
            await page.keyboard.press('Escape');
            await page.clock.runFor(100);
            assert.equal(await isOpen(page, 'packContentsModal'), false, `${key}: Esc closes`);
        }
        assert.equal(await page.evaluate(() => document.getElementById('packShopScreen').style.display), 'block', 'Esc closed only the dialog');
    });

    test('a purchase charges once, even with a double click, Enter, or the contents dialog', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await openShop(page);
        const before = await readMeta(page);
        await page.evaluate(() => {
            const button = document.querySelector('.shop-pack-btn[data-theme="robot"]');
            button.click();
            button.click(); // the second click lands while the pack is open
        });
        const r1 = await page.evaluate(() => purchasePack('robot'));
        assert.deepEqual([r1.ok, r1.reason], [false, 'pack_open']);
        await page.clock.runFor(300);
        let after = await readMeta(page);
        assert.equal(after.wallet.credits, before.wallet.credits - 60);
        assert.equal(total(after.collection), total(before.collection) + 5);
        assert.equal(after.stats.packsOpened, before.stats.packsOpened + 1);
        assert.equal(after.lastPack.themeKey, 'robot');
        await page.evaluate(() => closePackOpeningOverlay());
        await page.clock.runFor(300);
        // Buy from the contents dialog with the keyboard: Enter, then Enter again on whatever has focus
        await page.evaluate(() => showPackContents('lands'));
        await page.clock.runFor(100);
        await page.focus('#packContentsBuyBtn');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.clock.runFor(300);
        after = await readMeta(page);
        assert.equal(after.wallet.credits, before.wallet.credits - 100, 'Robot 60 + Lands 40, each once');
        assert.equal(after.lastPack.themeKey, 'lands');
        assert.equal(after.stats.packsOpened, before.stats.packsOpened + 2);
        assert.equal(await isOpen(page, 'packContentsModal'), false);
    });

    test('too few credits: the button says how many more, and buying changes nothing', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        await page.evaluate(() => { gameMeta.wallet.credits = 30; metaSave(gameMeta); });
        await openShop(page);
        const before = await page.evaluate(k => localStorage.getItem(k), META);
        // A keyboard user: the button stays pressable when you can't afford it, and says why
        await page.evaluate(() => { shopPage = PACK_THEMES.findIndex(p => p.key === 'lands'); renderShopPage(); });
        await page.focus('.shop-pack-btn[data-theme="lands"]');
        await page.keyboard.press('Enter');
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(k => localStorage.getItem(k), META), before);
        assert.match(await page.textContent('#packShopMessage'), /Not enough credits yet \(30\/40\)/);
        assert.equal(await page.textContent('.shop-pack-btn[data-theme="lands"]'), 'NEED 10 MORE');
        assert.equal(await isOpen(page, 'packOpeningOverlay'), false);
    });
});

// ------------------------------------------------------------------ opening a pack

describe('pack opening', () => {
    test('NEW compares with what you owned before the pack; owned counts include it', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 41 });
        await openShop(page);
        // Own 2 of every Robot card except the three commons below, which you have never had
        const unowned = ['creatures-combat-robot', 'creatures-android-guardian', 'creatures-cyborg-soldier'];
        await page.evaluate(unowned => {
            getThemePool('robot').forEach(c => { gameMeta.collection[c.__id] = unowned.includes(c.__id) ? 0 : 2; });
            delete gameMeta.collection['creatures-combat-robot'];
        }, unowned);
        await page.evaluate(() => purchasePack('robot'));
        await clickAt(page, '#packOpenBtn');
        await page.clock.runFor(1000);
        const cards = [];
        for (let i = 0; i < 5; i++) {
            cards.push(await page.evaluate(() => ({
                id: packOpeningState.cards[packOpeningState.currentIndex].__id,
                isNew: document.getElementById('packCardViewport').classList.contains('is-new'),
                owned: document.getElementById('packCardOwned').textContent.replace(/\s+/g, ' ').trim(),
                now: gameMeta.collection[packOpeningState.cards[packOpeningState.currentIndex].__id]
            })));
            if (i < 4) await clickAt(page, '#packNextBtn');
            await page.clock.runFor(300);
        }
        for (const card of cards) {
            const wasUnowned = unowned.includes(card.id);
            assert.equal(card.isNew, wasUnowned, card.id);
            assert.equal(card.owned, wasUnowned ? '✨ NEW First copy' : `You own 3 (had 2)`, card.id);
            assert.equal(card.now, wasUnowned ? 1 : 3);
        }
        // The summary agrees
        await clickAt(page, '#packSummaryBtn');
        await page.clock.runFor(200);
        const summary = await page.evaluate(() => ({
            items: [...document.querySelectorAll('#packSummaryGrid .pack-summary-card')].map(b => ({ isNew: b.classList.contains('is-new'), text: b.textContent })),
            stats: document.getElementById('packSummaryStats').textContent,
            focus: document.activeElement.id
        }));
        const newCount = cards.filter(c => unowned.includes(c.id)).length;
        assert.equal(summary.items.length, 5);
        assert.equal(summary.items.filter(i => i.isNew).length, newCount);
        assert.match(summary.stats, newCount ? new RegExp(`^${newCount} new to your collection`) : /^No new cards/);
        assert.equal(summary.focus, 'packDoneBtn');
    });

    test('after a reload the last pack retains its acquisition identity and knows what was new', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 42 });
        await page.evaluate(() => { getThemePool('alien').forEach(c => { delete gameMeta.collection[c.__id]; }); metaSave(gameMeta); purchasePack('alien'); closePackOpeningOverlay(); });
        const meta = await readMeta(page);
        assert.deepEqual(Object.keys(meta.lastPack).sort(), ['acquisitionId', 'cardIds', 'openedAt', 'themeKey'], 'lastPack adds only its acquisition identity');
        await page.reload();
        await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
        assert.equal((await readMeta(page)).lastPack.acquisitionId, meta.lastPack.acquisitionId, 'identity survives reload');
        const r = await page.evaluate(() => gameMeta.lastPack.cardIds.map(id => getPackOwnedBefore(id)));
        assert.deepEqual(r, [0, 0, 0, 0, 0]);
    });

    test('the pack opens with a button, shows full card information, and DONE closes it', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 43 });
        await page.evaluate(() => {
            gameMeta.lastPack = { themeKey: 'tech', cardIds: ['creatures-satellite-drone', 'artifacts-bomb', 'lands-rainbow', 'spells-wrestle', 'creatures-phantom-train'], openedAt: 'x' };
            openPackOpeningOverlayFromMeta('shop');
        });
        await page.clock.runFor(200);
        const sealed = await page.evaluate(() => ({ label: document.getElementById('packSealedLabel').textContent, theme: document.getElementById('packOpeningOverlay').dataset.theme,
            title: document.querySelector('.pack-opening-title').textContent }));
        assert.deepEqual(sealed, { label: 'Tech Pack', theme: 'tech', title: '🛒 Tech Pack' });
        await page.focus('#packOpenBtn');
        await page.keyboard.press('Enter');
        await page.clock.runFor(1000);
        const text = [];
        for (let i = 0; i < 5; i++) {
            text.push(await page.evaluate(() => document.getElementById('packCardViewport').innerText.replace(/\s+/g, ' ')));
            if (i < 4) await clickAt(page, '#packNextBtn');
            await page.clock.runFor(300);
        }
        assert.match(text[0], /Satellite Drone.*Rare.*Flying.*Vigilance/i, text[0]);
        assert.match(text[1], /Bomb.*Common.*Deals 2 damage to each enemy creature/i, text[1]);
        assert.match(text[2], /Rainbow.*Epic.*Tap to add .*Fire or .*Water/i, text[2]);
        assert.match(text[3], /Wrestle.*Rare/i, text[3]);
        assert.match(text[4], /Phantom Train.*Legendary/i, text[4]);
        assert.equal(await page.evaluate(() => document.getElementById('packNextBtn').disabled), true, 'NEXT stops at the last card');
        await clickAt(page, '#packSummaryBtn');
        await page.clock.runFor(200);
        await clickAt(page, '#packDoneBtn');
        await page.clock.runFor(300);
        assert.equal(await isOpen(page, 'packOpeningOverlay'), false);
    });

    test('win reward: one pack and +25 credits, once; the Victory Pack names its theme', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 44 });
        await startMatch(page);
        const before = await readMeta(page);
        await act(page, () => { changeEnemyLife(-20); finalizeMatch('win'); finalizeMatch('win'); });
        await page.clock.runFor(1000);
        await clickAt(page, '#matchRewardOverlay button');
        await page.clock.runFor(400);
        const after = await readMeta(page);
        assert.equal(after.wallet.credits, before.wallet.credits + 25);
        assert.deepEqual([after.stats.wins, after.stats.packsOpened], [1, 1]);
        assert.equal(total(after.collection), total(before.collection) + 5);
        const label = await page.evaluate(() => PACK_THEMES.find(theme => theme.key === gameMeta.lastPack.themeKey).label);
        assert.equal(await page.textContent('.pack-opening-title'), `🎁 Victory Pack · ${label}`);
        const pool = await page.evaluate(() => getThemePool(gameMeta.lastPack.themeKey).map(c => c.__id));
        assert.ok(after.lastPack.cardIds.every(id => pool.includes(id)), 'the reward comes from its theme pool');
    });
});

// ------------------------------------------------------------------ saves

describe('saved data', () => {
    test('an existing save: shop works, purchases persist across a reload, and the save keeps its shape', { timeout: 60000 }, async t => {
        const page = await openGame(t, { storage: { [META]: fixture('existing.json') } });
        const before = await readMeta(page);
        await openShop(page);
        assert.match(await page.textContent('#shopCreditsBadge'), /135/);
        const result = await page.evaluate(() => purchasePack('alien'));
        assert.equal(result.ok, true);
        await page.evaluate(() => closePackOpeningOverlay());
        const after = await readMeta(page);
        assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'same top-level keys');
        assert.deepEqual(Object.keys(after.lastPack).sort(), ['acquisitionId', 'cardIds', 'openedAt', 'themeKey']);
        assert.equal(typeof after.lastPack.acquisitionId, 'string');
        assert.ok(after.lastPack.acquisitionId.length > 0);
        assert.equal(after.wallet.credits, 75);
        assert.equal(after.stats.packsOpened, before.stats.packsOpened + 1);
        await page.reload();
        await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
        const reloaded = await readMeta(page);
        assert.deepEqual(reloaded.collection, after.collection);
        assert.deepEqual(reloaded.lastPack, after.lastPack);
        assert.equal(reloaded.wallet.credits, 75);
        assert.deepEqual(reloaded.decks, after.decks, 'decks untouched');
    });
});
