// Sound effects, settings and haptics for EMOJI ELEMENTS (feedback.js), run against the real game in headless
// Chromium.
//
//   node --test tests/audio.test.mjs        (or: npm run audio)
//
// Headless Chromium has no speakers, so these tests check what the game asks for, not what a person hears: which
// cues are scheduled or skipped (GameFeedback.stats), what is rendered (OfflineAudioContext: length and level),
// which vibration patterns are requested (a stubbed navigator.vibrate), and the settings. Listening on real
// devices is recorded separately (AUDIO.md §6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, openGamePage, startMatch, act, setup, clickAt, QUIET_ENEMY } from './lib/game.mjs';

useGameBrowser();

const LOBSTER = 'creatures-fire-lobster';          // 2/2
const SHARK = 'creatures-great-shark';             // 4/3 menace
const PEAK = 'lands-volcanic-peak';
const MEDITATE = 'spells-meditate';                // heal 3, draw 1 (heal_draw)

// Records every cue the game asks for (name and options) and every vibration request
async function spy(page) {
    await page.evaluate(() => {
        window.__cues = [];
        window.__buzz = [];
        window.__buzzKinds = [];
        const originalHaptic = window.__originalHaptic ||= GameFeedback.haptic;
        GameFeedback.haptic = (kind) => { window.__hapticKind = kind; try { return originalHaptic(kind); } finally { window.__hapticKind = null; } };
        const play = window.__originalPlay ||= GameFeedback.play;   // wrap the original only once
        GameFeedback.play = (name, options = {}) => { const ok = play(name, options); window.__cues.push({ name, options, ok }); return ok; };
        navigator.vibrate = pattern => { window.__buzz.push(pattern); window.__buzzKinds.push({ kind: window.__hapticKind, pattern }); return true; };
    });
}
const cues = page => page.evaluate(() => window.__cues);
const played = async (page, name) => (await cues(page)).filter(c => c.name === name && c.ok).length;
const buzz = page => page.evaluate(() => window.__buzz);
const gesture = page => page.mouse.click(3, 3);    // a real user gesture (unlocks audio and haptics)

test('nothing plays before the first gesture; effect files are no longer downloaded', { timeout: 60000 }, async t => {
    const { page, close } = await openGamePage();
    t.after(close);
    const before = await page.evaluate(() => ({ state: GameFeedback.state, played: GameFeedback.play('select'), buzz: GameFeedback.haptic('select') }));
    assert.deepEqual(before, { state: 'locked', played: false, buzz: false });
    const media = await page.evaluate(() => performance.getEntriesByType('resource').map(e => decodeURIComponent(e.name.split('/').pop())).filter(n => /\.(mp3|mp4)$/.test(n)));
    for (const name of media) assert.ok(['minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3', 'inspiresoftwareintro.mp4'].includes(name), name);
    await gesture(page);
    await page.waitForFunction(() => GameFeedback.state === 'running', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => GameFeedback.play('select')), true);
});

test('every cue renders short and below clipping; tails stay short', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    const rows = await page.evaluate(async () => {
        const out = {};
        for (const [name, options] of [['select'], ['open'], ['close'], ['pickup'], ['summon', { variant: 'scifi' }], ['artifact'], ['spell'], ['landTap'],
            ['turnStart'], ['attack'], ['block'], ['damageTaken', { intensity: 1 }], ['damageDealt'], ['heal'], ['destroy'], ['packRip'],
            ['reveal', { rarity: 'legendary' }], ['achievement'], ['victory'], ['defeat'], ['deny']]) {
            const { buffer } = await GameFeedback.renderCue(name, options || {}, 2);
            const d = buffer.getChannelData(0);
            let peak = 0, last = 0;
            for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.001) last = i; }
            out[name] = { ms: Math.round(last / 44.1), peakDb: 20 * Math.log10(peak) };
        }
        return out;
    });
    assert.equal(Object.keys(rows).length, 21);
    for (const [name, r] of Object.entries(rows)) {
        assert.ok(r.peakDb < -6, `${name} peaks at ${r.peakDb.toFixed(1)} dBFS`);
        assert.ok(r.peakDb > -40, `${name} is audible`);
        const limit = ['victory', 'defeat'].includes(name) ? 1500 : ['reveal', 'achievement'].includes(name) ? 1000 : 400;
        assert.ok(r.ms <= limit, `${name} rings for ${r.ms} ms (limit ${limit})`);
    }
});

