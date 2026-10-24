import assert from 'node:assert/strict';
export const click = (page, selector) => page.locator(selector).first().click({ timeout: 10000 });
export async function boot(page) {
    await click(page, '#clickToStart');
    await page.waitForFunction(() => document.querySelector('#introContainer').style.display === 'flex' || document.querySelector('#startModal').classList.contains('modal-visible'));
    if (await page.locator('#introContainer').isVisible()) await page.locator('#introContainer').click({ position: { x: 15, y: 15 } });
    await page.waitForFunction(() => document.querySelector('#startModal').classList.contains('modal-visible'));
    await page.evaluate(() => profileReady);
}
export async function themes(page, shot = async () => {}) {
    await click(page, '#themeChip');
    const keys = await page.locator('[data-ui-theme]').evaluateAll(nodes => nodes.map(n => n.dataset.uiTheme));
    assert.equal(keys.length, 3);
    for (const key of keys) {
        await click(page, `[data-ui-theme="${key}"]`);
        assert.equal(await page.locator('html').getAttribute('data-theme'), key);
        await shot(`theme-${key}`);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#themeDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'themeChip');
}
export async function start(page) {
    await click(page, '#mainMenu button[data-menu-target="elementSelectionScreen"]');
    await click(page, '.deck-mode-btn[data-deck-mode="single"]');
    await click(page, '.element-btn[data-element="fire"]');
    await click(page, '#startBtn');
    await ready(page);
}
export const ready = page => page.waitForFunction(() => gameState.turn === 'player' && gameState.phase === 'main' && !isProcessingAction, null, { timeout: 30000 });
export async function quit(page) {
    await click(page, '.menu-icon-btn');
    await page.locator('#pauseModal .menu-btn').filter({ hasText: 'MAIN MENU' }).click();
    await click(page, '#gameConfirmYesBtn');
    await page.waitForFunction(() => document.querySelector('#startModal').classList.contains('modal-visible'));
}
export async function purchase(page, theme = 'fantasy', cost = 60) {
    await click(page, '#mainMenu button[data-menu-target="packShopScreen"]');
    const before = await page.evaluate(() => gameMeta.wallet.credits);
    await page.evaluate(theme => { setShopTab('packs'); shopPage = PACK_THEMES.findIndex(p => p.key === theme); renderShopPage(); }, theme);
    await click(page, `.shop-pack-btn[data-theme="${theme}"]`);
    await page.waitForFunction(() => document.querySelector('#packOpeningOverlay').classList.contains('show'));
    assert.equal(await page.evaluate(() => gameMeta.wallet.credits), before - cost);
    await click(page, '#packOpenBtn');
    await page.waitForFunction(() => document.querySelector('#packRevealStage').classList.contains('pack-stage-active'));
    for (let i = 0; i < 4; i++) await click(page, '#packNextBtn');
    await click(page, '#packPrevBtn');
    await click(page, '#packSummaryBtn');
    assert.equal(await page.locator('#packSummaryGrid .pack-summary-card').count(), 5);
}
export async function backFromPack(page) {
    await click(page, '#packCloseBtn');
    await page.locator('#packShopScreen .menu-back').click();
}
