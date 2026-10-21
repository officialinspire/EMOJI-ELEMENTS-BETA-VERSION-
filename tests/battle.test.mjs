// Battle screen and pause for EMOJI ELEMENTS, run against the real game in headless Chromium.
//
//   node --test tests/battle.test.mjs        (or: npm run battle)
//
// Pause must really stop the match: the AI's turn, its failsafe and the toasts wait, the board takes no input
// (mouse, touch or keys), and RESUME continues the same match from where it was, with focus back where it was.
// Also covered: the pause panel's settings (sound, music, haptics, theme), leaving through the existing
// confirmation, pausing when the page is hidden, toasts that never cover a card, the marks for the AI's
// activity (new cards, its attackers, your automatic blockers), distinct attacker and blocker outlines, the
// counters, and a long session of pauses without leaking timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame as openRunningGame, startMatch, act, setup, snapshot, clickAt, QUIET_ENEMY } from './lib/game.mjs';

useGameBrowser();

// install() alone still advances with host time. All battle scenarios step a stopped clock so
// timer boundaries and the frame displaying AI markers cannot race with protocol round trips.
async function openGame(t, options) {
    const page = await openRunningGame(t, options);
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    return page;
}

const LOBSTER = 'creatures-fire-lobster';          // 2/2
const BEETLE = 'creatures-ember-beetle';           // 1/2
const SHARK = 'creatures-great-shark';             // 4/3 menace
const SNAIL = 'creatures-armored-snail';           // 0/3 defender
const PEAK = 'lands-volcanic-peak';

const paused = page => page.evaluate(() => ({
    flag: gamePaused,
    modal: document.getElementById('pauseModal').classList.contains('show'),
    inert: document.getElementById('gameContainer').inert
}));

// An enemy that will play a creature and attack on its turn
const ACTIVE_ENEMY = {
    enemyHand: [BEETLE],
    enemyBoard: [PEAK, PEAK, { card: SHARK }],
    enemyDeck: Array(10).fill(LOBSTER)
};

test('pause stops the AI turn where it is; resume finishes it in the same match', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...ACTIVE_ENEMY, playerBoard: [PEAK], playerHand: [] });
    const serial = await page.evaluate(() => matchSerial);
    await page.evaluate(() => { endTurn(); pauseGame(); });
    const atPause = await snapshot(page);
    assert.equal(atPause.turn, 'enemy');
    const historyAtPause = await page.evaluate(() => matchHistory.length);

    // Far longer than a whole AI turn and its 12 s failsafe
    await page.clock.runFor(30000);
    assert.deepEqual(await snapshot(page), atPause, 'nothing moved while paused');
    assert.equal(await page.evaluate(() => matchHistory.length), historyAtPause);
    assert.equal(await page.evaluate(() => document.getElementById('gameLog').classList.contains('show')), false, 'no toast while paused');
    assert.deepEqual(await paused(page), { flag: true, modal: true, inert: true });

    await page.evaluate(() => resumeGame());
    assert.deepEqual(await paused(page), { flag: false, modal: false, inert: false });
    await page.clock.runFor(12000);
    const after = await snapshot(page);
    assert.equal(after.turn, 'player', 'the AI turn finished after resuming');
    assert.ok(after.enemyBoard.length > atPause.enemyBoard.length, 'the AI played its creature');
    assert.equal(await page.evaluate(() => matchSerial), serial, 'same match');
    assert.equal(await page.evaluate(() => gameState.round), 2);
});

// Freeze the clock: install() alone still advances with wall time between protocol calls.
// Assert the boundary exactly, even if the host stalls, rather than widening timing tolerances.
test('the remaining time carries over exactly across pause and resume', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, playerBoard: [PEAK], playerHand: [] });
    await page.evaluate(() => endTurn());
    await page.clock.runFor(500); // AI starts 1500 ms after END TURN
    await page.evaluate(() => pauseGame());
    assert.ok(await page.evaluate(() => [...matchTimers.values()].some(timer => timer.remaining === 1000)), 'AI has exactly 1000 ms left');
    await page.clock.runFor(30000); // includes the AI failsafe deadline
    assert.equal(await page.evaluate(() => aiStatusText), 'Starting its turn');
    await page.evaluate(() => resumeGame());
    await page.clock.runFor(999);
    // Simulate a slow host/protocol round trip: real time must not advance the paused fake clock.
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await page.evaluate(() => aiStatusText), 'Starting its turn', 'not before the remaining delay');
    await page.clock.runFor(1);
    assert.notEqual(await page.evaluate(() => aiStatusText), 'Starting its turn', 'fires at exactly the remaining delay');
});

