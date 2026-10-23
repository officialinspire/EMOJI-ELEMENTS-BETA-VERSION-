// Final regression checks for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/regression.test.mjs        (or: npm run regression)
//
// Focused checks across the recent passes plus the cleanup pass (QA_REPORT.md):
// - filters keep focus and scroll;
// - the combat preview matches real combat on random boards;
// - pack membership matches the committed manifest;
// - nothing keeps running or redrawing after a match is left, and listeners and history stay bounded;
// - keyboard-only play, reduced motion, portrait/landscape changes, and fresh and existing profiles.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useGameBrowser, openGame, startMatch, act, setup, readMeta } from './lib/game.mjs';
import { ROOT } from './lib/harness.mjs';

useGameBrowser();

const META = 'emoji_elements_meta_v1';
const fixture = name => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'saves', name), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'card-manifest.json'), 'utf8'));

async function openMenu(page) {
    await page.evaluate(() => {
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
    });
}

// ------------------------------------------------------------------ filters and lists

describe('filters and lists', () => {
    test('Deck Builder + and − keep keyboard focus and the list scroll', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await openMenu(page);
        await page.evaluate(() => showDeckBuilder());
        await page.clock.runFor(300);
        const r = await page.evaluate(() => {
            const out = {};
            // − on a deck row whose card has two copies: the row stays and keeps focus
            const twoCopies = Object.entries(deckBuilderState.workingCardIds.reduce((a, id) => ({ ...a, [id]: (a[id] || 0) + 1 }), {}))
                .find(([id, n]) => n === 2 && __CARD_BY_ID[id].type !== 'land')[0];
            setDeckBuilderTab('deck');
            let row = document.querySelector(`#deckBuilderDeck .deck-builder-row[data-card-id="${twoCopies}"]`);
            const index = [...row.parentElement.querySelectorAll('.deck-builder-row')].indexOf(row);
            deckBuilderState.pages.deck = Math.floor(index / deckBuilderPageSize());
            paginateDeckBuilder(row.parentElement, 'deckDeckPager', 'deck');
            const deckList = document.getElementById('deckBuilderDeck');
            row.scrollIntoView({ block: 'center' });
            const deckScroll = deckList.scrollTop;
            row.querySelector('button').focus();
            row.querySelector('button').click();
            out.removeKeepsRow = document.activeElement.closest('.deck-builder-row')?.dataset.cardId === twoCopies;
            out.deckScrollKept = deckList.scrollTop === deckScroll;
            // − again: the last copy leaves, focus moves to the row that took its place
            document.activeElement.click();
            out.lastCopyFocus = document.activeElement.classList.contains('deck-builder-remove');
            // + on an addable pool row keeps focus on that row
            setDeckBuilderTab('inventory');
            const addable = [...document.querySelectorAll('#deckBuilderPool .deck-builder-row')].find(r => !r.querySelector('button[aria-disabled="true"]'));
            const id = addable.dataset.cardId;
            addable.querySelector('button').focus();
            addable.querySelector('button').click();
            out.addKeepsRow = document.activeElement.closest('.deck-builder-row')?.dataset.cardId === id;
            return out;
        });
        assert.deepEqual(r, { removeKeepsRow: true, deckScrollKept: true, lastCopyFocus: true, addKeepsRow: true });
    });

    test('Collection: combined filters agree with the catalog, and the filter keeps focus', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await openMenu(page);
        await page.evaluate(() => showBinder());
        await page.clock.runFor(300);
        const set = (name, value) => page.evaluate(([name, value]) => {
            const el = document.querySelector(`#binderFilters [data-filter="${name}"]`);
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event(el.tagName === 'INPUT' ? 'input' : 'change'));
            return document.activeElement === el;
        }, [name, value]);
        assert.ok(await set('element', 'water'));
        assert.ok(await set('rarity', 'rare'));
        assert.ok(await set('type', 'creature'));
        const shown = await page.evaluate(() => [...document.querySelectorAll('#binderList .binder-row')].map(r => r.dataset.cardId).sort());
        const expected = manifest.cards.filter(c => c.type === 'creature' && c.rarity === 'rare' && c.colors.includes('water')).map(c => c.id).sort();
        assert.deepEqual(shown, expected);
        await page.evaluate(() => document.querySelector('#binderFilters .card-filter-reset').click());
        assert.equal(await page.evaluate(() => document.querySelectorAll('#binderList .binder-row').length), 268);
    });
});

// ------------------------------------------------------------------ combat preview