test('settings: master, music, effects and haptics are independent and survive a reload', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await gesture(page);
    await spy(page);
    await page.evaluate(() => GameFeedback.setSetting('sfxOff', true));
    assert.equal(await page.evaluate(() => GameFeedback.play('select')), false, 'effects off');
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.muted), false, 'music still on');
    await page.evaluate(() => { GameFeedback.setSetting('sfxOff', false); GameFeedback.setSetting('musicOff', true); });
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.muted && audioSystem.gameplayMusic.muted), true);
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => GameFeedback.play('select')), true, 'effects on while music is off');
    await page.evaluate(() => { GameFeedback.setSetting('musicVolume', 0.25); GameFeedback.setSetting('sfxVolume', 1.7); GameFeedback.setSetting('haptics', false); });
    assert.equal(await page.evaluate(() => soundSettings.sfxVolume), 1, 'volumes are clamped to 0..1');
    // The master mute silences both and the header button shows it
    await page.evaluate(() => toggleMute());
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => GameFeedback.play('select')), false);
    assert.equal(await page.evaluate(() => document.getElementById('muteBtn').getAttribute('aria-pressed')), 'true');
    const meta = await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1'));

    await page.reload();
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    assert.deepEqual(await page.evaluate(() => ({ ...soundSettings })),
        { muted: true, musicOff: true, musicVolume: 0.25, sfxOff: false, sfxVolume: 1, haptics: false });
    assert.equal(await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1')), meta, 'the profile is untouched');
});

test('the menu Sound dialog and the pause panel show the same settings; sliders move the volume', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await page.evaluate(() => { const m = document.getElementById('startModal'); m.style.display = 'flex'; m.classList.add('modal-visible'); setStartMenuScreen('mainMenu'); });
    await clickAt(page, '#soundChip');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.getElementById('soundDialog').classList.contains('show')), true);
    const slider = '#menuMusicVolume';
    await page.focus(slider);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');      // 4 × 5 %
    assert.equal(await page.evaluate(() => soundSettings.musicVolume), 0.1);
    assert.equal(await page.getAttribute(slider, 'aria-valuetext'), '10%');
    await clickAt(page, '#menuSfxSwitch');
    assert.equal(await page.evaluate(() => soundSettings.sfxOff), true);
    assert.equal(await page.evaluate(() => document.querySelector('[data-sound-volume="sfxVolume"]').hidden), true, 'its slider hides');
    await page.keyboard.press('Escape');
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => document.getElementById('soundDialog').classList.contains('show')), false, 'Esc closes it');

    await startMatch(page);
    await page.evaluate(() => pauseGame());
    const pause = await page.evaluate(() => ({
        music: document.getElementById('pauseMusicVolume').value,
        sfx: document.getElementById('pauseSfxSwitch').getAttribute('aria-checked')
    }));
    assert.deepEqual(pause, { music: '10', sfx: 'false' });
});

test('rapid input: repeats are spaced, overlapping voices are capped, land taps step up gently', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await gesture(page);
    await page.waitForFunction(() => GameFeedback.state === 'running', null, { timeout: 5000 });
    const burst = await page.evaluate(() => {
        let ok = 0;
        for (let i = 0; i < 20; i++) if (GameFeedback.play('select')) ok++;
        return ok;
    });
    assert.equal(burst, 1, 'twenty selects in one moment play once');
    // Every cue at once: never more than 8 voices
    await page.clock.runFor(2000);
    const voices = await page.evaluate(() => { GameFeedback.cues.forEach(c => GameFeedback.play(c)); return GameFeedback.stats().voices; });
    assert.ok(voices <= 8, `${voices} voices`);
    // Six land taps 100 ms apart: each plays, stepping up to the fourth step at most
    await page.clock.runFor(2000);
    await spy(page);
    for (let i = 0; i < 6; i++) { await page.evaluate(() => playLandTap()); await page.clock.runFor(100); }
    const steps = (await cues(page)).filter(c => c.name === 'landTap').map(c => c.options.step);
    assert.deepEqual(steps, [0, 1, 2, 3, 4, 4]);
});

