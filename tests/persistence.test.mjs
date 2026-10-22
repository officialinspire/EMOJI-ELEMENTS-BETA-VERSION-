import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { useGameBrowser, openGamePage, startMatch } from './lib/game.mjs';
useGameBrowser();
const META = 'emoji_elements_meta_v1', BACKUPS = 'emoji_elements_meta_backups';
const raw = page => page.evaluate(key => localStorage.getItem(key), META);
const memory = page => page.evaluate(() => JSON.parse(JSON.stringify(gameMeta)));
const reload = async page => { await page.reload(); await page.evaluate(() => profileReady); };
async function open(t, options) { const s = await openGamePage(options); t.after(s.close); return s.page; }

for (const text of ['', 'null', '[]', '{broken', fs.readFileSync(new URL('./fixtures/saves/wrong-types.json', import.meta.url), 'utf8')]) {
    test(`repair preserves exact original bytes: ${text.slice(0, 18) || 'empty string'}`, async t => {
        const page = await open(t, { storage: { [META]: text } });
        assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k))[0].raw, BACKUPS), text);
        const repaired = await raw(page);
        assert.equal(JSON.parse(repaired).initialized, true);
        assert.ok(!repaired.includes('Infinity'));
        assert.equal(Object.hasOwn(JSON.parse(repaired).collection,'constructor'),false);
        assert.equal(Object.hasOwn(JSON.parse(repaired).collection,'toString'),false);
        await reload(page); assert.equal(await raw(page), repaired, 'repair is stable across reload');
    });
}

test('a failed backup never overwrites the original; reload can safely retry repair', async t => {
    const page = await open(t, { storage: { [META]: '{broken' }, initScript: () => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k,v) { if (k === 'emoji_elements_meta_backups' && !sessionStorage.__backupFailed) { sessionStorage.__backupFailed='1'; throw new DOMException('quota', 'QuotaExceededError'); } return set.call(this,k,v); };
    } });
    assert.equal(await raw(page), '{broken');
    assert.equal(await page.evaluate(() => metaSave(gameMeta)), false);
    assert.equal(await raw(page), '{broken');
    assert.match(await page.locator('#persistenceNotice').textContent(), /unchanged|recovery/);
    await reload(page);
    assert.notEqual(await raw(page), '{broken');
    assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).at(-1).raw, BACKUPS), '{broken');
});

test('blocked reads at startup keep the application usable without claiming persistence', async t => {
    const page = await open(t, { initScript: () => {
        Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
        Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    } });
    assert.equal(await page.evaluate(() => profileWriteState), 'unavailable');
    const before = await memory(page);
    assert.equal((await page.evaluate(() => purchasePack('lands'))).ok, false);
    assert.deepEqual(await memory(page), before);
    await startMatch(page);
    await page.evaluate(() => { gameState.enemyLife = 0; checkGameOver(); });
    assert.equal(await page.evaluate(() => gameState.matchFinalized), true, 'storage failure does not break match completion');
    assert.match(await page.locator('#persistenceNotice').textContent(), /not be saved|unavailable|blocked/);
});

test('quota failures roll back purchases; retrying a reward save never reapplies its economy', async t => {
    const page = await open(t);
    const before = await raw(page), beforeMemory = await memory(page);
    await page.evaluate(() => {
        window.__setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    const purchase = await page.evaluate(() => purchasePack('lands'));
    assert.deepEqual([purchase.ok, purchase.reason], [false, 'save_failed']);
    assert.equal(await raw(page), before); assert.deepEqual(await memory(page), beforeMemory);
    assert.equal(await page.evaluate(() => packOpeningState.active), false);
    await startMatch(page);
    await page.evaluate(() => { gameState.enemyLife = 0; checkGameOver(); finalizeMatch('win'); });
    const pending = await memory(page);
    assert.equal(pending.wallet.credits, beforeMemory.wallet.credits + 25);
    assert.equal(pending.stats.wins, 1); assert.equal(pending.stats.packsOpened, 1);
    assert.equal(await raw(page), before, 'failed writes leave durable bytes unchanged');
    await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; saveStats(); saveStats(); finalizeMatch('win'); });
    const saved = await raw(page);
    assert.deepEqual(JSON.parse(saved), pending, 'retry persists the already awarded snapshot exactly once');
    await reload(page); assert.equal(await raw(page), saved);
});

test('confirmation buttons invoke their action once, including after closing', async t => {
    const page = await open(t);
    const count = await page.evaluate(() => {
        let n = 0; showConfirmModal('Confirm', 'Test repeated taps', () => n++);
        const yes = document.getElementById('gameConfirmYesBtn'); yes.click(); yes.click(); yes.click();
        return n;
    });
    assert.equal(count, 1);
});

