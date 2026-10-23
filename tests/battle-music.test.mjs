import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, startMatch } from './lib/game.mjs';

useGameBrowser();

test('battle score follows a life lead with a stable crossfade, and stops on quit', { timeout: 90000 }, async t => {
    const page = await openGame(t);
    await page.mouse.click(3, 3);
    await startMatch(page);
    await page.waitForFunction(() => !audioSystem.gameplayMusic.paused);
    const status = () => page.evaluate(() => ({
        key: battleMusicKey,
        pending: battleMusicPending,
        mood: document.getElementById('gameContainer').dataset.battleMood,
        playing: BATTLE_TRACKS.filter(key => !audioSystem[key].paused),
        offset: audioSystem[battleMusicKey].currentTime
    }));
    await page.evaluate(() => changeEnemyLife(-6));
    assert.equal((await status()).key, 'gameplayMusic');
    await page.evaluate(() => changeEnemyLife(-1));
    await page.waitForFunction(() => battleMusicKey === 'winningMusic');
    assert.equal((await status()).mood, 'winning');
    await page.clock.runFor(1900);
    assert.deepEqual((await status()).playing, ['winningMusic']);
    await page.evaluate(() => changeEnemyLife(3)); // lead four retains the winning variation
    assert.equal((await status()).key, 'winningMusic');
    await page.evaluate(() => changeEnemyLife(1)); // lead three returns to neutral
    await page.waitForFunction(() => battleMusicKey === 'gameplayMusic');
    await page.clock.runFor(1900);
    await page.evaluate(() => changePlayerLife(-10)); // now seven behind
    await page.waitForFunction(() => battleMusicKey === 'losingMusic');
    await page.clock.runFor(1900);
    assert.deepEqual((await status()).playing, ['losingMusic']);
    await page.evaluate(() => returnToMainMenu());
    assert.deepEqual((await status()).playing, []);
    assert.equal((await status()).mood, undefined);
});

test('menu theme carries into the board and credits show the requested caption', async t => {
    const page = await openGame(t);
    assert.deepEqual(await page.evaluate(() => ({
        text: document.querySelector('.intro-credit span').textContent.trim(),
        website: document.querySelector('.intro-credit a').textContent.trim()
    })), { text: 'MADE WITH LOVE by #teamInspire', website: 'www.inspireclothing.art' });
    await page.evaluate(() => applyVisualTheme('neon'));
    await startMatch(page);
    const board = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.getElementById('gameContainer')).backgroundImage,
        saved: localStorage.getItem('emoji_elements_theme')
    }));
    assert.equal(board.theme, 'neon');
    assert.equal(board.saved, 'neon');
    assert.match(board.background, /linear-gradient/);
});