test('while paused the board takes no input: keys, clicks and direct calls do nothing', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, playerBoard: [PEAK, { card: LOBSTER }], playerHand: [PEAK, BEETLE], playerMana: { fire: 2 } });
    const before = await snapshot(page);
    await page.keyboard.press('Escape');
    assert.equal((await paused(page)).flag, true, 'Esc pauses');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pauseResumeBtn');
    // Space/Enter on RESUME should activate it. Exercise board shortcuts from the neutral body instead.
    await page.evaluate(() => document.activeElement.blur());

    for (const key of ['Space', 'e', 'a', 'm', 'Enter']) await page.keyboard.press(key);
    await page.mouse.click(40, 40);                     // outside the panel: the backdrop
    await page.evaluate(() => {
        const handCard = document.querySelector('#playerHand .card');
        handCard?.click();
        playCard(gameState.playerHand[0].id);
        tapLand(gameState.playerBoard[0].id);
        enterAttackPhase();
        endTurn();
        mulligan();
    });
    await page.clock.runFor(2000);
    assert.deepEqual(await snapshot(page), before);
    assert.equal((await paused(page)).flag, true, 'still paused');
    assert.equal(await page.evaluate(() => attackPhase), false);
});

test('Space and Enter on the focused RESUME button resume without advancing the turn', async t => {
    const page = await openGame(t);
    await startMatch(page);
    const before = await snapshot(page);
    for (const key of ['Space', 'Enter']) {
        await page.evaluate(() => pauseGame());
        await page.clock.runFor(100);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'pauseResumeBtn');
        await page.keyboard.press(key);
        assert.equal((await paused(page)).flag, false, `${key} activates RESUME`);
        assert.deepEqual(await snapshot(page), before, 'resuming does not play a card or pass the turn');
    }
});

test('resume returns focus to the card that had it', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, playerHand: [PEAK, BEETLE, LOBSTER] });
    await page.focus('#playerHand .card:nth-child(2)');
    const focused = await page.evaluate(() => document.activeElement.dataset.cardId);
    await page.keyboard.press('Escape');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pauseResumeBtn', 'focus moves to RESUME');
    // Tab stays inside the panel
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.getElementById('pauseModal').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await page.clock.runFor(100);
    assert.equal((await paused(page)).flag, false, 'Esc resumes');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cardId), focused);
});

test('pause panel: sound, music, effects and haptics switches are saved apart from the profile', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await page.evaluate(() => { navigator.vibrate = pattern => { (window.__buzz ||= []).push(pattern); return true; }; });
    await startMatch(page);
    await page.mouse.click(5, 5);                       // a user gesture: haptics and audio may start
    const metaBefore = await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1'));
    await page.evaluate(() => pauseGame());
    const read = () => page.evaluate(() => ({
        sound: document.getElementById('pauseSoundSwitch').getAttribute('aria-checked'),
        music: document.getElementById('pauseMusicSwitch').getAttribute('aria-checked'),
        sfx: document.getElementById('pauseSfxSwitch').getAttribute('aria-checked'),
        channelsDisabled: document.getElementById('pauseMusicSwitch').disabled && document.getElementById('pauseSfxSwitch').disabled,
        haptics: document.getElementById('pauseHapticsSwitch').getAttribute('aria-checked'),
        musicMuted: audioSystem.gameplayMusic.muted,
        keys: [localStorage.getItem('emojiElementsMuted'), localStorage.getItem('emojiElementsMusicOff'), localStorage.getItem('emojiElementsSfxOff'), localStorage.getItem('emojiElementsHaptics')]
    }));
    assert.deepEqual(await read(), { sound: 'true', music: 'true', sfx: 'true', channelsDisabled: false, haptics: 'true', musicMuted: false, keys: [null, null, null, null] });

    await clickAt(page, '#pauseMusicSwitch');
    assert.deepEqual(await read(), { sound: 'true', music: 'false', sfx: 'true', channelsDisabled: false, haptics: 'true', musicMuted: true, keys: [null, 'true', null, null] });

    await clickAt(page, '#pauseSoundSwitch');
    const muted = await read();
    assert.equal(muted.sound, 'false');
    assert.equal(muted.channelsDisabled, true, 'music and effects follow the master switch');
    assert.equal(await page.evaluate(() => document.getElementById('muteBtn').getAttribute('aria-pressed')), 'true', 'the header mute agrees');
    assert.equal(await page.evaluate(() => document.getElementById('gameLog').classList.contains('show')), false, 'no toast behind the panel');
    await clickAt(page, '#pauseSoundSwitch');

    await clickAt(page, '#pauseHapticsSwitch');
    assert.equal((await read()).haptics, 'false');
    const buzzes = await page.evaluate(() => (window.__buzz || []).length);
    await page.clock.runFor(1000);
    await page.evaluate(() => haptic('impact'));
    assert.equal(await page.evaluate(() => (window.__buzz || []).length), buzzes, 'no buzz when switched off');
    await page.clock.runFor(1000);
    await clickAt(page, '#pauseHapticsSwitch');
    assert.ok(await page.evaluate(() => (window.__buzz || []).length) > buzzes, 'switching it on buzzes once');

    assert.equal(await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1')), metaBefore, 'profile untouched');
    // The settings come back after a reload
    await page.reload();
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    assert.deepEqual(await page.evaluate(() => [soundSettings.muted, soundSettings.musicOff, soundSettings.sfxOff, soundSettings.haptics]), [false, true, false, true]);
});

