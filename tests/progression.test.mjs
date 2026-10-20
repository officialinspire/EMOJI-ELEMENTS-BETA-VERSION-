// Progression and saved data for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/progression.test.mjs        (or: npm run progression)
//
// Saved-data fixtures in tests/fixtures/saves/ were written by the build before this hardening pass,
// so these tests prove that real players' saves keep their progress. Rules: PROGRESSION.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useGameBrowser, openGamePage, startMatch, act, clickAt } from './lib/game.mjs';
import { ROOT } from './lib/harness.mjs';

useGameBrowser();

const META = 'emoji_elements_meta_v1';
const BACKUPS = 'emoji_elements_meta_backups';
const LEGACY_STATS = 'emojiElementsStats';
const fixture = name => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'saves', name), 'utf8');
const ALL_DECKS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT', 'FIRE_WATER', 'FIRE_EARTH', 'FIRE_SWAMP', 'FIRE_LIGHT',
    'WATER_EARTH', 'WATER_SWAMP', 'WATER_LIGHT', 'EARTH_SWAMP', 'EARTH_LIGHT', 'SWAMP_LIGHT'];

async function open(t, options = {}) {
    const session = await openGamePage(options);
    t.after(session.close);
    return session.page;
}

const stored = (page, key = META) => page.evaluate(k => localStorage.getItem(k), key);
const storedMeta = async page => JSON.parse(await stored(page));
const backups = async page => JSON.parse(await stored(page, BACKUPS) || '[]');
const reload = async page => { await page.reload(); await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; }); };
const counts = ids => ids.reduce((acc, id) => ({ ...acc, [id]: (acc[id] || 0) + 1 }), {});
const total = collection => Object.values(collection).reduce((a, b) => a + b, 0);

// Every deck in the save checked with the game's own validator.
const deckReport = page => page.evaluate(() => Object.fromEntries(Object.entries(gameMeta.decks).map(([key, deck]) => {
    const verdict = validateDeckBuild(key, deck.cardIds, gameMeta);
    return [key, { size: deck.cardIds.length, ok: verdict.ok, errors: verdict.errors.slice(0, 3) }];
})));

// ------------------------------------------------------------------ fresh profile

describe('fresh profile', () => {
    test('a new player gets 100 credits, the starter collection and 15 legal 60-card decks', { timeout: 60000 }, async t => {
        const page = await open(t);
        const meta = await storedMeta(page);
        assert.equal(meta.version, 1);
        assert.equal(meta.wallet.credits, 100);
        assert.deepEqual(meta.stats, { wins: 0, losses: 0, packsOpened: 0 });
        assert.equal(meta.selectedDeckKey, 'FIRE');
        assert.deepEqual(Object.keys(meta.decks).sort(), [...ALL_DECKS].sort());
        assert.equal(Object.keys(meta.collection).length, 153);
        assert.equal(total(meta.collection), 300);
        const report = await deckReport(page);
        const bad = Object.entries(report).filter(([, r]) => !r.ok || r.size !== 60);
        assert.deepEqual(bad, [], 'every starter deck is legal and owned');
        assert.equal(await stored(page, BACKUPS), null, 'nothing to back up');
    });

    test('reloading a save changes nothing and writes no backup', { timeout: 60000 }, async t => {
        const page = await open(t);
        const first = await stored(page);
        await reload(page);
        await reload(page);
        assert.equal(await stored(page), first);
        assert.equal(await stored(page, BACKUPS), null);
    });

    test('starter decks resolve the README tension: lands are exempt, non-lands use at most 2 copies (legendary 1)', { timeout: 60000 }, async t => {
        const page = await open(t);
        const shapes = await page.evaluate(() => Object.fromEntries(Object.entries(gameMeta.decks).map(([key, deck]) => {
            const copies = {};
            deck.cardIds.forEach(id => { copies[id] = (copies[id] || 0) + 1; });
            const nonLand = Object.entries(copies).filter(([id]) => __CARD_BY_ID[id].type !== 'land');
            return [key, {
                lands: deck.cardIds.filter(id => __CARD_BY_ID[id].type === 'land').length,
                nonLands: nonLand.reduce((sum, [, n]) => sum + n, 0),
                maxNonLandCopies: Math.max(...nonLand.map(([, n]) => n)),
                legendaryOverOne: nonLand.filter(([id, n]) => __CARD_BY_ID[id].__rarity === 'legendary' && n > 1).length
            }];
        })));
        for (const [key, shape] of Object.entries(shapes)) {
            const dual = key.includes('_');
            assert.deepEqual([shape.lands, shape.nonLands], dual ? [22, 38] : [20, 40], `${key} land split`);
            assert.ok(shape.maxNonLandCopies <= 2, `${key} non-land copies`);
            assert.equal(shape.legendaryOverOne, 0, `${key} legendary copies`);
        }
    });

    test('every legal saved deck is the exact deck you play with', { timeout: 120000 }, async t => {
        const page = await open(t);
        for (const key of ALL_DECKS) {
            const elements = key.toLowerCase().split('_');
            await startMatch(page, { mode: elements.length === 1 ? 'single' : 'dual', elements });
            const played = await page.evaluate(k => ({
                cards: [...gameState.playerDeck, ...gameState.playerHand].map(c => c.__id).sort(),
                saved: [...gameMeta.decks[k].cardIds].sort(),
                selected: gameMeta.selectedDeckKey
            }), key);
            assert.deepEqual(played.cards, played.saved, `${key} plays its saved list`);
            assert.equal(played.selected, key);
        }
    });
});

