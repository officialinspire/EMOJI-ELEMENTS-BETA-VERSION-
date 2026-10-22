import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGamePage } from './lib/game.mjs';
import { installAudioProbe } from './lib/audio-probe.mjs';

useGameBrowser();
test('stopping music cancels its old fade before a later session changes volume', async t => {
    const { page, close } = await openGamePage(); t.after(close);
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    await page.evaluate(() => {
        const music = audioSystem.gameplayMusic;
        music.volume = 0.2;
        fadeAudio(music, 0.8, 1000);
        if (!activeAudioFades.has(music)) throw Error('fade was not scheduled');
        stopSFX('gameplayMusic');
        if (activeAudioFades.has(music)) throw Error('old fade still owned');
        music.volume = 0.33;
    });
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => audioSystem.gameplayMusic.volume), 0.33);
});

test('priority eviction caps actual connected cues; stopAll destroys future notes before gain recovery', async t => {
    const { page, close } = await openGamePage({ initScript: installAudioProbe });
    t.after(close);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
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
    assert.equal(result.stopped.connected, 3, 'only the persistent bus remains');
    assert.ok(result.stopped.stopped > 8, 'measured physical source stop calls');
    assert.equal(result.recovered.liveSources, 0, 'gain recovery cannot reconnect old sources');
    // Real audio time, independent of Playwright's deterministic gameplay clock.
    await page.waitForTimeout(1700);
    const settled = await page.evaluate(() => __audioProbe.snapshot());
    assert.equal(settled.liveSources, 0);
    assert.equal(settled.connected, 3);
});

test('naturally completed effects release their processing nodes', async t => {
    const { page, close } = await openGamePage({ initScript: installAudioProbe });
    t.after(close);
    await page.mouse.click(3, 3);
    await page.waitForFunction(() => GameFeedback.state === 'running');
    await page.evaluate(() => { GameFeedback.stopAll(); __audioProbe.begin(); GameFeedback.play('victory'); });
    await page.waitForTimeout(2000);
    const result = await page.evaluate(() => __audioProbe.snapshot());
    assert.equal(result.liveSources, 0);
    assert.equal(result.connected, 3);
    assert.ok(result.ended > 0);
});