describe('combat preview', () => {
    test('random boards: the preview predicts life, deaths and history text exactly, for both sides', { timeout: 180000 }, async t => {
        const page = await openGame(t, { seed: 77 });
        await startMatch(page);
        const creatures = manifest.cards.filter(c => c.type === 'creature').map(c => c.id);
        let rng = 12345;
        const rand = n => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
        const pickN = n => Array.from({ length: n }, () => creatures[rand(creatures.length)]);
        const mismatches = [];
        let skipped = 0;
        for (let i = 0; i < 40; i++) {
            const side = i % 2 ? 'enemy' : 'player';
            const attackers = pickN(1 + rand(4));
            const blockers = pickN(rand(5));
            const lives = { playerLife: 3 + rand(18), enemyLife: 3 + rand(18) };
            const spec = side === 'player'
                ? { playerBoard: attackers, enemyBoard: blockers, enemyHand: [], hasAttackedThisTurn: false, ...lives }
                : { playerBoard: blockers, enemyBoard: attackers, enemyHand: [], ...lives };
            await page.evaluate(() => { if (gameState.matchFinalized) { gameState.matchFinalized = false; } });
            await setup(page, spec);
            const r = await page.evaluate(side => {
                const isPlayer = side === 'player';
                // Only creatures the rules let attack (Defender can't), as in the game
                const attackers = (isPlayer ? gameState.playerBoard : gameState.enemyBoard).filter(c => c.type === 'creature' && canAttack(c));
                if (!attackers.length) return { skipped: true };
                const defenders = isPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const preview = previewCombat(attackers, defenders, isPlayer);
                const historyStart = matchHistory.length;
                if (isPlayer) {
                    enterAttackPhase();
                    attackers.forEach(c => selectAttacker(c.id));
                    confirmAttackers();
                } else {
                    resolveEnemyAttackPhase(attackers);
                }
                const alive = new Set([...gameState.playerBoard, ...gameState.enemyBoard].map(c => c.id));
                const entry = matchHistory.slice(historyStart).find(e => /attack/.test(e.text));
                const expectedLines = preview.pairs.map(pair => describeCombatPair({
                    attacker: attackers.find(c => c.id === pair.attackerId),
                    blockers: pair.blockerIds.map(id => defenders.find(c => c.id === id)),
                    attackerDies: pair.attackerDies, blockersDie: pair.blockersDie, lifeChange: pair.lifeChange
                }, isPlayer));
                return {
                    life: [preview.life.player, preview.life.enemy], actualLife: [gameState.playerLife, gameState.enemyLife],
                    deaths: [...preview.deaths].sort(), actualDeaths: [...attackers, ...defenders].filter(c => c.type === 'creature' && !alive.has(c.id)).map(c => c.id).sort(),
                    lines: expectedLines, actualLines: entry ? entry.details : []
                };
            }, side);
            await page.clock.runFor(400);
            if (r.skipped) { skipped++; continue; }
            const same = JSON.stringify([r.life, r.deaths, r.lines]) === JSON.stringify([r.actualLife, r.actualDeaths, r.actualLines]);
            if (!same) mismatches.push({ i, side, attackers, blockers, lives, r });
            await page.evaluate(() => { attackPhase = false; gameState.phase = 'main'; gameState.turn = 'player'; gameState.attackers = []; gameState.hasAttackedThisTurn = false; releaseProcessingLock(); setAttackControls('idle'); });
        }
        assert.deepEqual(mismatches, [], JSON.stringify(mismatches[0], null, 1));
        assert.ok(skipped < 8, `${skipped} of 40 boards had no legal attacker`);
    });
});

// ------------------------------------------------------------------ packs

describe('pack membership', () => {
    test('the game\'s pack pools match the committed manifest, and every card can come from a pack', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const game = await page.evaluate(() => Object.fromEntries(__ALL_CARDS.map(c => [c.__id, getPackMemberships(c)])));
        const drift = manifest.cards.filter(c => JSON.stringify([...c.availability.packThemes].sort()) !== JSON.stringify([...(game[c.id] || [])].sort())).map(c => c.id);
        assert.deepEqual(drift, [], 'run node tests/card-audit.mjs --write after reviewing a membership change');
        assert.ok(manifest.cards.every(c => c.availability.packThemes.length > 0));
        assert.ok(manifest.cards.filter(c => c.availability.packThemes.includes('lands')).every(c => c.type === 'land'));
    });
});

// ------------------------------------------------------------------ leaving a match