// ------------------------------------------------------------------ deck rules

describe('deck identity and limits', () => {
    test('colour identity: mono decks take their colour and colourless; dual decks take both colours', { timeout: 60000 }, async t => {
        const page = await open(t);
        const legal = await page.evaluate(() => {
            const test = (id, key) => isCardEligibleForDeck(__CARD_BY_ID[id], getDeckColorsFromKey(key));
            return {
                fireInFire: test('creatures-fire-fox', 'FIRE'),
                waterInFire: test('creatures-mystic-dolphin', 'FIRE'),
                colorlessInFire: test('artifacts-prism-core', 'FIRE'),
                twoColourInMono: test('spells-web-trap', 'FIRE'),
                twoColourInDual: test('spells-web-trap', 'FIRE_SWAMP'),
                twoColourWrongDual: test('spells-web-trap', 'FIRE_WATER'),
                rainbowAnywhere: ['FIRE', 'SWAMP_LIGHT'].every(k => test('lands-rainbow', k)),
                planetInLight: test('lands-distant-planet', 'LIGHT'),
                planetInFire: test('lands-distant-planet', 'FIRE'),
                wastelandAnywhere: test('lands-crystal-wasteland', 'FIRE')
            };
        });
        assert.deepEqual(legal, {
            fireInFire: true, waterInFire: false, colorlessInFire: true, twoColourInMono: false,
            twoColourInDual: true, twoColourWrongDual: false, rainbowAnywhere: true, planetInLight: true,
            planetInFire: false, wastelandAnywhere: false
        });
    });

    test('copy, ownership, size and land limits are enforced on save', { timeout: 60000 }, async t => {
        const page = await open(t);
        const errors = await page.evaluate(() => {
            const fire = gameMeta.decks.FIRE.cardIds;
            const nonLand = fire.find(id => __CARD_BY_ID[id].type !== 'land');
            const withCards = (extra, removeCount = extra.length) => {
                const list = fire.slice();
                for (let i = 0; i < removeCount; i++) list.splice(list.findIndex(id => __CARD_BY_ID[id].type !== 'land'), 1);
                return [...list, ...extra];
            };
            const check = list => validateDeckBuild('FIRE', list, gameMeta).errors.join(' | ');
            gameMeta.collection['creatures-ancient-dragon'] = 3; // owned legendary
            gameMeta.collection['creatures-fire-fox'] = 5;
            return {
                starter: check(fire),
                threeCopies: check(withCards(Array(3).fill('creatures-fire-fox'))),
                twoLegendary: check(withCards(['creatures-ancient-dragon', 'creatures-ancient-dragon'])),
                unowned: check(withCards(['creatures-phoenix'])),
                size59: check(fire.slice(1)),
                size61: check([...fire, nonLand]),
                lands21: check(withCards(['lands-volcanic-peak'])),
                offColour: check(withCards(['creatures-mystic-dolphin']))
            };
        });
        assert.equal(errors.starter, '');
        assert.match(errors.threeCopies, /max copies \(2\)/);
        assert.match(errors.twoLegendary, /max copies \(1, legendary limit\)/);
        assert.match(errors.unowned, /exceeds owned copies \(1\/0\)/);
        assert.match(errors.size59, /exactly 60 cards \(currently 59\)/);
        assert.match(errors.size61, /exactly 60 cards \(currently 61\)/);
        assert.match(errors.lands21, /at most 20 lands/);
        assert.match(errors.offColour, /not valid for FIRE identity/);
    });

    test('dual land caps: 11 per colour, 22 total; Rainbow counts toward the emptier colour', { timeout: 60000 }, async t => {
        const page = await open(t);
        const result = await page.evaluate(() => {
            gameMeta.collection['lands-rainbow'] = 2;
            gameMeta.collection['lands-volcanic-peak'] = 30;
            const deck = gameMeta.decks.FIRE_WATER.cardIds;
            const swap = (from, to) => { const list = deck.slice(); list[list.indexOf(from)] = to; return list; };
            const twelveFire = swap('lands-mystic-springs', 'lands-volcanic-peak');
            const rainbowForWater = swap('lands-mystic-springs', 'lands-rainbow');
            return {
                twelveFire: validateDeckBuild('FIRE_WATER', twelveFire, gameMeta).errors.join(' | '),
                rainbowForWater: validateDeckBuild('FIRE_WATER', rainbowForWater, gameMeta).ok
            };
        });
        assert.match(result.twelveFire, /at most 11 fire lands \(currently 12\)/);
        assert.equal(result.rainbowForWater, true);
    });

    test('Deck Builder: cannot add past owned copies; an edited deck saves and survives a reload', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        await page.evaluate(() => { document.getElementById('startModal').style.display = 'flex'; showDeckBuilder(); });
        assert.equal(await page.inputValue('#deckBuilderDeckKey'), 'EARTH_LIGHT', 'opens on the selected deck');
        const result = await page.evaluate(() => {
            document.getElementById('deckBuilderDeckKey').value = 'FIRE';
            document.getElementById('deckBuilderDeckKey').dispatchEvent(new Event('change'));
            const working = deckBuilderState.workingCardIds;
            const owned = gameMeta.collection;
            const label = id => `${__CARD_BY_ID[id].emoji} ${__CARD_BY_ID[id].name}`;
            const plus = id => [...document.querySelectorAll('#deckBuilderPool .deck-builder-row')]
                .find(row => row.querySelector('.deck-builder-name').textContent === label(id)).querySelector('button');
            // A card owned once and already in the deck once: a second copy must be refused.
            const ownedOnce = working.find(id => __CARD_BY_ID[id].type !== 'land' && owned[id] === 1);
            const removed = working.find(id => __CARD_BY_ID[id].type !== 'land' && id !== ownedOnce);
            [...document.querySelectorAll('#deckBuilderDeck .deck-builder-row')]
                .find(row => row.querySelector('.deck-builder-name').textContent === label(removed)).querySelector('button').click();
            plus(ownedOnce).click();
            const refusedSize = deckBuilderState.workingCardIds.length;
            const status = document.getElementById('deckBuilderStatus').textContent;
            // Add an owned FIRE-legal card that has room (a pack pull if possible), then save.
            const room = id => __CARD_BY_ID[id].type !== 'land' && isCardEligibleForDeck(__CARD_BY_ID[id], ['fire']) &&
                deckBuilderState.workingCardIds.filter(x => x === id).length < Math.min(2, owned[id]);
            const added = (gameMeta.lastPack?.cardIds || []).find(room) || Object.keys(owned).find(id => id !== removed && room(id)) || removed;
            plus(added).click();
            document.querySelector('#deckBuilderScreen button[onclick="saveDeckBuilderDeck()"]').click();
            return { refusedSize, status, saved: [...gameMeta.decks.FIRE.cardIds].sort() };
        });
        assert.equal(result.refusedSize, 59, 'second copy of a card owned once was refused');
        assert.match(result.status, /no owned copies remaining/i);
        await reload(page);
        assert.deepEqual(await page.evaluate(() => [...gameMeta.decks.FIRE.cardIds].sort()), result.saved, 'saved deck survives a reload');
        assert.equal((await deckReport(page)).FIRE.ok, true);
    });
});

