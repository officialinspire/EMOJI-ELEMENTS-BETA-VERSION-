// Binder (Collection) and Deck Builder usability, run against the real game in headless Chromium.
//
//   node --test tests/collection.test.mjs        (or: npm run collection)
//
// Covers search, combinable filters and sorting; the full catalog with unowned cards marked; owned / in-deck
// counts and the reasons an Add button is disabled; the deck summary and mana curve; actionable validation
// errors; the unsaved-edits warning; reloads; and the existing-save fixture. Deck legality and progression
// are the game's own (validateDeckBuild, PROGRESSION.md): these tests check they are unchanged.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useGameBrowser, openGamePage } from './lib/game.mjs';
import { ROOT } from './lib/harness.mjs';

useGameBrowser();

const META = 'emoji_elements_meta_v1';
const fixture = name => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'saves', name), 'utf8');
const ALL_DECKS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT', 'FIRE_WATER', 'FIRE_EARTH', 'FIRE_SWAMP', 'FIRE_LIGHT',
    'WATER_EARTH', 'WATER_SWAMP', 'WATER_LIGHT', 'EARTH_SWAMP', 'EARTH_LIGHT', 'SWAMP_LIGHT'];

async function open(t, options = {}) {
    const session = await openGamePage(options);
    t.after(session.close);
    const page = session.page;
    page.on('dialog', d => d.dismiss());
    await page.evaluate(() => { document.getElementById('startModal').style.display = 'flex'; document.getElementById('startModal').classList.add('modal-visible'); });
    return page;
}
const stored = page => page.evaluate(k => localStorage.getItem(k), META);
const reload = async page => {
    await page.reload();
    await page.evaluate(() => {
        document.getElementById('clickToStart').style.display = 'none';
        document.getElementById('startModal').style.display = 'flex';
        document.getElementById('startModal').classList.add('modal-visible');
    });
};

// Sets one filter control the way a player would (input/change events)
const setFilter = (page, scope, name, value) => page.evaluate(({ scope, name, value }) => {
    const el = document.querySelector(`#${scope} [data-filter="${name}"]`);
    if (!el) throw new Error(`no ${name} filter in #${scope}`);
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
}, { scope, name, value });

// The expected list, computed independently of the game's helpers: identity from cost colours or a land's
// colours, mana value as the sum of the cost.
function expectedInPage(spec) {
    const all = window.__ALL_CARDS;
    const owned = id => gameMeta.collection[id] || 0;
    const colours = c => c.type === 'land'
        ? [...new Set((c.elements || [c.element]).filter(e => e && e !== 'colorless'))]
        : [...new Set(Object.keys(c.cost || {}).filter(e => e !== 'colorless'))];
    const mv = c => Object.values(c.cost || {}).reduce((s, n) => s + n, 0);
    return all.filter(c => {
        const cs = colours(c);
        if (spec.ids && !spec.ids.includes(c.__id)) return false;
        if (spec.query && !`${c.name} ${c.desc || ''} ${(c.abilities || []).map(a => KEYWORD_RULES[a]?.label || a).join(' ')}`.toLowerCase().includes(spec.query.toLowerCase())) return false;
        if (spec.element === 'colorless' && cs.length) return false;
        if (spec.element === 'multicolor' && cs.length < 2) return false;
        if (spec.element && !['colorless', 'multicolor'].includes(spec.element) && !cs.includes(spec.element)) return false;
        if (spec.type && c.type !== spec.type) return false;
        if (spec.cost !== undefined && (spec.cost === '6+' ? mv(c) < 6 : mv(c) !== Number(spec.cost))) return false;
        if (spec.rarity && c.__rarity !== spec.rarity) return false;
        if (spec.owned === 'owned' && owned(c.__id) <= 0) return false;
        if (spec.owned === 'unowned' && owned(c.__id) > 0) return false;
        return true;
    }).map(c => c.__id).sort();
}

const binderRows = page => page.evaluate(() => [...document.querySelectorAll('#binderList .binder-row')].map(r => ({
    id: r.dataset.cardId,
    name: r.querySelector('.binder-row-name').firstChild.textContent.trim(),
    count: Number(r.querySelector('.binder-row-count').textContent.replace(/\D/g, '')),
    unowned: r.classList.contains('is-unowned'),
    text: r.innerText.replace(/\s+/g, ' ')
})));

