// Gameplay information and feedback for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/feedback.test.mjs        (or: npm run feedback)
//
// The attack preview must predict exactly what combat does, for both sides, without changing anything:
// each scenario is previewed, the game state is checked unchanged, then the real attack resolves and the
// prediction is compared with the result (life, deaths, damage left on survivors, and the per-attacker
// outcome text the match history records). Also covered: why a card can't be played or can't attack (the
// same checks the game makes), CONFIRM/CANCEL, the preview going stale when the board changes, the turn
// banner and AI status, and the match history (recorded once, bounded, nothing hidden revealed).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGamePage, openGame, startMatch, act, setup, QUIET_ENEMY } from './lib/game.mjs';

useGameBrowser();

const LOBSTER = 'creatures-fire-lobster';          // 2/2
const BEETLE = 'creatures-ember-beetle';           // 1/2
const SQUID = 'creatures-giant-squid';             // 3/3 reach
const SHARK = 'creatures-great-shark';             // 4/3 menace
const WEREWOLF = 'creatures-werewolf';             // 4/3 double_strike
const SNAKE = 'creatures-venom-snake';             // 2/1 deathtouch
const RAM = 'creatures-fire-ram';                  // 2/2 first_strike
const PANDA = 'creatures-bamboo-panda';            // 2/4 lifelink
const SCORPION = 'creatures-death-scorpion';       // 1/1 deathtouch, first_strike
const LION = 'creatures-fire-lion';                // 4/3 trample
const SNAIL = 'creatures-armored-snail';           // 0/3 defender

// Attackers attack into blockers; life totals start at 20 unless a row says otherwise.
const PARITY = [
    { name: 'first strike attacker kills its blocker first', attackers: [RAM], blockers: [LOBSTER] },
    { name: 'first strike blocker kills the attacker first', attackers: [LOBSTER], blockers: [RAM] },
    { name: 'first strike on both sides', attackers: [RAM], blockers: [RAM] },
    { name: 'double strike unblocked hits twice', attackers: [WEREWOLF], blockers: [] },
    { name: 'double strike on a tough blocker (4 + 4 vs 7)', attackers: [WEREWOLF], blockers: [{ card: LOBSTER, power: 1, toughness: 7 }] },
    { name: 'double strike + trample', attackers: [{ card: WEREWOLF, abilities: ['double_strike', 'trample'] }], blockers: [BEETLE] },
    { name: 'trample over a chump blocker', attackers: [LION], blockers: [BEETLE] },
    { name: 'trample into a blocker already damaged this turn', attackers: [LION], blockers: [{ card: SQUID, damage: 2 }] },
    { name: 'deathtouch attacker vs a bigger blocker', attackers: [SNAKE], blockers: [{ card: LION, abilities: [] }] },
    { name: 'deathtouch blocker vs trample', attackers: [LION], blockers: [SNAKE] },
    { name: 'deathtouch + trample + menace vs two blockers', attackers: [{ card: LION, power: 6, toughness: 6, abilities: ['deathtouch', 'trample', 'menace'] }], blockers: [LOBSTER, SQUID] },
    { name: 'deathtouch + first strike blocker', attackers: [LION], blockers: [SCORPION] },
    { name: 'menace with one possible blocker gets through', attackers: [SHARK], blockers: [LOBSTER] },
    { name: 'menace blocked by two', attackers: [SHARK], blockers: [LOBSTER, SQUID] },
    { name: 'lifelink unblocked', attackers: [PANDA], blockers: [] },
    { name: 'lifelink blocked: excess damage gains nothing', attackers: [{ card: PANDA, power: 5 }], blockers: [LOBSTER] },
    { name: 'lifelink blocker', attackers: [LOBSTER], blockers: [PANDA] },
    { name: 'lifelink + double strike unblocked', attackers: [{ card: WEREWOLF, abilities: ['double_strike', 'lifelink'] }], blockers: [] },
    { name: 'lifelink + trample', attackers: [{ card: LION, abilities: ['trample', 'lifelink'] }], blockers: [BEETLE] },
    { name: 'two attackers: blocks go in declared order', attackers: [LION, LOBSTER], blockers: [SQUID] },
    { name: 'three attackers, two blockers, mixed keywords', attackers: [WEREWOLF, PANDA, SNAKE], blockers: [SQUID, BEETLE] }
];