describe('leaving a match', () => {
    test('after quitting mid enemy turn: no timers, no redraw, no particle loop, empty rows; history resets', { timeout: 120000 }, async t => {
        const page = await openGame(t, { seed: 81 });
        await startMatch(page);
        await page.evaluate(() => {
            window.__uiUpdates = 0;
            const original = performUIUpdate;
            performUIUpdate = function () { window.__uiUpdates++; return original.apply(this, arguments); };
            createParticles(100, 100, '#ffd700', 20);
            releaseProcessingLock();
            endTurn();
        });
        await page.clock.runFor(1800);
        const r = await page.evaluate(() => {
            returnToMainMenu();
            return { updates: window.__uiUpdates };
        });
        await page.clock.runFor(15000);
        const after = await page.evaluate(() => ({
            updates: window.__uiUpdates,
            rows: ['playerHand', 'playerBoard', 'enemyBoard'].map(id => document.getElementById(id).children.length),
            particleLoop: particleLoopRunning,
            particles: particles.length,
            enemyMoved: gameState.turn
        }));
        assert.equal(after.updates, r.updates, 'no UI update runs after leaving');
        assert.deepEqual(after.rows, [0, 0, 0]);
        assert.equal(after.particleLoop, false, 'the particle loop stops once particles are gone');
        assert.equal(after.particles, 0);
        // A new match starts with a fresh history and turn count
        await startMatch(page);
        const fresh = await page.evaluate(() => ({ round: gameState.round, history: matchHistory.length }));
        assert.equal(fresh.round, 1);
        assert.ok(fresh.history <= 2, `history reset (${fresh.history})`);
    });

    test('the particle loop only runs while particles are alive', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        const idle = await page.evaluate(() => particleLoopRunning);
        await page.evaluate(() => createParticles(50, 50, '#fff', 10));
        const busy = await page.evaluate(() => [particleLoopRunning, particles.length > 0]);
        await page.clock.runFor(5000);
        const done = await page.evaluate(() => [particleLoopRunning, particles.length]);
        assert.equal(idle, false);
        assert.deepEqual(busy, [true, true]);
        assert.deepEqual(done, [false, 0]);
    });

    test('match history stays at 80 entries in a long match', { timeout: 30000 }, async t => {
        const page = await openGame(t);
        await startMatch(page);
        const r = await page.evaluate(() => { for (let i = 0; i < 500; i++) recordHistory('player', `e${i}`); return { n: matchHistory.length, last: matchHistory[79].text }; });
        assert.deepEqual(r, { n: 80, last: 'e499' });
    });
});

// ------------------------------------------------------------------ keyboard, motion, orientation, profiles

