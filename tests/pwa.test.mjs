import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ROOT, loadPlaywright } from './lib/harness.mjs';
import { buildPwa } from '../scripts/build-pwa.mjs';

test('real PWA: offline startup, explicit two-build update, failed deployment and preserved progress', { timeout: 120000 }, async t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-pwa-'));
    const files = ['index.html', 'index.js', 'styles.css', 'feedback.js', 'achievements.js', 'pwa.js',
        'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
        'menu-sigil.svg', 'menu-divider.svg', 'audio/sfx/sfx-bank.wav',
        'minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3', 'inspiresoftwareintro.mp4', 'scripts/sw-template.js'];
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, file), path.join(folder, file));
    }
    const snapshots = [];
    const builds = [];
    for (const release of ['v1', 'v2', 'v3']) {
        fs.writeFileSync(path.join(folder, 'index.html'), fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
            .replace('<html ', `<html data-release="${release}" `));
        builds.push(buildPwa(folder));
        snapshots.push(new Map([...files, 'sw.js', 'pwa-build.js'].map(file => [file, fs.readFileSync(path.join(folder, file))])));
    }
    let current = 0;
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/sibling/') { res.end('<!doctype html><title>Sibling app</title>'); return; }
        const file = decodeURIComponent(url.pathname).replace(/^\/game\//, '') || 'index.html';
        let body = snapshots[current].get(file);
        if (current === 2 && file === 'styles.css') body = Buffer.from('/* broken partial deployment */');
        if (!body) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(folder, { recursive: true, force: true }); });
    browser = await loadPlaywright().chromium.launch();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/game/`);
    await page.evaluate(() => profileReady);
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; if (!reg.active) throw new Error('No active worker'); });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[0]);
    await page.locator('#pwaUpdateButton').tap();
    await page.waitForFunction(() => /up to date/.test(document.getElementById('pwaUpdateStatus').textContent));
    assert.equal(await page.locator('#clickToStart').evaluate(el => getComputedStyle(el).display !== 'none'), true,
        'update tap must not start the intro');
    await page.evaluate(async () => {
        gameMeta.wallet.credits = 321;
        metaSave(gameMeta);
        localStorage.setItem('emoji_elements_theme', 'deep-space');
        localStorage.setItem('emojiElementsSfxVolume', '0.35');
        await (await caches.open('another-inspire-game')).put('/sibling/data', new Response('keep me'));
    });
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1'));
    await context.setOffline(true);
    await page.reload();
    await page.evaluate(() => profileReady);
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[0], 'cached code starts offline');
    await page.locator('#pwaUpdateButton').tap();
    await page.waitForFunction(() => /Offline/.test(document.getElementById('pwaUpdateStatus').textContent));
    const ranges = await page.evaluate(async () => {
        return Promise.all(['minimalist menu theme.mp3', 'Emoji Elements - Celestial Battle Theme.mp3'].map(async file => {
            const res = await fetch(new URL(file, location.href), { headers: { Range: 'bytes=0-31' } });
            return { status: res.status, bytes: (await res.arrayBuffer()).byteLength };
        }));
    });
    assert.deepEqual(ranges, [{ status: 206, bytes: 32 }, { status: 206, bytes: 32 }],
        'both new tracks with URL-encoded spaces support offline ranges');
    await context.setOffline(false);
    // Keep a second running client on the old generation: updating this page must not reload it.
    const other = await context.newPage();
    await other.goto(`${origin}/game/`);
    await other.waitForFunction(() => !!navigator.serviceWorker.controller);
    const otherController = await other.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    let otherNavigations = 0;
    other.on('framenavigated', frame => { if (frame === other.mainFrame()) otherNavigations++; });
    current = 1;
    await page.locator('#pwaUpdateButton').tap();
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.waitForFunction(() => document.getElementById('pwaUpdateButton').textContent === 'Reload updated version');
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[0], 'no automatic reload');
    await page.locator('#pwaUpdateButton').tap();
    await page.waitForFunction(() => /Close other/.test(document.getElementById('pwaUpdateStatus').textContent));
    assert.equal(otherNavigations, 0, 'a second app window blocks activation without reloading it');
    assert.equal(await other.evaluate(() => window.EE_BUILD_ID), builds[0]);
    assert.equal(await other.evaluate(() => navigator.serviceWorker.controller.scriptURL), otherController);
    await other.close();
    let reloads = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++; });
    await Promise.all([page.waitForNavigation(), page.locator('#pwaUpdateButton').tap()]);
    await page.evaluate(() => profileReady);
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[1]);
    assert.equal(reloads, 1, 'explicit update reloads once');
    assert.equal(await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1')), saved);
    assert.equal(await page.evaluate(() => localStorage.getItem('emoji_elements_theme')), 'deep-space');
    assert.equal(await page.evaluate(() => localStorage.getItem('emojiElementsSfxVolume')), '0.35');
    assert.equal(await page.evaluate(() => caches.has('another-inspire-game')), true);
    current = 2;
    await page.locator('#pwaUpdateButton').tap();
    await page.waitForFunction(() => /failed|safe|incomplete/i.test(document.getElementById('pwaUpdateStatus').textContent));
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), false);
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[1]);
    await context.setOffline(true);
    await page.reload();
    await page.evaluate(() => profileReady);
    assert.equal(await page.evaluate(() => window.EE_BUILD_ID), builds[1], 'failed update preserves offline app');
    assert.equal(await page.evaluate(() => localStorage.getItem('emoji_elements_meta_v1')), saved);
    // Touch/layout checks on the initialization control itself in short landscape.
    await page.setViewportSize({ width: 863, height: 360 });
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.click-to-start-content')).opacity) > 0.99);
    assert.equal(await page.locator('#pwaUpdateButton').evaluate(el => {
        const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    }), true, 'startup updater is visible in short landscape');
    await fs.promises.mkdir(path.join(ROOT, 'test-results/pwa'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'test-results/pwa/startup-landscape.png') });
    await page.locator('.click-to-start-text').tap();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('clickToStart')).pointerEvents === 'none');
    await page.evaluate(() => document.getElementById('introVideo').dispatchEvent(new Event('ended')));
    await page.locator('#mainMenu button', { hasText: 'NEW GAME' }).first().tap();
    await page.locator('.deck-mode-btn[data-deck-mode="single"]').tap();
    await page.locator('.element-btn[data-element="fire"]').tap();
    await page.locator('#startBtn').tap();
    await page.waitForFunction(() => gameState.playerHand.length === 7 && gameState.playerLife === 20);
    assert.equal(await page.evaluate(() => GameFeedback.samplesReady()), true, 'recorded bank decodes from the offline cache');
    const offlineSample = await page.evaluate(() => {
        GameFeedback.play('spell');
        return { state: GameFeedback.sampleState, played: GameFeedback.stats().sampled.spell };
    });
    assert.equal(offlineSample.state, 'ready');
    assert.ok(offlineSample.played > 0, 'offline gameplay uses recorded SFX, not the synthesis fallback');
    assert.equal(await page.locator('#pwaUpdateButton').isVisible(), false, 'update action is not exposed during a match');
    assert.deepEqual(errors, []);
    await context.close();
});

test('generated offline assets match the committed source', () => { buildPwa(ROOT, true); });

test('manifest preserves the identity and launch URL of existing installs', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    assert.equal(manifest.start_url, './index.html');
    assert.equal(manifest.id, undefined, 'preserve the original start_url-derived identity across project paths');
    assert.equal(manifest.scope, './');
    assert.deepEqual(manifest.icons.slice(0, 2).map(icon => [icon.src, icon.sizes, icon.type, icon.purpose]), [
        ['icon-192.png', '192x192', 'image/png', 'any maskable'],
        ['icon-512.png', '512x512', 'image/png', 'any maskable']
    ]);
    for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
        const image = fs.readFileSync(path.join(ROOT, file));
        assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(image.readUInt32BE(16), size);
        assert.equal(image.readUInt32BE(20), size);
    }
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
});
