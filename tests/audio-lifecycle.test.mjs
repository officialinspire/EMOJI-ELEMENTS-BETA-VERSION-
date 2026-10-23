import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, openGamePage } from './lib/game.mjs';
import { installAudioProbe } from './lib/audio-probe.mjs';

useGameBrowser();
test('stopping music cancels its old fade before a later session changes volume', async t => {
    const { page, close } = await openGamePage(); t.after(close);
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    await page.evaluate(() => {
        const music = audioSystem.gameplayMusic;
        GameFeedback.setMusicLevel(music, 0.2);
        fadeAudio(music, 0.8, 1000);
        if (!activeAudioFades.has(music)) throw Error('fade was not scheduled');
        stopSFX('gameplayMusic');
        if (activeAudioFades.has(music)) throw Error('old fade still owned');
        GameFeedback.setMusicLevel(music, 0.33);
    });
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => GameFeedback.getMusicLevel(audioSystem.gameplayMusic)), 0.33);
});

test('priority eviction caps actual connected cues; stopAll destroys future notes before gain recovery', async t => {
    const { page, close } = await openGamePage({ initScript: installAudioProbe });
    t.after(close);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    await page.evaluate(() => GameFeedback.samplesReady());
    const result = await page.evaluate(() => {
        GameFeedback.stopAll();
        const samples = [];
        // One JS task: the audio clock cannot naturally finish these long cues between calls.
        for (const cue of GameFeedback.cues) {
            __audioProbe.begin(); GameFeedback.play(cue);
            samples.push({ cue, ...__audioProbe.snapshot(), reported: GameFeedback.stats().voices });
        }
        GameFeedback.stopAll();
        const stopped = __audioProbe.snapshot();
        GameFeedback.setSetting('sfxOff', true);
        GameFeedback.setSetting('sfxOff', false);
        GameFeedback.setSetting('sfxVolume', 1);
        return { samples, stopped, recovered: __audioProbe.snapshot() };
    });
    assert.ok(result.samples.some(r => r.liveCues === 8), 'exercise the full voice budget');
    for (const sample of result.samples) assert.ok(sample.liveCues <= 8, JSON.stringify(sample));
    assert.equal(result.stopped.liveSources, 0, 'all scheduled notes disconnected, including future notes');
    assert.equal(result.stopped.connected, 6, 'only the persistent effects/music buses remain');
    assert.ok(result.stopped.stopped > 8, 'measured physical source stop calls');
    assert.equal(result.recovered.liveSources, 0, 'gain recovery cannot reconnect old sources');
    // Real audio time, independent of Playwright's deterministic gameplay clock.
    await page.waitForTimeout(1700);
    const settled = await page.evaluate(() => __audioProbe.snapshot());
    assert.equal(settled.liveSources, 0);
    assert.equal(settled.connected, 6);
});

test('naturally completed effects release their processing nodes', async t => {
    const { page, close } = await openGamePage({ initScript: installAudioProbe });
    t.after(close);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    await page.evaluate(() => GameFeedback.samplesReady());
    await page.evaluate(() => { GameFeedback.stopAll(); __audioProbe.begin(); GameFeedback.play('victory'); });
    await page.waitForTimeout(2000);
    const result = await page.evaluate(() => __audioProbe.snapshot());
    assert.equal(result.liveSources, 0);
    assert.equal(result.connected, 6);
    assert.ok(result.ended > 0);
});

// Observe the real streaming graph rather than relying on the game's volume bookkeeping.
function installMusicProbe() {
    const sources = [];
    const original = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (media) {
        const source = original.call(this, media);
        const connect = source.connect.bind(source);
        const row = { media, source, gain: null, duck: null };
        source.connect = target => {
            row.gain = target;
            const next = target.connect.bind(target);
            target.connect = destination => { row.duck = destination; return next(destination); };
            return connect(target);
        };
        sources.push(row);
        return source;
    };
    window.__musicProbe = () => sources.map(row => ({
        file: decodeURIComponent(new URL(row.media.src).pathname.split('/').pop()),
        volume: row.media.volume, gain: row.gain.gain.value, duck: row.duck.gain.value,
        time: row.media.currentTime, paused: row.media.paused
    }));
}

test('new streaming tracks stay silent through initialization and intro; effects duck only music', async t => {
    const page = await openGame(t, { initScript: installMusicProbe });
    assert.deepEqual(await page.evaluate(() => ({ state: GameFeedback.state, sources: __musicProbe().length,
        paused: Object.values(audioSystem).every(audio => audio.paused), music: soundSettings.musicVolume, effects: soundSettings.sfxVolume })),
        { state: 'locked', sources: 0, paused: true, music: 0.3, effects: 0.7 });
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'flex'; });
    await page.locator('#clickToStart').dispatchEvent('click');
    // Synthetic startup alone must not create Web Audio: the real gesture owns the unlock.
    assert.equal(await page.evaluate(() => GameFeedback.state), 'locked');
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    assert.equal(await page.evaluate(() => Object.values(audioSystem).every(audio => audio.paused)), true,
        'music cannot play over the credits');
    await page.evaluate(() => document.getElementById('introVideo').dispatchEvent(new Event('ended')));
    await page.clock.runFor(1200);
    await page.waitForFunction(() => !audioSystem.startMenuMusic.paused &&
        Object.values(audioSystem).every(audio => audio.readyState >= 2 && audio.duration > 170));
    const tracks = await page.evaluate(() => __musicProbe());
    assert.deepEqual(tracks.map(track => track.file), ['minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3']);
    assert.equal(tracks[0].volume, 1, 'gain owns volume, including on browsers ignoring media.volume');
    assert.ok(Math.abs(tracks[0].gain - 0.135) < 0.001, JSON.stringify(tracks));
    await page.evaluate(() => { GameFeedback.unlock(); GameFeedback.unlock(); GameFeedback.play('attack'); });
    await page.waitForTimeout(80);
    const ducked = await page.evaluate(() => __musicProbe());
    assert.equal(ducked.length, 2, 'repeated gestures cannot reroute or duplicate tracks');
    assert.ok(ducked[0].duck < 0.6, 'effects have foreground headroom');
    await page.waitForTimeout(1500);
    assert.ok((await page.evaluate(() => __musicProbe()))[0].duck > 0.95, 'music recovers gently');
    assert.equal(await page.evaluate(() => document.getElementById('introVideo').paused), true);
});