// Lethal attacks end the match part-way, so later life changes are ignored (as the game does); each gets
// its own page because the match really ends.
const LETHAL = [
    { name: 'lethal: the second attacker\'s lifelink no longer counts', attackers: [WEREWOLF, PANDA], blockers: [], defenderLife: 6, attackerLife: 10 },
    { name: 'lethal through trample with lifelink, life floors at 0', attackers: [{ card: LION, power: 9, abilities: ['trample', 'lifelink'] }], blockers: [BEETLE], defenderLife: 3, attackerLife: 5 }
];

// Installs counters for randomness and timers, and returns a fingerprint of everything that must not change
function installSpies(page) {
    return page.evaluate(() => {
        if (window.__spies) return;
        window.__spies = { random: 0, timers: 0 };
        const random = Math.random;
        Math.random = () => { window.__spies.random++; return random(); };
        const timeout = window.setTimeout;
        window.setTimeout = (...a) => { window.__spies.timers++; return timeout(...a); };
    });
}
const fingerprint = page => page.evaluate(() => JSON.stringify({
    gameState, meta: gameMeta, stats: gameStats, spies: window.__spies,
    floating: document.querySelectorAll('.floating-number, .damage-number').length,
    overlays: ['victoryOverlay', 'loseOverlay', 'matchRewardOverlay'].map(id => document.getElementById(id).className)
}));

// Preview (pure), then the real attack; returns both in comparable form
async function previewThenResolve(page, attackerSide) {
    await installSpies(page);
    const before = await fingerprint(page);
    const preview = await page.evaluate(side => {
        const attackers = side === 'player'
            ? gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id))
            : gameState.enemyBoard.filter(c => c.type === 'creature' && canAttack(c));
        const p = previewCombat(attackers, side === 'player' ? gameState.enemyBoard : gameState.playerBoard, side === 'player');
        const find = id => [...gameState.playerBoard, ...gameState.enemyBoard].find(c => c.id === id);
        return {
            life: p.life,
            deaths: [...p.deaths].sort(),
            survivors: Object.fromEntries(p.pairs.flatMap(pair => [
                ...(pair.attackerDies ? [] : [[pair.attackerId, pair.attackerDamage]]),
                ...pair.blockerIds.filter(id => !pair.blockersDie.includes(id)).map(id => [id, pair.blockerDamage[id]])
            ])),
            lines: p.pairs.map(pair => describeCombatPair({
                attacker: find(pair.attackerId), blockers: pair.blockerIds.map(find), attackerDies: pair.attackerDies,
                blockersDie: pair.blockersDie, lifeChange: pair.lifeChange
            }, side === 'player')),
            result: p.result,
            attackerIds: attackers.map(c => c.id)
        };
    }, attackerSide);
    assert.equal(await fingerprint(page), before, 'the preview changed nothing: cards, life, mana, randomness, timers, rewards');

    const historyBefore = await page.evaluate(() => matchHistory.length);
    if (attackerSide === 'player') {
        await act(page, () => confirmAttackers());
    } else {
        await act(page, ids => resolveEnemyAttackPhase(ids.map(id => gameState.enemyBoard.find(c => c.id === id))), preview.attackerIds);
    }
    const actual = await page.evaluate(({ ids, historyBefore }) => {
        const all = [...gameState.playerBoard, ...gameState.enemyBoard];
        const combat = matchHistory.slice(historyBefore).find(e => e.text.startsWith('⚔️'));
        return {
            life: { player: gameState.playerLife, enemy: gameState.enemyLife },
            alive: all.map(c => c.id),
            damage: Object.fromEntries(all.filter(c => c.type === 'creature').map(c => [c.id, c.damage || 0])),
            lines: combat ? combat.details : [],
            finalized: gameState.matchFinalized
        };
    }, { ids: preview.attackerIds, historyBefore });
    return { preview, actual };
}

