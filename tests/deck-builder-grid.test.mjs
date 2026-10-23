import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame } from './lib/game.mjs';

useGameBrowser();

for (const [label, viewport] of [
    ['portrait', { width: 360, height: 740 }],
    ['compact', { width: 320, height: 568 }],
    ['landscape', { width: 740, height: 360 }]
]) {
    test(`mobile ${label}: tabs, stacked copies and page controls fit without scrolling`, { timeout: 90000 }, async t => {
        const page = await openGame(t, { contextOptions: { viewport, isMobile: true, hasTouch: true } });
        await page.evaluate(() => {
            const modal = document.getElementById('startModal');
            modal.style.display = 'flex';
            modal.classList.add('modal-visible');
            showDeckBuilder();
        });
        const layout = () => page.evaluate(() => {
            const modal = document.querySelector('#startModal .modal-content');
            const panel = document.querySelector('#deckBuilderScreen [role="tabpanel"]:not([hidden])');
            const list = panel.querySelector('.deck-builder-list');
            const footer = document.querySelector('#deckBuilderScreen .deck-builder-footer').getBoundingClientRect();
            return {
                modalScroll: modal.scrollHeight - modal.clientHeight,
                listScroll: list?.scrollHeight - list?.clientHeight,
                footerVisible: footer.bottom <= innerHeight + 1,
                shown: [...list?.children || []].filter(row => !row.hidden).length,
                page: panel.querySelector('.deck-page-controls span')?.textContent,
                panel: panel.id
            };
        });
        assert.equal((await layout()).panel, 'deckPanelInventory');
        assert.ok((await layout()).shown <= (label === 'landscape' ? 4 : 6));
        assert.ok((await layout()).page?.includes('/'));
        await page.locator('#deckPoolPager button:last-child').tap();
        assert.match((await layout()).page, /Page 2/);
        if (label === 'portrait') {
            await page.locator('#deckBuilderFilters .card-filter-summary').tap();
            await page.locator('#deckBuilderFilters [data-filter="type"]').selectOption('land');
            assert.match((await layout()).page, /Page 1/);
            assert.ok(await page.locator('#deckBuilderPool .deck-builder-row:not([hidden])').count() > 0);
            await page.locator('#deckBuilderFilters .card-filter-summary').tap();
            await page.evaluate(() => resetCardFilters('deckBuilderFilters'));
        }
        await page.locator('#deckTabDeck').tap();
        assert.equal((await layout()).panel, 'deckPanelDeck');
        const first = page.locator('#deckBuilderDeck .deck-builder-row:not([hidden])').first();
        const cardId = await first.getAttribute('data-card-id');
        const before = await page.evaluate(id => deckBuilderState.workingCardIds.filter(value => value === id).length, cardId);
        assert.ok(before > 0);
        await first.locator('.deck-builder-remove').tap();
        assert.equal(await page.evaluate(id => deckBuilderState.workingCardIds.filter(value => value === id).length, cardId), before - 1);
        await page.locator('#deckTabOverview').tap();
        assert.equal((await layout()).panel, 'deckPanelOverview');
        assert.match(await page.textContent('#deckBuilderStatus'), /59\/60/);
        for (const tab of ['#deckTabInventory', '#deckTabDeck', '#deckTabOverview']) {
            await page.locator(tab).tap();
            const state = await layout();
            assert.ok(state.modalScroll <= 1, `${tab} modal overflow ${JSON.stringify(state)}`);
            assert.ok(!state.listScroll || state.listScroll <= 1, `${tab} grid overflow ${JSON.stringify(state)}`);
            assert.ok(state.footerVisible, `${tab} footer offscreen ${JSON.stringify(state)}`);
        }
        if (label === 'portrait') {
            const name = await page.evaluate(id => __CARD_BY_ID[id].name, cardId);
            await page.locator('#deckTabInventory').tap();
            await page.locator('#deckBuilderFilters .card-filter-search').fill(name);
            await page.locator(`#deckBuilderPool .deck-builder-row[data-card-id="${cardId}"] .deck-builder-add`).tap();
            assert.equal(await page.evaluate(id => deckBuilderState.workingCardIds.filter(value => value === id).length, cardId), before);
            const saveButton = page.locator('button[onclick="saveDeckBuilderDeck()"]');
            await saveButton.tap();
            assert.equal(await page.evaluate(id => gameMeta.decks.FIRE.cardIds.filter(value => value === id).length, cardId), before);
            assert.equal(await page.evaluate(() => isDeckBuilderDirty()), false);
            await page.setViewportSize({ width: 740, height: 360 });
            await page.locator('#deckTabInventory').tap();
            assert.ok((await layout()).shown <= 4, 'rotation repaginates the grid');
            assert.ok((await layout()).footerVisible, 'rotation keeps Save and Menu visible');
        }
    });
}