// ------------------------------------------------------------------ existing and damaged saves

describe('existing and damaged saves', () => {
    test('existing profile: progress kept exactly; the untouched FIRE_SWAMP starter becomes the current legal starter', { timeout: 60000 }, async t => {
        const before = JSON.parse(fixture('existing.json'));
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        const after = await storedMeta(page);
        assert.deepEqual(after.collection, before.collection, 'collection untouched');
        assert.deepEqual(after.wallet, before.wallet);
        assert.deepEqual(after.stats, before.stats);
        assert.deepEqual(after.lastPack, before.lastPack);
        assert.equal(after.selectedDeckKey, 'EARTH_LIGHT');
        assert.deepEqual(after.decks.FIRE.cardIds, before.decks.FIRE.cardIds, 'edited deck kept exactly');
        const report = await deckReport(page);
        assert.deepEqual(Object.entries(report).filter(([, r]) => !r.ok), [], 'every deck legal after load');
        const fireSwamp = after.decks.FIRE_SWAMP.cardIds;
        assert.equal(fireSwamp.length, 60);
        assert.ok(!fireSwamp.includes('spells-web-trap'));
        const saved = await backups(page);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].reason, 'repair');
        assert.equal(saved[0].raw, fixture('existing.json'), 'exact previous save kept as a backup');
    });

    test('older profile without dual decks: dual decks added from owned cards; nothing granted', { timeout: 60000 }, async t => {
        const before = JSON.parse(fixture('preDual.json'));
        const page = await open(t, { storage: { [META]: fixture('preDual.json') } });
        const after = await storedMeta(page);
        assert.deepEqual(after.collection, before.collection, 'no cards granted');
        assert.equal(after.wallet.credits, 40);
        assert.deepEqual(Object.keys(after.decks).sort(), [...ALL_DECKS].sort());
        for (const key of ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT']) assert.deepEqual(after.decks[key].cardIds, before.decks[key].cardIds);
        const report = await deckReport(page);
        assert.deepEqual(Object.entries(report).filter(([, r]) => !r.ok), []);
    });

    test('partial save (no version, numbers as strings): repaired, not wiped', { timeout: 60000 }, async t => {
        const before = JSON.parse(fixture('partial.json'));
        const page = await open(t, { storage: { [META]: fixture('partial.json') } });
        const after = await storedMeta(page);
        assert.equal(after.version, 1);
        assert.deepEqual(after.collection, before.collection, 'collection kept');
        assert.equal(after.wallet.credits, 250, 'credits "250" kept as 250');
        assert.deepEqual(after.stats, { wins: 3, losses: 2, packsOpened: 1 });
        assert.deepEqual(after.decks.FIRE.cardIds, before.decks.FIRE.cardIds);
        assert.equal(after.decks.FIRE.starterCardIds.length, 60, 'starter list restored, so the deck size target is 60');
        assert.deepEqual(Object.keys(after.decks).sort(), [...ALL_DECKS].sort());
        assert.equal((await backups(page))[0].raw, fixture('partial.json'));
    });

    test('save from a newer version: kept in a backup and salvaged, not wiped', { timeout: 60000 }, async t => {
        const before = JSON.parse(fixture('future.json'));
        const page = await open(t, { storage: { [META]: fixture('future.json') } });
        const after = await storedMeta(page);
        assert.deepEqual(after.collection, before.collection);
        assert.equal(after.wallet.credits, 500);
        assert.deepEqual(after.stats, before.stats);
        const saved = await backups(page);
        assert.equal(saved[0].reason, 'unsupported-version');
        assert.equal(saved[0].raw, fixture('future.json'), 'the newer data (achievements, gems) survives in the backup');
    });

    test('corrupt save: the game starts fresh and the unreadable text is kept in a backup', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('corrupt.txt') } });
        const after = await storedMeta(page);
        assert.equal(after.wallet.credits, 100);
        const saved = await backups(page);
        assert.equal(saved[0].reason, 'corrupt');
        assert.equal(saved[0].raw, fixture('corrupt.txt'));
    });

    test('a removed card id is dropped from the collection and decks, with the previous save backed up', { timeout: 60000 }, async t => {
        const before = JSON.parse(fixture('renamed.json'));
        const page = await open(t, { storage: { [META]: fixture('renamed.json') } });
        const after = await storedMeta(page);
        const expected = { ...before.collection };
        delete expected['creatures-flame-fox'];
        assert.deepEqual(after.collection, expected);
        assert.ok(!after.decks.FIRE.cardIds.includes('creatures-flame-fox'));
        assert.equal(after.wallet.credits, before.wallet.credits);
        assert.ok((await backups(page))[0].raw.includes('creatures-flame-fox'), 'the backup still has the old copies');
    });

    test('legacy stats from the pre-meta build are carried into the new save', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [LEGACY_STATS]: fixture('legacy-stats.json') } });
        const after = await storedMeta(page);
        assert.deepEqual([after.stats.wins, after.stats.losses], [5, 3]);
        const shown = await page.evaluate(() => { document.getElementById('startModal').style.display = 'flex'; showStats(); return document.getElementById('gamesWon').textContent; });
        assert.equal(shown, '5');
    });

    test('a repaired save is stable: the next loads change nothing and add no backups', { timeout: 90000 }, async t => {
        for (const name of ['existing.json', 'preDual.json', 'partial.json', 'future.json', 'renamed.json', 'corrupt.txt']) {
            const page = await open(t, { storage: { [META]: fixture(name) } });
            const repaired = await stored(page);
            const backupCount = (await backups(page)).length;
            await reload(page);
            await reload(page);
            assert.equal(await stored(page), repaired, `${name}: profile unchanged on reload`);
            assert.equal((await backups(page)).length, backupCount, `${name}: no extra backups`);
        }
    });

    test("an existing profile's edited and migrated decks play exactly as saved", { timeout: 90000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        for (const key of ['FIRE', 'FIRE_SWAMP', 'EARTH_LIGHT']) {
            const elements = key.toLowerCase().split('_');
            await startMatch(page, { mode: elements.length === 1 ? 'single' : 'dual', elements });
            const played = await page.evaluate(k => ({
                cards: [...gameState.playerDeck, ...gameState.playerHand].map(c => c.__id).sort(),
                saved: [...gameMeta.decks[k].cardIds].sort()
            }), key);
            assert.equal(played.cards.length, 60, key);
            assert.deepEqual(played.cards, played.saved, `${key} plays its saved list`);
        }
    });

    test('backups are capped at 3 and the newest is kept', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('partial.json') } });
        for (let i = 0; i < 4; i++) {
            await page.evaluate(k => localStorage.setItem(k, '{broken'), META);
            await reload(page);
        }
        const saved = await backups(page);
        assert.equal(saved.length, 3);
        assert.ok(saved.every(b => b.raw === '{broken'));
    });
});