test('pause panel: THEME opens the picker on top; Esc closes only the picker; the panel names the theme', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await page.evaluate(() => pauseGame());
    await clickAt(page, '#pauseModal .pause-theme-btn');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.getElementById('themeDialog').classList.contains('show')), true);
    await page.evaluate(() => applyVisualTheme('neon'));
    await page.keyboard.press('Escape');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.getElementById('themeDialog').classList.contains('show')), false);
    assert.equal((await paused(page)).flag, true, 'still paused');
    assert.equal(await page.textContent('#pauseThemeName'), 'Neon Sci-Fi');
});

test('MAIN MENU asks first; NO keeps the match paused, YES leaves cleanly and the next match runs', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, playerHand: [] });
    await page.evaluate(() => { endTurn(); pauseGame(); });
    await clickAt(page, '#pauseModal .pause-quit');
    await page.clock.runFor(300);
    assert.equal(await page.evaluate(() => document.getElementById('gameConfirmModal').classList.contains('show')), true, 'the existing confirmation');
    await clickAt(page, '#gameConfirmNoBtn');
    await page.clock.runFor(300);
    assert.deepEqual(await paused(page), { flag: true, modal: true, inert: true });
    await page.clock.runFor(20000);
    assert.equal((await snapshot(page)).turn, 'enemy', 'still waiting');

    await clickAt(page, '#pauseModal .pause-quit');
    await page.clock.runFor(300);
    await clickAt(page, '#gameConfirmYesBtn');
    await page.clock.runFor(300);
    assert.equal(await page.evaluate(() => document.getElementById('gameContainer').style.display), 'none');
    assert.deepEqual(await paused(page), { flag: false, modal: false, inert: false });
    assert.equal(await page.evaluate(() => matchTimers.size), 0, 'the old match left no timers');

    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, playerHand: [] });
    await act(page, () => endTurn());
    await page.clock.runFor(12000);
    assert.equal((await snapshot(page)).turn, 'player', 'the new match plays normally');
});

test('a match pauses itself when the page is hidden', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal((await paused(page)).flag, true);
    // Not in the menus
    await page.evaluate(() => { resumeGame(); returnToMainMenu(); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await paused(page)).flag, false);
});

test('during a match, toasts sit on the turn banner and cover no card; in menus they stay centred', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, {
        ...QUIET_ENEMY,
        enemyBoard: Array(6).fill(LOBSTER),
        playerBoard: [PEAK, PEAK, ...Array(6).fill(BEETLE)],
        playerHand: Array(7).fill(LOBSTER)
    });
    const overlap = await page.evaluate(() => {
        showGameLog('⚔️ Your attack: Fire Lobster ⛔ blocked by Fire Lobster · Fire Lobster ➜ unblocked (2) · Fire Lobster ➜ unblocked (2)', false, false, { hold: 3500 });
        const log = document.getElementById('gameLog').getBoundingClientRect();
        const hits = [...document.querySelectorAll('#gameContainer .card, #gameContainer .land-stack-card')]
            .map(c => c.getBoundingClientRect())
            .filter(r => r.width && !(r.right <= log.left || r.left >= log.right || r.bottom <= log.top || r.top >= log.bottom));
        return { parent: document.getElementById('gameLog').parentElement.id, hits: hits.length };
    });
    assert.deepEqual(overlap, { parent: 'turnBanner', hits: 0 });
    await page.evaluate(() => { returnToMainMenu(); showGameLog('Saved deck FIRE.'); });
    assert.equal(await page.evaluate(() => document.getElementById('gameLog').parentElement === document.body), true);
});