const poolRows = page => page.evaluate(() => [...document.querySelectorAll('#deckBuilderPool .deck-builder-row')].map(r => {
    const add = r.querySelector('button');
    return {
        id: r.dataset.cardId,
        name: r.querySelector('.deck-builder-name').textContent,
        blocked: add.disabled || add.getAttribute('aria-disabled') === 'true',
        reason: add.dataset.reason || '',
        reasonText: r.querySelector('.deck-builder-reason')?.textContent || '',
        text: r.innerText.replace(/\s+/g, ' ')
    };
}));

const clickAdd = (page, id) => page.evaluate(id => document.querySelector(`#deckBuilderPool .deck-builder-row[data-card-id="${id}"] button`).click(), id);
const clickRemove = (page, id) => page.evaluate(id => document.querySelector(`#deckBuilderDeck .deck-builder-row[data-card-id="${id}"] button`).click(), id);
const openBuilder = async (page, deckKey) => {
    await page.evaluate(key => {
        showDeckBuilder();
        if (key) {
            const select = document.getElementById('deckBuilderDeckKey');
            select.value = key;
            select.dispatchEvent(new Event('change'));
        }
    }, deckKey);
};
const working = page => page.evaluate(() => [...deckBuilderState.workingCardIds]);

// ------------------------------------------------------------------ Binder

describe('Binder (Collection)', () => {
    test('shows the full catalog with unowned cards marked, and accurate totals', { timeout: 60000 }, async t => {
        const page = await open(t);
        await page.evaluate(() => showBinder());
        const facts = await page.evaluate(() => {
            const owned = Object.entries(gameMeta.collection).filter(([id, n]) => __CARD_BY_ID[id] && n > 0);
            return { catalog: window.__ALL_CARDS.length, unique: owned.length, copies: owned.reduce((s, [, n]) => s + n, 0),
                badge: document.getElementById('binderSummaryBadge').textContent };
        });
        const rows = await binderRows(page);
        assert.equal(rows.length, facts.catalog, 'every catalog card has a row');
        const unowned = rows.filter(r => r.unowned);
        assert.equal(unowned.length, facts.catalog - facts.unique, 'unowned rows are marked');
        assert.ok(unowned.every(r => r.count === 0 && /not owned/i.test(r.text)), 'unowned rows say "Not owned" and x0');
        assert.equal(facts.badge, `🗂️ ${facts.unique} of ${facts.catalog} unique cards • ${facts.copies} total cards`);

        await setFilter(page, 'binderFilters', 'owned', 'owned');
        const ownedRows = await binderRows(page);
        assert.equal(ownedRows.length, facts.unique, 'owned-only lists every owned card once');
        assert.equal(ownedRows.reduce((s, r) => s + r.count, 0), facts.copies, 'owned-only copies add up');
        assert.ok(ownedRows.every(r => !r.unowned));
        await setFilter(page, 'binderFilters', 'owned', 'unowned');
        assert.equal((await binderRows(page)).length, facts.catalog - facts.unique);
    });

    test('search, element, type, mana value, rarity and ownership combine; sorting orders the list', { timeout: 90000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        await page.evaluate(() => showBinder());
        const combos = [
            { element: 'fire', type: 'creature' },
            { element: 'water', type: 'instant', owned: 'owned' },
            { element: 'multicolor' },
            { element: 'colorless', type: 'artifact' },
            { rarity: 'legendary', owned: 'unowned' },
            { cost: '6+', type: 'creature' },
            { cost: '0' },
            { query: 'dragon' },
            { query: 'shield', element: 'light' },
            { type: 'land', owned: 'owned' },
            { element: 'swamp', rarity: 'rare', cost: '3', owned: 'all' }
        ];
        for (const combo of combos) {
            await page.evaluate(() => resetCardFilters('binderFilters'));
            for (const [name, value] of Object.entries(combo)) await setFilter(page, 'binderFilters', name, value);
            const shown = (await binderRows(page)).map(r => r.id).sort();
            const expected = await page.evaluate(expectedInPage, combo);
            assert.deepEqual(shown, expected, `Binder filter ${JSON.stringify(combo)}`);
        }

        await page.evaluate(() => resetCardFilters('binderFilters'));
        const order = async sort => {
            await setFilter(page, 'binderFilters', 'sort', sort);
            return page.evaluate(() => [...document.querySelectorAll('#binderList .binder-row')].map(r => {
                const c = __CARD_BY_ID[r.dataset.cardId];
                return { name: c.name, mv: Object.values(c.cost || {}).reduce((s, n) => s + n, 0),
                    rank: ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(c.__rarity), owned: gameMeta.collection[c.__id] || 0 };
            }));
        };
        const byName = await order('name');
        assert.deepEqual(byName.map(r => r.name), [...byName.map(r => r.name)].sort((a, b) => a.localeCompare(b)));
        const byCost = await order('cost');
        assert.ok(byCost.every((r, i) => i === 0 || byCost[i - 1].mv <= r.mv), 'mana value ascending');
        const byRarity = await order('rarity');
        assert.ok(byRarity.every((r, i) => i === 0 || byRarity[i - 1].rank >= r.rank), 'rarity, rarest first');
        const byOwned = await order('owned');
        assert.ok(byOwned.every((r, i) => i === 0 || byOwned[i - 1].owned >= r.owned), 'most copies first');
        const shown = await page.textContent('#binderShowing');
        assert.match(shown, /Showing \d+ of \d+/);
    });

    test('a card row opens its full rules', { timeout: 60000 }, async t => {
        const page = await open(t);
        await page.evaluate(() => showBinder());
        await setFilter(page, 'binderFilters', 'query', 'Fireball');
        const detail = await page.evaluate(() => {
            document.querySelector('#binderList .binder-row').click();
            return { open: document.getElementById('cardDetailPopup').classList.contains('show'), text: document.getElementById('detailContent').textContent };
        });
        assert.ok(detail.open && /Rules:/.test(detail.text));
    });
});