test('damage and healing make one sound per change, not one per point; a heal spell no longer plays twice', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await gesture(page);
    await spy(page);
    await setup(page, { ...QUIET_ENEMY, playerLife: 10, playerHand: [MEDITATE], playerBoard: [PEAK, PEAK], playerMana: { fire: 1, water: 2 } });
    await page.evaluate(() => changePlayerLife(-6));
    await page.clock.runFor(1500);
    assert.equal(await played(page, 'damageTaken'), 1);
    assert.deepEqual((await cues(page)).find(c => c.name === 'damageTaken').options, { intensity: 0.75 });
    assert.deepEqual(await buzz(page), [[22, 40, 30]], 'one impact buzz');
    await act(page, () => { gameState.playerMana = { colorless: 3, water: 3, fire: 3 }; playCard(gameState.playerHand[0].id); });
    await page.clock.runFor(1500);
    const heals = (await cues(page)).filter(c => c.name === 'heal');
    assert.equal(heals.length, 1, `heal cues: ${heals.length}`);
    assert.equal(await played(page, 'spell'), 1);
});

test('a match: plays, taps, attack, block and AI turn use the right cues; the AI never buzzes your phone', { timeout: 90000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await gesture(page);
    await spy(page);
    await setup(page, {
        enemyHand: [LOBSTER],
        enemyBoard: [PEAK, PEAK, { card: SHARK }],
        enemyDeck: Array(10).fill(LOBSTER),
        playerHand: [LOBSTER],
        playerBoard: [PEAK, PEAK, { card: LOBSTER }]
    });
    await act(page, () => tapLand(gameState.playerBoard[0].id));
    await act(page, () => tapLand(gameState.playerBoard[1].id));
    await act(page, () => playCard(gameState.playerHand[0].id));
    await act(page, () => { enterAttackPhase(); selectAttacker(gameState.playerBoard.find(c => c.type === 'creature' && !c.summoningSick).id); });
    await act(page, () => confirmAttackers());
    const mine = (await cues(page)).map(c => c.name);
    for (const name of ['landTap', 'summon', 'select', 'attack']) assert.ok(mine.includes(name), `${name} in ${mine.join(', ')}`);
    const myBuzz = await buzz(page);
    assert.ok(myBuzz.length >= 2 && myBuzz.length <= 4, `buzzes on my turn: ${JSON.stringify(myBuzz)}`);

    await page.evaluate(() => { window.__buzz = []; window.__buzzKinds = []; window.__cues = []; });
    await act(page, () => endTurn());
    await page.clock.runFor(12000);
    const theirs = (await cues(page)).filter(c => c.ok).map(c => c.name);
    assert.ok(theirs.includes('summon'), 'the AI summon is heard');
    // A queued notice for your own achievement can land during the AI turn. Attribute it
    // explicitly; AI card plays still cannot produce a play/select buzz.
    const records = await page.evaluate(() => window.__buzzKinds);
    const notices = records.filter(r => r.kind === 'achievement');
    assert.ok(notices.every(r => JSON.stringify(r.pattern) === '[10,40,10]'));
    if (notices.length) assert.ok((await cues(page)).some(c => c.name === 'achievement'), 'notice requests its achievement cue (voice limits may drop it while fake time outruns Web Audio)');
    const aiBuzz = records.filter(r => r.kind !== 'achievement');
    assert.ok(aiBuzz.every(r => r.kind === 'impact' && JSON.stringify(r.pattern) === '[22,40,30]') && aiBuzz.length <= 1, JSON.stringify(aiBuzz));
});

