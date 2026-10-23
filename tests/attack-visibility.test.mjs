import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, startMatch, clickAt } from './lib/game.mjs';

useGameBrowser();

for (const [width, height] of [[360, 740], [320, 568], [390, 640], [360, 500]]) {
    test(`portrait ${width}×${height}: Attack stays above the hand and starts combat`, { timeout: 90000 }, async t => {
        const page = await openGame(t, { contextOptions: { viewport: { width, height }, isMobile: true, hasTouch: true } });
        await startMatch(page);
        await page.evaluate(() => {
            __rt.setup({ playerBoard: [{ card: 'creatures-fire-lion', summoningSick: false }], enemyBoard: [], playerHand: [] });
        });
        const bounds = await page.evaluate(() => {
            const attack = document.getElementById('attackBtn').getBoundingClientRect();
            const hand = document.getElementById('playerHand').getBoundingClientRect();
            const viewport = window.visualViewport;
            const x = attack.left + attack.width / 2, y = attack.top + attack.height / 2;
            return {
                attack: { top: attack.top, bottom: attack.bottom, height: attack.height },
                hand: { top: hand.top },
                viewportBottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight),
                hit: document.elementFromPoint(x, y)?.closest('#attackBtn')?.id
            };
        });
        assert.ok(bounds.attack.height >= 44, JSON.stringify(bounds));
        assert.ok(bounds.attack.bottom < bounds.hand.top, JSON.stringify(bounds));
        assert.ok(bounds.attack.bottom <= bounds.viewportBottom - 1, JSON.stringify(bounds));
        assert.equal(bounds.hit, 'attackBtn', JSON.stringify(bounds));
        await clickAt(page, '#attackBtn');
        assert.equal(await page.evaluate(() => attackPhase), true, 'visible button enters attack selection');
    });
}