test('the AI\'s activity is marked: new cards, its attackers, and your automatic blockers', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, {
        enemyHand: [LOBSTER],
        enemyBoard: [PEAK, PEAK, { card: SHARK }],
        enemyDeck: Array(10).fill(BEETLE),
        playerBoard: [{ card: SNAIL }],
        playerHand: []
    });
    await page.evaluate(() => endTurn());
    // Run the AI up to its attack (the attack pause keeps the marks up)
    let attacked = false;
    for (let i = 0; i < 80 && !attacked; i++) {
        await page.clock.runFor(100);
        attacked = await page.evaluate(() => enemyCombatMarks.attackers.size > 0);
    }
    // The board redraws on the next frame after the attack (updateUI is scheduled)
    await page.clock.runFor(50);
    const marks = await page.evaluate(() => enemyCombatMarks.attackers.size ? {
            newCards: [...document.querySelectorAll('#enemyBoard .card.ai-new')].map(c => c.querySelector('.ai-new-chip')?.textContent),
            attackers: document.querySelectorAll('#enemyBoard .card.enemy-attacking').length,
            blockers: document.querySelectorAll('#playerBoard .card.auto-blocked').length,
            banner: document.querySelector('.turn-banner-text').textContent
        } : null);
    assert.ok(marks, 'the enemy attacked');
    assert.deepEqual(marks.newCards, ['New'], 'the creature it just played');
    assert.ok(marks.attackers >= 1);
    assert.match(marks.banner, /Attacking with/);
    await page.clock.runFor(3000);
    const playerTurn = await page.evaluate(() => ({
        turn: gameState.turn,
        attackers: document.querySelectorAll('.enemy-attacking').length,
        blocked: document.querySelectorAll('.auto-blocked').length,
        stillNew: document.querySelectorAll('#enemyBoard .ai-new').length
    }));
    assert.deepEqual(playerTurn, { turn: 'player', attackers: 0, blocked: 0, stillNew: 1 }, 'NEW stays for your turn; combat marks go');
});

test('your automatic blockers are marked during the enemy attack', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, enemyBoard: [{ card: LOBSTER }], playerBoard: [{ card: SNAIL }], playerHand: [] });
    const marked = await page.evaluate(() => {
        gameState.turn = 'enemy';
        gameState.phase = 'enemy';
        resolveEnemyAttackPhase([gameState.enemyBoard[0]]);
        updateUI({ immediate: true });
        const blocker = document.querySelector('#playerBoard .card.auto-blocked');
        return { blocker: !!blocker, shield: blocker?.querySelector('.card-state-blocked')?.textContent, label: blocker?.getAttribute('aria-label') };
    });
    assert.equal(marked.blocker, true);
    assert.equal(marked.shield, '🛡');
    assert.match(marked.label, /blocked automatically/);
});

test('attackers, possible attackers and predicted blockers each look different, not only by colour', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, enemyBoard: [{ card: SNAIL }], playerBoard: [{ card: LOBSTER }, { card: BEETLE }], playerHand: [] });
    const styles = await act(page, () => {
        enterAttackPhase();
        selectAttacker(gameState.playerBoard[0].id);
        updateUI({ immediate: true });
        const style = sel => { const s = getComputedStyle(document.querySelector(sel)); return `${s.outlineStyle} ${s.outlineColor}`; };
        return {
            attacker: style('#playerBoard .card.attacking'),
            canAttack: style('#playerBoard .card.can-attack'),
            blocker: style('#enemyBoard .card.preview-blocker'),
            mark: document.querySelector('#enemyBoard .preview-mark')?.textContent
        };
    });
    const kinds = [styles.attacker, styles.canAttack, styles.blocker].map(s => s.split(' ')[0]);
    assert.deepEqual(kinds, ['solid', 'dashed', 'dotted']);
    assert.match(styles.mark, /🛡/);
});

test('counters: life, deck and the enemy\'s hand size, with labels for screen readers', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    const counters = await page.evaluate(() => ({
        hand: document.getElementById('enemyHandCount').textContent === String(gameState.enemyHand.length),
        labels: [...document.querySelectorAll('.player-info .sr-only')].map(e => e.textContent)
    }));
    assert.equal(counters.hand, true);
    assert.deepEqual(counters.labels, ['Enemy life', 'Enemy deck', 'Enemy hand', 'Your life', 'Your deck']);
});

test('a long session: 15 turns with a pause in each leave no stray timers and no errors', { timeout: 180000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await setup(page, { ...QUIET_ENEMY, enemyDeck: Array(40).fill(LOBSTER), playerHand: [] });
    for (let turn = 0; turn < 15; turn++) {
        await act(page, () => endTurn());
        await page.evaluate(() => pauseGame());
        await page.clock.runFor(4000);
        await page.evaluate(() => resumeGame());
        await page.clock.runFor(12000);
        assert.equal((await snapshot(page)).turn, 'player', `turn ${turn}`);
    }
    const left = await page.evaluate(() => ({ timers: matchTimers.size, round: gameState.round }));
    assert.ok(left.timers <= 3, `at most a few pending (toasts, lock): ${left.timers}`);
    assert.equal(left.round, 16);
});