test('reward and purchased packs survive early close and reload without another acquisition', async t => {
    const page = await open(t);
    await startMatch(page);
    await page.evaluate(() => { gameState.enemyLife = 0; checkGameOver(); finalizeMatch('win'); });
    const reward = await raw(page);
    await page.evaluate(() => { openPackOpeningOverlayFromMeta('win'); closePackOpeningOverlay(); closePackOpeningOverlay(); });
    assert.equal(await raw(page), reward);
    await reload(page); assert.equal(await raw(page), reward);
    const result = await page.evaluate(() => { const a = purchasePack('lands'); const b = purchasePack('lands'); closePackOpeningOverlay(); return [a.ok,b.ok]; });
    assert.deepEqual(result, [true,false]);
    const bought = await raw(page); await reload(page); assert.equal(await raw(page), bought);
    await page.evaluate(() => { openPackOpeningOverlayFromMeta('shop'); closePackOpeningOverlay(); });
    assert.equal(await raw(page), bought);
});

test('two real tabs cannot race purchases, reset or overwrite a newer profile', async t => {
    const owner = await open(t);
    const other = await owner.context().newPage();
    await other.goto(owner.url()); await other.evaluate(() => profileReady);
    assert.equal(await owner.evaluate(() => profileWriteState), 'writer');
    assert.equal(await other.evaluate(() => profileWriteState), 'reader');
    const results = await Promise.all([owner.evaluate(() => purchasePack('lands')), other.evaluate(() => purchasePack('lands'))]);
    assert.deepEqual(results.map(r => r.ok), [true,false]);
    const purchased = await raw(owner);
    await other.evaluate(() => {
        gameMeta.wallet.credits = 99999; gameStats.wins = 99999; metaSave(gameMeta); saveStats();
        resetMetaProgress(); document.getElementById('gameConfirmYesBtn').click();
    });
    assert.equal(await raw(owner), purchased, 'stale tab changes and confirmations cannot write');
    await owner.close(); await reload(other);
    assert.equal(await other.evaluate(() => profileWriteState), 'writer');
    assert.equal(await raw(other), purchased, 'new owner reloads the latest profile, not its stale snapshot');
    await other.evaluate(() => purchasePack('lands'));
    assert.equal(JSON.parse(await raw(other)).wallet.credits, JSON.parse(purchased).wallet.credits - 40);
});

test('external profile changes are rejected even by the current writer', async t => {
    const page = await open(t);
    const external = await page.evaluate(k => { const p=JSON.parse(localStorage.getItem(k)); p.wallet.credits=777; const r=JSON.stringify(p); localStorage.setItem(k,r); return r; }, META);
    assert.equal((await page.evaluate(() => purchasePack('lands'))).ok, false);
    assert.equal(await raw(page), external);
});

test('preferences and edited deck lists survive a migration and both reset operations', async t => {
    const previous = fs.readFileSync(new URL('./fixtures/saves/existing.json', import.meta.url), 'utf8');
    const page = await open(t, { storage: { [META]: previous, emojiElementsMuted: 'true', emojiElementsHaptics: 'false', emojiElementsMusicVolume: '0.23', emojiElementsSfxVolume: '0.41', emoji_elements_theme: 'neon' } });
    const migrated = await raw(page);
    const prefs = await page.evaluate(() => ({ sound: {...soundSettings}, theme: getVisualTheme() }));
    assert.equal(prefs.theme, 'neon');
    assert.equal(prefs.sound.muted, true); assert.equal(prefs.sound.haptics, false);
    assert.equal(prefs.sound.musicVolume, 0.23); assert.equal(prefs.sound.sfxVolume, 0.41);
    await reload(page); assert.equal(await raw(page), migrated);
    await page.evaluate(() => { resetStats(); document.getElementById('gameConfirmYesBtn').click(); });
    const resetStatsMeta = await memory(page);
    assert.deepEqual(resetStatsMeta.decks, JSON.parse(migrated).decks);
    assert.deepEqual(resetStatsMeta.collection, JSON.parse(migrated).collection);
    await page.evaluate(() => { resetMetaProgress(); const yes=document.getElementById('gameConfirmYesBtn'); yes.click(); yes.click(); });
    await reload(page);
    assert.deepEqual(await page.evaluate(() => ({ sound: {...soundSettings}, theme: getVisualTheme() })), prefs);
    assert.equal((await memory(page)).wallet.credits,100);
    assert.deepEqual((await memory(page)).stats,{wins:0,losses:0,packsOpened:0});
});

test('browsers without Web Locks keep the original profile read-only', async t => {
    const original=fs.readFileSync(new URL('./fixtures/saves/existing.json',import.meta.url),'utf8');
    const page=await open(t,{storage:{[META]:original},initScript:()=>Object.defineProperty(navigator,'locks',{value:undefined})});
    assert.equal(await page.evaluate(()=>profileWriteState),'unsupported');
    assert.equal((await page.evaluate(()=>purchasePack('lands'))).ok,false);
    assert.equal(await raw(page),original);
});