// ------------------------------------------------------------------ credits, packs and the binder

describe('credits, packs and the binder', () => {
    test('buying a pack spends exactly its price and adds 5 different cards, and it persists', { timeout: 60000 }, async t => {
        const page = await open(t);
        const before = await storedMeta(page);
        const result = await page.evaluate(() => purchasePack('fantasy'));
        assert.equal(result.ok, true);
        const after = await storedMeta(page);
        assert.equal(after.wallet.credits, 40);
        assert.equal(after.lastPack.cardIds.length, 5);
        assert.equal(new Set(after.lastPack.cardIds).size, 5, 'no duplicates within a pack');
        assert.equal(total(after.collection), total(before.collection) + 5);
        assert.equal(after.stats.packsOpened, 1, 'shop packs count as opened');
        await reload(page);
        assert.deepEqual((await storedMeta(page)).collection, after.collection);
    });

    test('insufficient credits: nothing changes', { timeout: 60000 }, async t => {
        const page = await open(t);
        await page.evaluate(() => { gameMeta.wallet.credits = 59; metaSave(gameMeta); });
        const before = await stored(page);
        const result = await page.evaluate(() => purchasePack('fantasy'));
        assert.deepEqual([result.ok, result.reason], [false, 'insufficient_credits']);
        assert.equal(await stored(page), before);
        assert.equal(await page.evaluate(() => document.getElementById('packOpeningOverlay').classList.contains('show')), false);
    });

    test('duplicate pulls stack in the collection and the Binder; each pack has 3 common, 1 rare and 1 epic-or-better slot', { timeout: 120000 }, async t => {
        const page = await open(t, { seed: 9 });
        const result = await page.evaluate(() => {
            gameMeta.wallet.credits = 2000;
            const packs = [];
            for (let i = 0; i < 30; i++) {
                const r = purchasePack(['fantasy', 'scifi', 'tech', 'alien', 'robot', 'lands'][i % 6]);
                packs.push({ theme: r.themeKey, rarities: r.cardIds.map(id => __CARD_BY_ID[id].__rarity) });
                closePackOpeningOverlay();
            }
            document.getElementById('startModal').style.display = 'flex';
            showBinder();
            const rows = [...document.querySelectorAll('#binderList .binder-row')].map(r => ({
                name: r.querySelector('.binder-row-name').firstChild.textContent.trim(),
                count: Number(r.querySelector('.binder-row-count').textContent.slice(1))
            }));
            const owned = Object.entries(gameMeta.collection).filter(([, n]) => n > 0);
            return {
                packs, rows,
                badge: document.getElementById('binderSummaryBadge').textContent,
                unique: owned.length,
                totalCards: owned.reduce((s, [, n]) => s + n, 0),
                duplicates: owned.filter(([, n]) => n >= 3).length,
                sorted: rows.map(r => r.name).join('|') === rows.map(r => r.name).sort((a, b) => a.localeCompare(b)).join('|'),
                credits: gameMeta.wallet.credits,
                spent: [0, 1, 2, 3, 4, 5].reduce((s, i) => s + 5 * [60, 60, 60, 60, 60, 40][i], 0)
            };
        });
        assert.equal(result.credits, 2000 - result.spent);
        assert.equal(result.rows.length, result.unique);
        assert.equal(result.rows.reduce((s, r) => s + r.count, 0), result.totalCards);
        assert.equal(result.badge, `🗂️ ${result.unique} unique cards • ${result.totalCards} total cards`);
        assert.ok(result.sorted, 'binder sorted by name');
        assert.ok(result.duplicates > 0, 'duplicates accumulate');
        for (const pack of result.packs.filter(p => p.theme !== 'lands')) {
            const tier = r => (r === 'common' ? 'common' : r === 'rare' ? 'rare' : 'epic+');
            assert.deepEqual(pack.rarities.map(tier), ['common', 'common', 'common', 'rare', 'epic+'], `${pack.theme} pack slots`);
        }
    });

    test('pack overlay: title names the pack source, and no debug text is shown', { timeout: 60000 }, async t => {
        const page = await open(t);
        const shop = await page.evaluate(() => {
            purchasePack('scifi');
            return { title: document.querySelector('.pack-opening-title').textContent, debug: getComputedStyle(document.getElementById('packQaDebug')).display };
        });
        assert.match(shop.title, /Science Fiction Pack/);
        assert.equal(shop.debug, 'none');
    });
});