function assertParity({ preview, actual }, label) {
    assert.deepEqual(preview.life, actual.life, `${label}: life totals`);
    const involved = new Set([...preview.deaths, ...Object.keys(preview.survivors).map(Number)]);
    const actuallyDead = [...involved].filter(id => !actual.alive.includes(id)).sort();
    assert.deepEqual(preview.deaths, actuallyDead, `${label}: creatures that die`);
    for (const [id, damage] of Object.entries(preview.survivors)) {
        assert.equal(actual.damage[id], damage, `${label}: damage left on survivor ${id}`);
    }
    assert.deepEqual(preview.lines, actual.lines, `${label}: per-attacker outcome (preview text = history text)`);
}

const swap = row => ({ playerBoard: row.blockers, enemyBoard: row.attackers.map(a => (typeof a === 'string' ? { card: a, summoningSick: false } : { ...a, summoningSick: false })) });

describe('attack preview = combat result, the player attacking', () => {
    let session;
    before(async () => {
        session = await openGamePage({ seed: 11 });
        await startMatch(session.page);
    });
    after(() => session.close());

    for (const row of PARITY) {
        test(row.name, { timeout: 30000 }, async () => {
            const { page } = session;
            await setup(page, { playerBoard: row.attackers, enemyBoard: row.blockers, enemyHand: [], playerGraveyard: [], enemyGraveyard: [],
                playerLife: 20, enemyLife: 20, hasAttackedThisTurn: false });
            await act(page, () => enterAttackPhase());
            await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
            // The on-screen preview is the same prediction
            const shown = await page.evaluate(() => ({
                hidden: document.getElementById('combatPreview').hidden,
                summary: document.querySelector('#combatPreview .combat-preview-summary').textContent,
                items: [...document.querySelectorAll('#combatPreview .combat-preview-list li')].map(li => li.textContent),
                tag: document.querySelector('#combatPreview .cp-tag').textContent
            }));
            assert.equal(shown.hidden, false);
            assert.match(shown.tag, /preview/i, 'labelled as a preview');
            const result = await previewThenResolve(page, 'player');
            assert.deepEqual(shown.items, result.preview.lines, 'the panel lists the same prediction');
            assert.ok(shown.summary.includes(`→ ${result.preview.life.enemy}`), shown.summary);
            assertParity(result, row.name);
        });
    }
});

describe('attack preview = combat result, the AI attacking', () => {
    let session;
    before(async () => {
        session = await openGamePage({ seed: 12 });
        await startMatch(session.page);
    });
    after(() => session.close());

    for (const row of PARITY) {
        test(row.name, { timeout: 30000 }, async () => {
            const { page } = session;
            await setup(page, { ...swap(row), enemyHand: [], playerGraveyard: [], enemyGraveyard: [], playerLife: 20, enemyLife: 20 });
            assertParity(await previewThenResolve(page, 'enemy'), row.name);
        });
    }
});

describe('lethal attacks: the match ends part-way, as in the game', () => {
    for (const row of LETHAL) {
        for (const side of ['player', 'enemy']) {
            test(`${row.name} (${side} attacking)`, { timeout: 30000 }, async t => {
                const page = await openGame(t, { seed: 13 });
                await startMatch(page);
                const lives = side === 'player'
                    ? { playerLife: row.attackerLife, enemyLife: row.defenderLife }
                    : { playerLife: row.defenderLife, enemyLife: row.attackerLife };
                if (side === 'player') {
                    await setup(page, { playerBoard: row.attackers, enemyBoard: row.blockers, enemyHand: [], ...lives, hasAttackedThisTurn: false });
                    await act(page, () => enterAttackPhase());
                    await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
                } else {
                    await setup(page, { ...swap(row), enemyHand: [], ...lives });
                }
                const result = await previewThenResolve(page, side);
                assert.equal(result.preview.result, side === 'player' ? 'win' : 'loss', 'the preview says the match ends');
                assert.equal(result.actual.finalized, true);
                assert.deepEqual(result.preview.life, result.actual.life, 'life totals, including ignored lifelink and the 0 floor');
            });
        }
    }
});

