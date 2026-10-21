// Pack controls must stay visible without scrolling the panel, including short/zoomed viewports.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/harness.mjs';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, clickAt } from './lib/game.mjs';
useGameBrowser();

test('pack reveal and summary retain reachable controls across orientation and zoom', async t => {
    const out = path.join(ROOT, 'test-results', 'stabilization');
    fs.mkdirSync(out, { recursive: true });
    const page = await openGame(t, { contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
    await page.setViewportSize({ width: 568, height: 320 });
    await page.evaluate(() => {
        const modal = document.getElementById('startModal');
        modal.style.display = 'flex';
        modal.classList.add('modal-visible');
        showPackShop();
        purchasePack('fantasy');
    });
    await page.clock.runFor(300);
    await clickAt(page, '#packOpenBtn');
    await page.clock.runFor(1000);
    const visible = async ids => {
        const result = await page.evaluate(ids => ids.map(id => {
            const el = document.getElementById(id), r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { id, fits: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
                reachable: hit === el || el.contains(hit) };
        }), ids);
        for (const r of result) assert.ok(r.fits && r.reachable, `${r.id}: ${JSON.stringify(r)}`);
    };
    for (const [width, height, zoom] of [[568,320,1], [844,390,1], [667,375,1], [390,844,1], [844,390,1], [844,390,2]]) {
        // A 200% layout zoom halves the available CSS viewport. CSS zoom would leave dvh unchanged.
        await page.setViewportSize({ width: width / zoom, height: height / zoom });
        await page.clock.runFor(100);
        await visible(['packCloseBtn', 'packPrevBtn', 'packNextBtn', 'packSummaryBtn']);
        const cardHeight = await page.locator('#packCardViewport').evaluate(el => el.clientHeight);
        assert.ok(cardHeight >= 44, `readable card area at ${width / zoom}×${height / zoom}: ${cardHeight}px`);
        for (let i = 0; i < 4; i++) {
            await page.evaluate(() => revealCurrentPackCard());
            await page.locator('#packCardOwned').evaluate(el => el.scrollIntoView({ block: 'nearest' }));
            await visible(['packPrevBtn', 'packNextBtn', 'packSummaryBtn']);
            await clickAt(page, '#packNextBtn');
            await page.clock.runFor(300);
            assert.equal(await page.locator('#packCardViewport').evaluate(el => el.scrollTop), 0, 'each card starts at the top');
            await visible(['packPrevBtn', 'packNextBtn', 'packSummaryBtn']);
        }
        await page.evaluate(() => revealCurrentPackCard());
        await page.clock.runFor(300);
        await page.screenshot({ path: path.join(out, `${width}-${height}-${zoom}-reveal.png`) });
        assert.equal(await page.evaluate(() => packOpeningState.currentIndex), 4);
        await clickAt(page, '#packPrevBtn');
        await page.clock.runFor(300);
        assert.equal(await page.evaluate(() => packOpeningState.currentIndex), 3);
        await clickAt(page, '#packSummaryBtn');
        await page.clock.runFor(300);
        await visible(['packCloseBtn', 'packSummaryBackBtn', 'packDoneBtn']);
        await page.screenshot({ path: path.join(out, `${width}-${height}-${zoom}-summary.png`) });
        assert.equal(await page.locator('#packSummaryGrid .pack-summary-card').count(), 5);
        await page.locator('#packSummaryGrid .pack-summary-card').last().evaluate(el => el.scrollIntoView({ block: 'nearest' }));
        await visible(['packSummaryBackBtn', 'packDoneBtn']);
        await clickAt(page, '#packSummaryBackBtn');
        await page.clock.runFor(300);
        await page.evaluate(() => setPackOpeningCard(0));
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
    assert.equal(await page.evaluate(() => visualViewport.scale), 1.5, 'pinch scale is applied');
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await visible(['packPrevBtn', 'packNextBtn', 'packSummaryBtn']);
    assert.match(await page.locator('#packCardViewport').evaluate(el => getComputedStyle(el).touchAction), /pinch-zoom/);
});