// ------------------------------------------------------------------ match rewards

describe('match rewards', () => {
    test('win: +25 credits and a pack, recorded once; OPEN BOOSTER works with a real click', { timeout: 60000 }, async t => {
        const page = await open(t);
        await startMatch(page);
        const before = await storedMeta(page);
        await act(page, () => { changeEnemyLife(-20); finalizeMatch('win'); });
        await page.clock.runFor(1000);
        const box = await page.locator('#matchRewardOverlay button').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.clock.runFor(400);
        assert.equal(await page.evaluate(() => document.getElementById('packOpeningOverlay').classList.contains('show')), true, 'OPEN BOOSTER opened the pack');
        assert.match(await page.textContent('.pack-opening-title'), /Victory Pack/);
        const after = await storedMeta(page);
        assert.equal(after.wallet.credits, before.wallet.credits + 25);
        assert.deepEqual([after.stats.wins, after.stats.packsOpened], [1, 1]);
        assert.equal(total(after.collection), total(before.collection) + after.lastPack.cardIds.length);
    });

    test('loss: +10 credits, shown on the defeat screen', { timeout: 60000 }, async t => {
        const page = await open(t);
        await startMatch(page);
        await act(page, () => changePlayerLife(-20));
        const after = await storedMeta(page);
        assert.deepEqual([after.wallet.credits, after.stats.losses], [110, 1]);
        assert.match(await page.textContent('#loseOverlay'), /\+10 Credits/);
    });
});