// ------------------------------------------------------------------ selection states and reasons

describe('attack selection', () => {
    test('CONFIRM shows the count; CANCEL leaves without attacking and the attack stays available', { timeout: 30000 }, async t => {
        const page = await openGame(t, { seed: 21 });
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER, PANDA], ...QUIET_ENEMY, hasAttackedThisTurn: false });
        await act(page, () => enterAttackPhase());
        const labels = () => page.evaluate(() => [document.getElementById('attackBtn').textContent.trim(), document.getElementById('endTurnBtn').textContent.trim()]);
        assert.deepEqual(await labels(), ['✓ CONFIRM 0', '✕ CANCEL']);
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        assert.deepEqual(await labels(), ['✓ CONFIRM 1', '✕ CANCEL']);
        await act(page, () => document.getElementById('endTurnBtn').click());
        const after = await page.evaluate(() => ({ attackPhase, attackers: gameState.attackers.length, attacked: gameState.hasAttackedThisTurn, life: gameState.enemyLife, phase: gameState.phase, turn: gameState.turn }));
        assert.deepEqual(after, { attackPhase: false, attackers: 0, attacked: false, life: 20, phase: 'main', turn: 'player' });
        assert.deepEqual(await labels(), ['⚔️ ATTACK', 'END TURN']);
        // Space during selection still means END TURN, which is refused mid-attack
        await act(page, () => enterAttackPhase());
        await page.keyboard.press('Space');
        await page.clock.runFor(400);
        assert.equal(await page.evaluate(() => attackPhase && gameState.turn === 'player'), true, 'Space did not cancel or end the turn');
        await act(page, () => { gameState.playerBoard.forEach(c => selectAttacker(c.id)); confirmAttackers(); });
        assert.equal(await page.evaluate(() => gameState.enemyLife), 16);
    });

    test('creatures that cannot attack say why, with the same rule the game uses', { timeout: 30000 }, async t => {
        const page = await openGame(t, { seed: 22 });
        await startMatch(page);
        await setup(page, { playerBoard: [LOBSTER, { card: BEETLE, summoningSick: true }, { card: SQUID, tapped: true }, SNAIL], ...QUIET_ENEMY, hasAttackedThisTurn: false });
        await act(page, () => enterAttackPhase());
        const cards = await page.evaluate(() => gameState.playerBoard.filter(c => c.type === 'creature').map(c => {
            const el = document.getElementById(`card-player-${c.id}`);
            return { name: c.name, rule: getAttackRestriction(c), canAttack: el.classList.contains('can-attack'), label: el.getAttribute('aria-label'),
                chip: el.querySelector('.card-reason')?.textContent || '' };
        }));
        for (const c of cards) {
            if (c.rule === null) {
                assert.ok(c.canAttack && !c.chip, `${c.name} is marked as able to attack`);
            } else {
                assert.ok(c.label.includes(`can't attack: it ${c.rule}`), `${c.name}: ${c.label}`);
                assert.ok(c.chip.length > 0, `${c.name} shows a reason on the card`);
            }
        }
        assert.deepEqual(cards.map(c => c.chip), ['', 'Next turn', 'Tapped', 'Defender']);
        // Pressing one adds nothing
        await act(page, () => gameState.playerBoard.forEach(c => selectAttacker(c.id)));
        assert.equal(await page.evaluate(() => gameState.attackers.length), 1);
    });

    test('hand cards say why they cannot be played, and the reason matches what playCard does', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 23 });
        await startMatch(page);
        const hand = ['lands-volcanic-peak', 'lands-mystic-springs', LOBSTER, 'creatures-ancient-dragon', 'spells-fireball', { card: 'artifacts-prism-core' }];
        const check = async label => {
            const rows = await page.evaluate(() => gameState.playerHand.map(c => {
                const el = document.getElementById(`card-player-${c.id}`);
                return { id: c.id, name: c.name, restriction: getPlayRestriction(c), unplayable: el.classList.contains('unplayable'), label: el.getAttribute('aria-label') };
            }));
            for (const row of rows) {
                assert.equal(row.unplayable, !!row.restriction, `${label}: ${row.name} marked`);
                if (row.restriction) assert.ok(row.label.includes(`can't play now: ${row.restriction.text}`), row.label);
                // The reason predicts playCard exactly
                // (setup re-creates the hand with fresh ids, so find the card again by name)
                const played = await page.evaluate(name => {
                    const card = gameState.playerHand.find(c => c.name === name);
                    releaseProcessingLock();
                    playCard(card.id);
                    return { played: !gameState.playerHand.some(c => c.id === card.id) };
                }, row.name);
                await page.clock.runFor(400);
                assert.equal(played.played, !row.restriction, `${label}: ${row.name} ${row.restriction ? `refused (${row.restriction.text})` : 'played'}`);
                await setup(page, { playerHand: hand, playerBoard: currentBoard, playerMana: currentMana, landsPlayedThisTurn: currentLands, ...QUIET_ENEMY });
            }
            return rows;
        };
        let currentBoard = ['lands-volcanic-peak', 'lands-volcanic-peak'];
        let currentMana = { fire: 2 };
        let currentLands = 0;
        await setup(page, { playerHand: hand, playerBoard: currentBoard, playerMana: currentMana, landsPlayedThisTurn: currentLands, ...QUIET_ENEMY });
        let rows = await check('2 fire mana, no land played');
        const dragon = rows.find(r => r.name === 'Ancient Dragon');
        assert.match(dragon.restriction.text, /Needs 4 🔥 more in your mana pool/);
        currentLands = 1;
        await setup(page, { playerHand: hand, playerBoard: currentBoard, playerMana: currentMana, landsPlayedThisTurn: 1, ...QUIET_ENEMY });
        rows = await check('a land already played');
        assert.equal(rows.find(r => r.name === 'Volcanic Peak').restriction.code, 'land');
        // Enemy turn: nothing can be played
        await page.evaluate(() => { gameState.turn = 'enemy'; gameState.phase = 'enemy'; updateUI({ immediate: true }); });
        const enemyTurn = await page.evaluate(() => gameState.playerHand.map(c => getPlayRestriction(c)?.code));
        assert.ok(enemyTurn.every(code => code === 'turn'));
        await page.evaluate(() => { gameState.turn = 'player'; gameState.phase = 'main'; });
        // Details say it too
        const detail = await page.evaluate(() => { showCardDetail(gameState.playerHand.find(c => c.name === 'Ancient Dragon')); return document.getElementById('detailContent').textContent; });
        assert.match(detail, /Can't play now: Needs 4 🔥 more/);
    });
});