// ------------------------------------------------------------------ Deck Builder

describe('Deck Builder', () => {
    test('pool filters combine over eligible cards and never touch the draft', { timeout: 90000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        await openBuilder(page, 'FIRE_WATER');
        // An unsaved edit first: remove one non-land card
        const removed = (await working(page)).find(id => !id.startsWith('lands-'));
        await clickRemove(page, removed);
        const draft = await working(page);
        const eligible = await page.evaluate(() => window.__ALL_CARDS.filter(c => isCardEligibleForDeck(c, ['fire', 'water'])).map(c => c.__id));
        const combos = [
            { type: 'creature', owned: 'owned' },
            { element: 'water', cost: '2' },
            { rarity: 'rare', owned: 'all' },
            { query: 'fire', type: 'instant' },
            { element: 'multicolor', owned: 'all' },
            { type: 'land' },
            { owned: 'unowned', type: 'artifact' }
        ];
        for (const combo of combos) {
            await page.evaluate(() => resetCardFilters('deckBuilderFilters'));
            for (const [name, value] of Object.entries(combo)) await setFilter(page, 'deckBuilderFilters', name, value);
            const shown = (await poolRows(page)).map(r => r.id).sort();
            const expected = await page.evaluate(expectedInPage, { owned: 'owned', ...combo, ids: eligible });
            assert.deepEqual(shown, expected, `pool filter ${JSON.stringify(combo)}`);
            assert.deepEqual(await working(page), draft, 'filters keep the draft');
        }
        assert.equal(await page.evaluate(() => isDeckBuilderDirty()), true);
    });

    test('rows show owned and in-deck counts, cost, stats and rules; Add explains why it is disabled', { timeout: 90000 }, async t => {
        const page = await open(t);
        await page.evaluate(() => {
            // Test setup: one copy of a legendary and a second Fire card, so every reason can be shown
            gameMeta.collection['creatures-ancient-dragon'] = 2;
        });
        await openBuilder(page, 'FIRE');
        await setFilter(page, 'deckBuilderFilters', 'owned', 'all');
        const deck = await working(page);
        const nonLand = deck.find(id => !id.startsWith('lands-'));
        // Make room, then check each reason
        await clickRemove(page, nonLand);
        const rows = Object.fromEntries((await poolRows(page)).map(r => [r.id, r]));
        const facts = await page.evaluate(() => {
            const counts = {};
            deckBuilderState.workingCardIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
            const own = id => gameMeta.collection[id] || 0;
            const fire = window.__ALL_CARDS.filter(c => isCardEligibleForDeck(c, ['fire']));
            return {
                legendary: 'creatures-ancient-dragon',
                noCopies: fire.find(c => c.type !== 'land' && own(c.__id) > 0 && counts[c.__id] === own(c.__id) && own(c.__id) < 2)?.__id,
                atLimit: fire.find(c => c.type !== 'land' && c.__rarity !== 'legendary' && counts[c.__id] === 2)?.__id,
                unowned: fire.find(c => own(c.__id) === 0)?.__id,
                addable: fire.find(c => c.type !== 'land' && own(c.__id) > (counts[c.__id] || 0) && (counts[c.__id] || 0) < 2)?.__id,
                counts, owned: gameMeta.collection
            };
        });
        const sample = rows[facts.addable];
        assert.ok(sample && !sample.blocked, 'an addable card is enabled');
        assert.match(sample.text, new RegExp(`In deck ${facts.counts[facts.addable] || 0}`), 'in-deck count shown');
        assert.match(sample.text, new RegExp(`Owned ${facts.owned[facts.addable]}`), 'owned count shown');
        const card = await page.evaluate(id => __CARD_BY_ID[id], facts.addable);
        if (card.type === 'creature') assert.ok(sample.text.includes(`${card.power}/${card.toughness}`), 'creature stats shown');
        assert.ok(Object.values(card.cost).every(n => sample.text.includes(String(n))), 'cost shown');

        if (facts.noCopies) assert.equal(rows[facts.noCopies].reason, 'no-copies');
        if (facts.atLimit) assert.equal(rows[facts.atLimit].reason, 'copy-limit');
        if (facts.unowned) assert.equal(rows[facts.unowned].reason, 'not-owned');
        for (const id of [facts.noCopies, facts.atLimit, facts.unowned].filter(Boolean)) {
            assert.ok(rows[id].blocked && rows[id].reasonText.length > 5, `reason text for ${id}`);
        }
        // Legendary: one copy allowed even with two owned
        await clickAdd(page, 'creatures-ancient-dragon');
        const legend = (await poolRows(page)).find(r => r.id === 'creatures-ancient-dragon');
        assert.equal(legend.reason, 'copy-limit');
        assert.match(legend.reasonText, /legendary/i);
        // Pressing a blocked Add explains in the status line and adds nothing
        const before = (await working(page)).length;
        await clickAdd(page, 'creatures-ancient-dragon');
        assert.equal((await working(page)).length, before);
        assert.match(await page.textContent('#deckBuilderStatus'), /copy limit/i);
        // Full deck: every Add is blocked with the deck-full reason
        while ((await working(page)).length < 60) {
            const next = (await poolRows(page)).find(r => !r.blocked);
            await clickAdd(page, next.id);
        }
        const full = await poolRows(page);
        assert.ok(full.every(r => r.blocked), 'nothing can be added to a full deck');
        assert.ok(full.filter(r => r.reason === 'deck-full').length > 0);
        // Full rules from a row
        const rules = await page.evaluate(() => {
            document.querySelector('#deckBuilderDeck .deck-builder-row .deck-builder-info-btn').click();
            return document.getElementById('cardDetailPopup').classList.contains('show');
        });
        assert.ok(rules, 'the info button opens card details');
    });

    test('the summary and mana curve follow the working deck', { timeout: 60000 }, async t => {
        const page = await open(t);
        await openBuilder(page, 'EARTH_SWAMP');
        const read = () => page.evaluate(() => {
            const n = key => Number(document.querySelector(`#deckBuilderSummary [data-count="${key}"]`)?.textContent);
            const curve = Object.fromEntries([...document.querySelectorAll('#deckBuilderSummary .mana-curve [data-cost]')].map(b => [b.dataset.cost, Number(b.dataset.count)]));
            const cards = deckBuilderState.workingCardIds.map(id => __CARD_BY_ID[id]);
            const mv = c => Object.values(c.cost || {}).reduce((s, x) => s + x, 0);
            const expectCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, '6+': 0 };
            cards.filter(c => c.type !== 'land').forEach(c => { expectCurve[mv(c) >= 6 ? '6+' : mv(c)] += 1; });
            return {
                shown: { cards: n('cards'), lands: n('lands'), creatures: n('creatures'), spells: n('spells'), artifacts: n('artifacts'), curve },
                expected: {
                    cards: cards.length, lands: cards.filter(c => c.type === 'land').length, creatures: cards.filter(c => c.type === 'creature').length,
                    spells: cards.filter(c => c.type === 'instant').length, artifacts: cards.filter(c => c.type === 'artifact').length,
                    curve: Object.fromEntries(Object.entries(expectCurve).map(([k, v]) => [String(k), v]))
                }
            };
        });
        let r = await read();
        assert.deepEqual(r.shown, r.expected);
        for (const id of (await working(page)).filter(id => !id.startsWith('lands-')).slice(0, 4)) await clickRemove(page, id);
        r = await read();
        assert.deepEqual(r.shown, r.expected, 'after removing four cards');
        assert.equal(r.shown.cards, 56);
        assert.match(await page.textContent('#deckBuilderSummary'), /56\s*\/\s*60/);
    });

    test('invalid decks are explained with actions that fix them; an invalid save changes nothing', { timeout: 90000 }, async t => {
        const page = await open(t);
        // Test setup (in memory, never saved): spare Fire lands, so the deck can exceed the 20-land cap
        await page.evaluate(() => { gameMeta.collection['lands-volcanic-peak'] = 25; });
        await openBuilder(page, 'FIRE');
        const savedBefore = await stored(page);
        // 60 cards with 21 lands: swap a creature for a basic Fire land (over the 20-land cap)
        const creature = (await working(page)).find(id => id.startsWith('creatures-'));
        await clickRemove(page, creature);
        await setFilter(page, 'deckBuilderFilters', 'type', 'land');
        await clickAdd(page, 'lands-volcanic-peak');
        assert.equal((await working(page)).length, 60);
        const issues = () => page.evaluate(() => [...document.querySelectorAll('#deckBuilderIssues .deck-issue')].map(i => ({
            kind: i.dataset.issue, text: i.textContent.replace(/\s+/g, ' '), action: !!i.querySelector('.deck-issue-action')
        })));
        let found = await issues();
        const lands = found.find(i => i.kind === 'too-many-lands');
        assert.ok(lands && /remove 1/i.test(lands.text) && lands.action, JSON.stringify(found));
        assert.equal(found.filter(i => i.kind.startsWith('too-many')).length, 1, 'one warning per problem (a one-colour deck has one land cap)');
        // Saving is refused and nothing is written
        await page.evaluate(() => document.querySelector('#deckBuilderScreen button[onclick="saveDeckBuilderDeck()"]').click());
        assert.equal(await stored(page), savedBefore, 'an invalid save writes nothing');
        assert.match(await page.textContent('#deckBuilderStatus'), /at most 20 lands/);
        // The action removes a land; the deck is then one card short
        await page.evaluate(() => document.querySelector('#deckBuilderIssues .deck-issue[data-issue="too-many-lands"] .deck-issue-action').click());
        found = await issues();
        assert.ok(!found.some(i => i.kind === 'too-many-lands'));
        const short = found.find(i => i.kind === 'size');
        assert.ok(short && /add 1/i.test(short.text), JSON.stringify(found));
        assert.equal(await page.evaluate(() => validateDeckBuild('FIRE', deckBuilderState.workingCardIds, gameMeta).errors.length), 1, 'only the size is wrong');
        await page.evaluate(() => resetCardFilters('deckBuilderFilters'));
        await clickAdd(page, creature);
        assert.deepEqual(await issues(), [], 'no issues on a legal deck');
        // Issues and the validator agree on a legal deck and on an illegal one
        const agree = await page.evaluate(() => {
            const legal = validateDeckBuild('FIRE', deckBuilderState.workingCardIds, gameMeta).ok;
            return legal && getDeckIssues('FIRE', deckBuilderState.workingCardIds).length === 0 &&
                getDeckIssues('FIRE', [...deckBuilderState.workingCardIds, 'creatures-ancient-dragon']).length > 0;
        });
        assert.ok(agree);
    });

    test('unsaved edits: leaving or switching decks asks first; No keeps the draft, Yes discards it', { timeout: 90000 }, async t => {
        const page = await open(t);
        await openBuilder(page, 'WATER');
        const saved = await working(page);
        await clickRemove(page, saved.find(id => !id.startsWith('lands-')));
        const draft = await working(page);
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('deckBuilderUnsaved')).display !== 'none'), true, 'unsaved marker shown');

        const confirmShown = () => page.evaluate(() => document.getElementById('gameConfirmModal').classList.contains('show'));
        await page.evaluate(() => backToMenu());
        assert.ok(await confirmShown(), 'BACK asks before discarding');
        await page.evaluate(() => document.getElementById('gameConfirmNoBtn').click());
        assert.equal(await page.evaluate(() => document.getElementById('deckBuilderScreen').style.display), 'block');
        assert.deepEqual(await working(page), draft, 'No keeps the draft');

        await page.evaluate(() => { const s = document.getElementById('deckBuilderDeckKey'); s.value = 'FIRE'; s.dispatchEvent(new Event('change')); });
        assert.ok(await confirmShown(), 'switching decks asks first');
        await page.evaluate(() => document.getElementById('gameConfirmNoBtn').click());
        assert.equal(await page.inputValue('#deckBuilderDeckKey'), 'WATER', 'the selector goes back to the edited deck');
        assert.deepEqual(await working(page), draft);

        await page.keyboard.press('Escape');
        assert.ok(await confirmShown(), 'Esc asks too');
        await page.evaluate(() => document.getElementById('gameConfirmYesBtn').click());
        assert.equal(await page.evaluate(() => document.getElementById('mainMenu').style.display), 'flex');
        await openBuilder(page, 'WATER');
        assert.deepEqual(await working(page), saved, 'Yes discarded the draft; the saved deck is untouched');
        assert.equal(await page.evaluate(() => isDeckBuilderDirty()), false);
    });

    test('a saved edit survives a reload and the builder reopens clean', { timeout: 90000 }, async t => {
        const page = await open(t);
        await openBuilder(page, 'LIGHT');
        const deck = await working(page);
        const out = deck.find(id => id.startsWith('creatures-'));
        await clickRemove(page, out);
        await clickAdd(page, out);
        await clickRemove(page, out);
        const swapIn = await page.evaluate(() => {
            const counts = {};
            deckBuilderState.workingCardIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
            return Object.keys(gameMeta.collection).find(id => {
                const c = __CARD_BY_ID[id];
                return c && c.type !== 'land' && isCardEligibleForDeck(c, ['light']) && (counts[id] || 0) < Math.min(2, gameMeta.collection[id]);
            });
        });
        await clickAdd(page, swapIn);
        await page.evaluate(() => document.querySelector('#deckBuilderScreen button[onclick="saveDeckBuilderDeck()"]').click());
        const saved = await working(page);
        assert.equal(await page.evaluate(() => isDeckBuilderDirty()), false);
        await reload(page);
        await openBuilder(page, 'LIGHT');
        assert.deepEqual((await working(page)).sort(), [...saved].sort());
        assert.equal(await page.evaluate(() => isDeckBuilderDirty()), false);
        assert.equal(await page.evaluate(() => validateDeckBuild('LIGHT', gameMeta.decks.LIGHT.cardIds, gameMeta).ok), true);
    });
});