// ------------------------------------------------------------------ resets and storage failures

describe('resets and storage failures', () => {
    test('RESET PROGRESS: fresh profile, stats shown as 0 at once, old totals never come back, previous save backed up', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        await page.evaluate(() => { localStorage.removeItem('emoji_elements_meta_backups'); });
        const beforeRaw = await stored(page);
        await page.evaluate(() => { document.getElementById('startModal').style.display = 'flex'; showStats(); resetMetaProgress(); });
        await clickAt(page, '#gameConfirmYesBtn');
        await page.clock.runFor(400);
        const meta = await storedMeta(page);
        assert.equal(meta.wallet.credits, 100);
        assert.equal(total(meta.collection), 300);
        assert.equal(await page.textContent('#gamesWon'), '0', 'stats screen updated immediately');
        assert.equal((await backups(page)).at(-1).raw, beforeRaw, 'the reset profile can still be recovered');
        await startMatch(page);
        await act(page, () => changePlayerLife(-20));
        assert.deepEqual((await storedMeta(page)).stats, { wins: 0, losses: 1, packsOpened: 0 });
    });

    test('RESET STATS clears wins and losses only', { timeout: 60000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        const before = await storedMeta(page);
        await page.evaluate(() => { document.getElementById('startModal').style.display = 'flex'; showStats(); resetStats(); });
        await clickAt(page, '#gameConfirmYesBtn');
        await page.clock.runFor(400);
        const after = await storedMeta(page);
        assert.deepEqual([after.stats.wins, after.stats.losses], [0, 0]);
        assert.equal(after.stats.packsOpened, before.stats.packsOpened);
        assert.deepEqual([after.collection, after.wallet, after.decks], [before.collection, before.wallet, before.decks]);
    });

    test('when the browser refuses to save, the player is told instead of failing silently', { timeout: 60000 }, async t => {
        const page = await open(t);
        const log = await page.evaluate(() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
            purchasePack('lands');
            Storage.prototype.setItem = original;
            return document.getElementById('gameLog').textContent;
        });
        assert.match(log, /could not be saved/i);
    });
});