describe('the preview goes stale and updates when the board changes', () => {
    test('blockers, life and the chosen attackers all refresh it', { timeout: 30000 }, async t => {
        const page = await openGame(t, { seed: 24 });
        await startMatch(page);
        await setup(page, { playerBoard: [LION], enemyBoard: [SQUID], enemyHand: [], hasAttackedThisTurn: false });
        await act(page, () => enterAttackPhase());
        const read = () => page.evaluate(() => ({
            key: document.getElementById('combatPreview').dataset.previewKey,
            summary: document.querySelector('#combatPreview .combat-preview-summary').textContent,
            items: [...document.querySelectorAll('#combatPreview .combat-preview-list li')].map(li => li.textContent)
        }));
        const empty = await read();
        assert.match(empty.summary, /Tap creatures to attack/);
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        const blocked = await read();
        assert.match(blocked.items[0], /blocked by/);
        // The squid taps (as an effect might do): no blocker any more
        await act(page, () => { gameState.enemyBoard[0].tapped = true; updateUI({ immediate: true }); });
        const unblocked = await read();
        assert.notEqual(unblocked.key, blocked.key, 'invalidated');
        assert.match(unblocked.items[0], /unblocked/);
        assert.match(unblocked.summary, /Enemy ❤️ 20 → 16/);
        // Life changes refresh it too
        await act(page, () => { gameState.enemyLife = 3; updateUI({ immediate: true }); });
        assert.match((await read()).summary, /Enemy ❤️ 3 → 0 .*Wins the match/);
        // Deselecting empties it
        await act(page, () => selectAttacker(gameState.playerBoard[0].id));
        assert.match((await read()).summary, /Tap creatures to attack/);
        // And it is gone outside attacker selection
        await act(page, () => cancelAttack());
        assert.equal(await page.evaluate(() => document.getElementById('combatPreview').hidden), true);
    });
});