test('settings during fades, rapid menu returns and backgrounding preserve the current audio session', async t => {
    const page = await openGame(t);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    await page.evaluate(() => ensureStartMenuMusic());
    await page.clock.runFor(100);
    await page.evaluate(() => GameFeedback.setSetting('musicVolume', 0));
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => GameFeedback.getMusicLevel(audioSystem.startMenuMusic)), 0,
        'a fade cannot restore an obsolete slider level');
    await page.evaluate(() => {
        GameFeedback.setSetting('musicVolume', 0.4);
        transitionToGameplayMusic();
        ensureStartMenuMusic(); // cancel the old fade-out callback before it can stop this menu session
    });
    await page.clock.runFor(1200);
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.paused), false);
    assert.equal(await page.evaluate(() => audioSystem.gameplayMusic.paused), true);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.paused), true);
    const time = await page.evaluate(() => audioSystem.startMenuMusic.currentTime);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !audioSystem.startMenuMusic.paused);
    assert.ok(Math.abs(await page.evaluate(() => audioSystem.startMenuMusic.currentTime) - time) < 0.5,
        'returning to the page resumes rather than restarting the track');
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        stopSFX('startMenuMusic');
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => Object.values(audioSystem).every(audio => audio.paused)), true,
        'a stopped session must never be resurrected on foreground');
});

test('saved master mute includes credits; unsupported streaming routing keeps music controls and gameplay usable', async t => {
    const page = await openGame(t, { storage: { emojiElementsMuted: 'true', emojiElementsMusicVolume: '0.8' },
        initScript: () => { AudioContext.prototype.createMediaElementSource = () => { throw new Error('Routing unavailable'); }; } });
    assert.equal(await page.evaluate(() => document.getElementById('introVideo').muted), true);
    assert.equal(await page.evaluate(() => soundSettings.musicVolume), 0.8, 'retain an existing volume preference');
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    await page.evaluate(() => ensureStartMenuMusic());
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.muted), true);
    assert.ok(Math.abs(await page.evaluate(() => audioSystem.startMenuMusic.volume) - 0.36) < 0.001,
        'unsupported media routing retains the ordinary volume fallback');
    await page.evaluate(() => { GameFeedback.setSetting('muted', false); GameFeedback.setSetting('musicOff', true); });
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.muted), true);
    assert.equal(await page.evaluate(() => GameFeedback.play('attack')), true, 'routing failure must not break effects');
    await page.evaluate(() => GameFeedback.setSetting('musicOff', false));
    assert.equal(await page.evaluate(() => audioSystem.startMenuMusic.muted), false);
});

test('streaming gains wait for decoder readiness instead of rerouting an unfinished media pipeline', async t => {
    const page = await openGame(t);
    // Hold the readiness signal while observing the actual createMediaElementSource calls.
    await page.evaluate(installMusicProbe);
    await page.evaluate(() => {
        window.__holdMusicDecoder = true;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true,
            get() { return this instanceof HTMLAudioElement && window.__holdMusicDecoder ? 0 : descriptor.get.call(this); } });
    });
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    assert.equal(await page.evaluate(() => __musicProbe().length), 0, 'no unfinished decoder is rerouted');
    await page.evaluate(() => {
        window.__holdMusicDecoder = false;
        Object.values(audioSystem).forEach(audio => audio.dispatchEvent(new Event('loadeddata')));
    });
    await page.waitForFunction(() => __musicProbe().length === 2);
    await page.evaluate(() => GameFeedback.unlock());
    assert.equal(await page.evaluate(() => __musicProbe().length), 2, 'each decoded stream is connected once');
});

test('a refused context resume keeps the HTML music fallback rather than routing into silence', async t => {
    const page = await openGame(t, { initScript: () => {
        const NativeAudioContext = window.AudioContext;
        window.AudioContext = class extends NativeAudioContext {
            get state() { return 'suspended'; }
            resume() { return Promise.reject(new Error('Resume refused')); }
            createMediaElementSource() { throw new Error('Must not route a suspended context'); }
        };
    } });
    await page.mouse.click(3, 3);
    await page.evaluate(() => ensureStartMenuMusic());
    await page.clock.runFor(1200);
    const music = await page.evaluate(() => ({ state: GameFeedback.state, paused: audioSystem.startMenuMusic.paused,
        level: GameFeedback.getMusicLevel(audioSystem.startMenuMusic), volume: audioSystem.startMenuMusic.volume }));
    assert.equal(music.state, 'suspended');
    assert.equal(music.paused, false);
    assert.ok(Math.abs(music.level - 0.135) < 0.001);
    assert.ok(Math.abs(music.volume - music.level) < 0.001, 'ordinary media retains volume ownership');
});