// ------------------------------------------------------------------ saves and decks

describe('existing saves and all 15 decks', () => {
    test('browsing and unsaved edits never write to an existing save', { timeout: 90000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        const before = await stored(page);
        await page.evaluate(() => showBinder());
        for (const [name, value] of [['owned', 'unowned'], ['element', 'fire'], ['sort', 'rarity'], ['query', 'x']]) await setFilter(page, 'binderFilters', name, value);
        await page.evaluate(() => backToMenu());
        await openBuilder(page, 'FIRE');
        await clickRemove(page, (await working(page)).find(id => !id.startsWith('lands-')));
        await setFilter(page, 'deckBuilderFilters', 'sort', 'cost');
        await page.evaluate(() => backToMenu());
        await page.evaluate(() => document.getElementById('gameConfirmYesBtn').click());
        assert.equal(await stored(page), before, 'save untouched');
        const facts = await page.evaluate(() => {
            showBinder();
            const owned = Object.entries(gameMeta.collection).filter(([id, n]) => __CARD_BY_ID[id] && n > 0);
            return { badge: document.getElementById('binderSummaryBadge').textContent, unique: owned.length, copies: owned.reduce((s, [, n]) => s + n, 0) };
        });
        assert.ok(facts.badge.startsWith(`🗂️ ${facts.unique} of `) && facts.badge.endsWith(`${facts.copies} total cards`), facts.badge);
    });

    test('all 15 decks open legal, at 60 cards, with no issues and nothing unsaved', { timeout: 120000 }, async t => {
        const page = await open(t, { storage: { [META]: fixture('existing.json') } });
        await openBuilder(page);
        const options = await page.$$eval('#deckBuilderDeckKey option', els => els.map(o => o.value));
        assert.deepEqual([...options].sort(), [...ALL_DECKS].sort());
        for (const key of ALL_DECKS) {
            await openBuilder(page, key);
            const r = await page.evaluate(key => ({
                cards: Number(document.querySelector('#deckBuilderSummary [data-count="cards"]').textContent),
                issues: document.querySelectorAll('#deckBuilderIssues .deck-issue').length,
                dirty: isDeckBuilderDirty(),
                valid: validateDeckBuild(key, gameMeta.decks[key].cardIds, gameMeta).ok
            }), key);
            assert.deepEqual(r, { cards: 60, issues: 0, dirty: false, valid: true }, key);
        }
    });
});