// ------------------------------------------------------------------ turn banner, AI status, history

describe('turn banner and AI status', () => {
    test('shows whose turn it is, the turn number and what the AI is doing', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 25 });
        await startMatch(page);
        const banner = () => page.evaluate(() => ({ turn: document.getElementById('turnBanner').dataset.turn, text: document.getElementById('turnBanner').querySelector('.turn-banner-main').textContent.replace(/\s+/g, ' ').trim() }));
        assert.deepEqual(await banner(), { turn: 'player', text: 'Turn 1 ⚔️ Your turn · Main phase' });
        await page.evaluate(() => {
            window.__statuses = [];
            new MutationObserver(() => window.__statuses.push(document.querySelector('#turnBanner .turn-banner-text').textContent))
                .observe(document.querySelector('#turnBanner .turn-banner-text'), { childList: true, characterData: true, subtree: true });
        });
        await act(page, () => endTurn());
        await page.clock.runFor(1600);
        assert.equal((await banner()).turn, 'enemy');
        await page.clock.runFor(12000);
        const statuses = await page.evaluate(() => window.__statuses);
        for (const expected of [/Enemy turn · Drawing a card/, /Enemy turn · (Tapping mana|Choosing what to play)/, /Enemy turn · (Attacking with \d+ creatures?|Not attacking)/]) {
            assert.ok(statuses.some(s => expected.test(s)), `status ${expected} (seen: ${[...new Set(statuses)].join(' | ')})`);
        }
        assert.deepEqual(await banner(), { turn: 'player', text: 'Turn 2 ⚔️ Your turn · Main phase' });
    });

    test('the turn change pulse is brief, and still under reduced motion', { timeout: 30000 }, async t => {
        const page = await openGame(t, { seed: 26 });
        await startMatch(page);
        const pulse = () => page.evaluate(() => {
            const banner = document.getElementById('turnBanner');
            banner.dataset.turn = '';
            updateTurnBanner();
            const s = getComputedStyle(banner);
            return { name: s.animationName, duration: parseFloat(s.animationDuration), count: s.animationIterationCount };
        });
        const normal = await pulse();
        assert.equal(normal.count, '1');
        assert.ok(normal.duration <= 0.6);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.ok((await pulse()).duration < 0.01);
    });
});