describe('keyboard, motion, orientation and profiles', () => {
    test('a whole turn with the keyboard: play a land, attack, confirm, end the turn', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 91 });
        await startMatch(page);
        await setup(page, { playerHand: ['lands-volcanic-peak'], playerBoard: ['creatures-fire-lion'], enemyHand: [], enemyBoard: [], landsPlayedThisTurn: 0, hasAttackedThisTurn: false });
        // A keyboard player arrives with Tab (after a mouse click, Enter/Space keep their END TURN meaning)
        await page.keyboard.press('Tab');
        await page.focus('#playerHand .card');
        await page.keyboard.press('Enter');
        await page.clock.runFor(400);
        assert.equal(await page.evaluate(() => gameState.playerBoard.some(c => c.type === 'land')), true, 'Enter played the land');
        await page.keyboard.press('a');
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => attackPhase), true, 'A enters attacker selection');
        await page.focus('#playerBoard .card.can-attack');
        await page.keyboard.press('Enter');
        await page.clock.runFor(200);
        assert.equal(await page.evaluate(() => gameState.attackers.length), 1, 'Enter selects the attacker');
        await page.keyboard.press('a');
        await page.clock.runFor(800);
        assert.equal(await page.evaluate(() => gameState.enemyLife), 16, 'A confirms the attack');
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Space');
        await page.clock.runFor(300);
        assert.equal(await page.evaluate(() => gameState.turn), 'enemy', 'Space ends the turn');
    });

    test('reduced motion: no particles, no turn pulse, no reveal animation', { timeout: 60000 }, async t => {
        const page = await openGame(t);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await startMatch(page);
        const r = await page.evaluate(() => {
            createParticles(10, 10, '#fff', 30);
            const banner = document.getElementById('turnBanner');
            banner.dataset.turn = '';
            updateTurnBanner();
            const pulse = getComputedStyle(banner);
            gameMeta.lastPack = { themeKey: 'robot', cardIds: ['creatures-combat-robot', 'creatures-battle-mech', 'creatures-ai-core', 'creatures-hydrobot', 'creatures-mech-part'], openedAt: 'x' };
            openPackOpeningOverlayFromMeta('shop');
            showPackRevealStage();
            const viewport = getComputedStyle(document.querySelector('.pack-card-text'));
            return { particles: particles.length, loop: particleLoopRunning, pulseName: pulse.animationName, pulseDuration: parseFloat(pulse.animationDuration), textTransition: parseFloat(viewport.transitionDuration) };
        });
        assert.equal(r.particles, 0);
        assert.equal(r.loop, false);
        assert.ok(r.pulseName === 'none' || r.pulseDuration <= 0.01, JSON.stringify(r));
        assert.ok(r.textTransition <= 0.01, JSON.stringify(r));
    });

    test('portrait ↔ landscape mid-match, mid-attack and mid-reveal: no sideways overflow, controls reachable, focus kept', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 93 });
        await page.setViewportSize({ width: 360, height: 740 });
        await startMatch(page);
        await setup(page, { playerBoard: ['creatures-fire-lion', 'creatures-giant-squid', 'lands-volcanic-peak'], enemyBoard: ['creatures-ember-beetle'], enemyHand: [], hasAttackedThisTurn: false });
        await act(page, () => { enterAttackPhase(); selectAttacker(gameState.playerBoard.find(c => c.name === 'Fire Lion').id); });
        await page.focus('#playerBoard .card');
        const check = () => page.evaluate(() => {
            const visible = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= -1; };
            return {
                overflow: document.documentElement.scrollWidth - innerWidth,
                attack: visible('attackBtn'), cancel: visible('endTurnBtn'), preview: !document.getElementById('combatPreview').hidden,
                focus: document.activeElement?.closest('#playerBoard') !== null
            };
        });
        for (const size of [{ width: 740, height: 360 }, { width: 360, height: 740 }, { width: 915, height: 412 }]) {
            await page.setViewportSize(size);
            await page.clock.runFor(300);
            const r = await check();
            assert.ok(r.overflow <= 1, `${size.width}×${size.height} overflow ${r.overflow}`);
            assert.deepEqual({ ...r, overflow: 0 }, { overflow: 0, attack: true, cancel: true, preview: true, focus: true }, `${size.width}×${size.height}`);
        }
        await act(page, () => {
            cancelAttack();
            gameMeta.lastPack = { themeKey: 'alien', cardIds: ['creatures-grey-alien', 'creatures-ufo-saucer', 'spells-comet-strike', 'creatures-space-marine', 'lands-distant-planet'], openedAt: 'x' };
            openPackOpeningOverlayFromMeta('shop');
            showPackRevealStage();
        });
        for (const size of [{ width: 740, height: 360 }, { width: 360, height: 740 }]) {
            await page.setViewportSize(size);
            await page.clock.runFor(300);
            const r = await page.evaluate(() => {
                const panel = document.querySelector('.pack-opening-panel');
                const next = document.getElementById('packNextBtn');
                next.scrollIntoView({ block: 'nearest' });
                const b = next.getBoundingClientRect();
                return { overflow: document.documentElement.scrollWidth - innerWidth, panelFits: panel.getBoundingClientRect().right <= innerWidth + 1, nextReachable: b.bottom <= innerHeight + 1 && b.top >= 0 };
            });
            assert.deepEqual(r, { overflow: 0, panelFits: true, nextReachable: true }, `reveal at ${size.width}×${size.height}`);
        }
    });

    test('fresh and existing profiles: menus, a purchase and a match work; the save keeps its shape', { timeout: 90000 }, async t => {
        for (const storage of [null, { [META]: fixture('existing.json') }]) {
            const page = await openGame(t, storage ? { storage } : {});
            const before = await readMeta(page);
            await openMenu(page);
            await page.evaluate(() => { showBinder(); backToMenu(); showDeckBuilder(); backToMenu(); showPackShop(); });
            const bought = await page.evaluate(() => purchasePack('lands'));
            assert.equal(bought.ok, true);
            await page.evaluate(() => { closePackOpeningOverlay(); hidePackShop(); });
            await startMatch(page);
            await act(page, () => { changeEnemyLife(-99); });
            await page.clock.runFor(1500);
            const after = await readMeta(page);
            assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), storage ? 'existing save' : 'fresh save');
            assert.equal(after.stats.wins, before.stats.wins + 1);
            assert.equal(after.wallet.credits, before.wallet.credits - 40 + 25);
        }
    });
});