test('pause: nothing from the match plays while paused; settings still give feedback', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await gesture(page);
    await setup(page, { enemyHand: [LOBSTER], enemyBoard: [PEAK, PEAK, { card: SHARK }], enemyDeck: Array(10).fill(LOBSTER), playerHand: [] });
    await page.evaluate(() => { endTurn(); pauseGame(); });
    await spy(page);
    await page.clock.runFor(20000);
    assert.deepEqual((await cues(page)).filter(c => c.ok).map(c => c.name), [], 'silent while paused');
    await clickAt(page, '#pauseSfxSwitch');
    await clickAt(page, '#pauseSfxSwitch');
    assert.ok((await cues(page)).some(c => c.name === 'select' && c.ok), 'turning effects back on answers');
    await page.evaluate(() => resumeGame());
    await page.clock.runFor(12000);
    assert.ok((await cues(page)).some(c => c.name === 'summon' && c.ok), 'the AI turn continues with its sounds');
});

test('pack opening: a rip, a flip per card, and a rising arpeggio plus a buzz pattern for rare cards', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await gesture(page);
    await spy(page);
    await page.evaluate(() => {
        gameMeta.lastPack = { themeKey: 'alien', cardIds: ['creatures-grey-alien', 'creatures-ufo-saucer', 'spells-comet-strike', 'creatures-space-marine', 'lands-distant-planet'], openedAt: 'x' };
        openPackOpeningOverlayFromMeta('shop');
    });
    await page.clock.runFor(300);
    await page.evaluate(() => triggerPackOpenAnimation());
    await page.clock.runFor(2000);
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => revealCurrentPackCard());
        await page.clock.runFor(300);
        await page.evaluate(() => document.getElementById('packNextBtn').click());
        await page.clock.runFor(400);
    }
    const reveals = (await cues(page)).filter(c => c.name === 'reveal');
    const rarities = await page.evaluate(() => packOpeningState.cards.map(c => getCardRarity(c)));
    assert.equal(await played(page, 'packRip'), 1);
    assert.ok(reveals.length >= 4, `reveals: ${reveals.length}`);
    reveals.forEach((r, i) => assert.equal(r.options.rarity, rarities[i]));
    const rareCount = reveals.filter(r => ['rare', 'epic', 'legendary'].includes(r.options.rarity)).length;
    const rareBuzz = (await buzz(page)).filter(p => JSON.stringify(p) === '[14,40,14,40,26]').length;
    assert.ok(rareCount > 0, 'this pack holds a rare card');
    assert.ok(rareBuzz >= 1 && rareBuzz <= rareCount, `rare buzzes: ${rareBuzz} for ${rareCount} rare cards`);
    assert.ok((await buzz(page)).some(p => p === 12), 'the rip buzzes once');
});

test('win and loss: one stinger and one pattern each; leaving for the menu silences effects', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await startMatch(page);
    await gesture(page);
    await spy(page);
    await setup(page, { ...QUIET_ENEMY, enemyLife: 2, playerBoard: [{ card: LOBSTER }], playerHand: [] });
    await act(page, () => { enterAttackPhase(); selectAttacker(gameState.playerBoard[0].id); });
    await act(page, () => confirmAttackers());
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => gameState.matchFinalized), true);
    assert.equal(await played(page, 'victory'), 1);
    assert.ok((await buzz(page)).some(p => JSON.stringify(p) === '[30,60,30,60,90]'));
    await page.evaluate(() => returnToMainMenu());

    await page.clock.runFor(3000);
    await startMatch(page);
    await spy(page);
    await setup(page, { ...QUIET_ENEMY, playerLife: 1 });
    await page.evaluate(() => changePlayerLife(-5));
    await page.clock.runFor(2000);
    assert.equal(await played(page, 'defeat'), 1);
    assert.ok((await buzz(page)).some(p => JSON.stringify(p) === '[60]'));
});

test('haptics are guarded: off, before a gesture, while hidden, with reduced motion, and on cooldown', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await spy(page);
    assert.equal(await page.evaluate(() => haptic('play')), false, 'not before a gesture');
    await gesture(page);
    assert.equal(await page.evaluate(() => haptic('play')), true);
    assert.equal(await page.evaluate(() => haptic('play')), false, 'cooldown');
    await page.clock.runFor(500);
    await page.evaluate(() => GameFeedback.setSetting('haptics', false));
    assert.equal(await page.evaluate(() => haptic('play')), false, 'switched off');
    await page.evaluate(() => GameFeedback.setSetting('haptics', true));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    assert.equal(await page.evaluate(() => haptic('impact')), false, 'hidden page');
    await page.evaluate(() => { delete document.hidden; });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(1000);
    await page.evaluate(() => { window.__buzz = []; haptic('victory'); });
    assert.deepEqual(await buzz(page), [12], 'reduced motion: one short pulse, not a pattern');
    const skipped = await page.evaluate(() => GameFeedback.stats().haptics.skipped);
    for (const key of ['play:no-gesture', 'play:cooldown', 'play:off', 'impact:hidden']) assert.ok(skipped[key] >= 1, key);
});