describe('match history', () => {
    test('records attacks, blocks, damage, deaths and resolved effects once, apart from rendering', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 27 });
        await startMatch(page);
        await setup(page, { playerBoard: [LION, 'lands-volcanic-peak', 'lands-volcanic-peak', 'lands-volcanic-peak'], enemyBoard: [BEETLE, SQUID], enemyHand: [],
            playerHand: ['spells-fireball'], playerMana: { fire: 3 }, hasAttackedThisTurn: false });
        const start = await page.evaluate(() => matchHistory.length);
        await act(page, () => { for (let i = 0; i < 5; i++) updateUI({ immediate: true }); });
        assert.equal(await page.evaluate(() => matchHistory.length), start, 'rendering records nothing');
        await act(page, () => playCard(gameState.playerHand[0].id));
        await act(page, () => { enterAttackPhase(); gameState.playerBoard.filter(c => c.type === 'creature').forEach(c => selectAttacker(c.id)); confirmAttackers(); });
        const events = await page.evaluate(n => matchHistory.slice(n), start);
        assert.equal(events.length, 2, JSON.stringify(events.map(e => e.text)));
        assert.match(events[0].text, /You cast Fireball/);
        assert.ok(events[0].details.some(d => /Enemy: ❤️ 20 → 17/.test(d)), JSON.stringify(events[0].details));
        assert.match(events[1].text, /You attack with 1 creature/);
        assert.match(events[1].details[0], /Fire Lion: blocked by 🦑 Giant Squid · Giant Squid dies · Fire Lion (dies|survives)/);
        await act(page, () => { for (let i = 0; i < 5; i++) updateUI({ immediate: true }); });
        assert.equal(await page.evaluate(() => matchHistory.length), start + 2, 'still recorded once');
    });

    test('is bounded, accessible from the header and with H, and closes with Esc', { timeout: 60000 }, async t => {
        const page = await openGame(t, { seed: 28 });
        await startMatch(page);
        await page.evaluate(() => { for (let i = 0; i < 200; i++) recordHistory('player', `event ${i}`); updateUI({ immediate: true }); });
        const state = await page.evaluate(() => ({ length: matchHistory.length, first: matchHistory[0].text, label: document.getElementById('historyBtn').getAttribute('aria-label') }));
        assert.equal(state.length, 80);
        assert.equal(state.first, 'event 120');
        assert.match(state.label, /Match history, \d+ new/);
        await page.keyboard.press('h');
        await page.clock.runFor(200);
        const open = await page.evaluate(() => ({
            open: document.getElementById('historyModal').classList.contains('show'),
            role: document.getElementById('historyModal').getAttribute('role'),
            items: document.querySelectorAll('#historyList .history-item').length,
            note: document.getElementById('historyNote').textContent,
            focusInside: document.getElementById('historyModal').contains(document.activeElement),
            label: document.getElementById('historyBtn').getAttribute('aria-label')
        }));
        assert.deepEqual({ ...open, note: undefined }, { open: true, role: 'dialog', items: 80, note: undefined, focusInside: true, label: 'Match history' });
        assert.match(open.note, /older not kept/);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.getElementById('historyModal').classList.contains('show')), false);
    });

    test('never names a card still hidden in the AI hand', { timeout: 120000 }, async t => {
        const page = await openGame(t, { seed: 29 });
        await startMatch(page);
        for (let turn = 0; turn < 4 && !(await page.evaluate(() => gameState.matchFinalized)); turn++) {
            await act(page, () => endTurn());
            await page.clock.runFor(14000);
        }
        const leak = await page.evaluate(() => {
            const text = matchHistory.map(e => [e.text, ...e.details].join(' ')).join(' | ');
            const publicNames = new Set([...gameState.enemyBoard, ...gameState.enemyGraveyard, ...gameState.playerBoard, ...gameState.playerGraveyard,
                ...gameState.playerHand].map(c => c.name));
            const hidden = gameState.enemyHand.map(c => c.name).filter(name => !publicNames.has(name) && !matchHistory.some(e => e.side === 'enemy' && e.text.includes(name)));
            return { hidden, named: hidden.filter(name => text.includes(name)), drawLines: matchHistory.flatMap(e => e.details).filter(d => /Enemy draws/.test(d)) };
        });
        assert.ok(leak.hidden.length > 0, 'the AI holds cards nobody has seen');
        assert.deepEqual(leak.named, [], 'hidden AI cards are never named');
        assert.ok(leak.drawLines.every(line => /^Enemy draws \d+ cards?$/.test(line)), JSON.stringify(leak.drawLines));
    });
});