test('a browser without vibration: the switch says so, and a whole turn plays normally', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await page.evaluate(() => { delete Navigator.prototype.vibrate; delete navigator.vibrate; });
    await startMatch(page);
    await gesture(page);
    await setup(page, { ...QUIET_ENEMY, playerHand: [LOBSTER], playerBoard: [PEAK, PEAK] });
    await act(page, () => { tapLand(gameState.playerBoard[0].id); tapLand(gameState.playerBoard[1].id); });
    await act(page, () => playCard(gameState.playerHand[0].id));
    assert.equal(await page.evaluate(() => gameState.playerBoard.some(c => c.name === 'Fire Lobster')), true);
    await page.evaluate(() => pauseGame());
    const row = await page.evaluate(() => ({
        disabled: document.getElementById('pauseHapticsSwitch').disabled,
        checked: document.getElementById('pauseHapticsSwitch').getAttribute('aria-checked'),
        note: document.getElementById('pauseHapticsNote').textContent
    }));
    assert.deepEqual(row, { disabled: true, checked: 'false', note: 'Not available on this device' });
    assert.equal(await page.evaluate(() => haptic('impact')), false);
});

test('a browser without Web Audio: effects are skipped quietly and a turn still plays', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    await page.reload();
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    assert.equal(await page.evaluate(() => GameFeedback.state), 'unsupported');
    await startMatch(page);
    await gesture(page);
    await setup(page, { ...QUIET_ENEMY, playerHand: [LOBSTER], playerBoard: [PEAK, PEAK] });
    await act(page, () => { tapLand(gameState.playerBoard[0].id); tapLand(gameState.playerBoard[1].id); });
    await act(page, () => playCard(gameState.playerHand[0].id));
    await act(page, () => endTurn());
    await page.clock.runFor(12000);
    assert.equal(await page.evaluate(() => gameState.turn), 'player');
    assert.equal(await page.evaluate(() => GameFeedback.play('attack')), false);
});

test('audio suspended or interrupted (a call, a background tab): effects wait quietly and come back', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await gesture(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => GameFeedback.state === 'suspended', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => GameFeedback.play('attack')), false);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => GameFeedback.state === 'running', null, { timeout: 5000 });
    await page.clock.runFor(500);
    assert.equal(await page.evaluate(() => GameFeedback.play('attack')), true, 'back when the page returns');
});

test('the sound board (docs/sound-board.html) plays every cue and leaves the saved settings alone', { timeout: 60000 }, async t => {
    const page = await openGame(t);
    await page.evaluate(() => { localStorage.setItem('emojiElementsSfxVolume', '0.3'); localStorage.setItem('emojiElementsMuted', 'true'); });
    await page.goto(new URL('docs/sound-board.html', page.url()).href);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running', null, { timeout: 5000 });
    const buttons = await page.locator('#cues button').count();
    for (let i = 0; i < buttons; i++) {
        await page.locator('#cues button').nth(i).click();
        await page.clock.runFor(700);
        await page.waitForTimeout(400);                 // voices end on the real audio clock, which the fake clock doesn't move
    }
    const result = await page.evaluate(() => ({
        played: Object.values(GameFeedback.stats().played).reduce((a, b) => a + b, 0),
        dropped: GameFeedback.stats().dropped,
        saved: [localStorage.getItem('emojiElementsSfxVolume'), localStorage.getItem('emojiElementsMuted')]
    }));
    assert.equal(buttons, 27);
    assert.equal(result.played, 27, JSON.stringify(result.dropped));
    assert.deepEqual(result.saved, ['0.3', 'true'], 'the player\'s settings are unchanged');
});
