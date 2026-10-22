#!/usr/bin/env node
// Release playthroughs for EMOJI ELEMENTS: the shipped page, played through its real UI (clicks and taps),
// on desktop and mobile, from a fresh profile and from an existing save. Real time (no fake clock), so the
// AI turns, animations and timers run as a player sees them. A long-match performance run follows.
//
//   node tests/release.mjs                       # both profiles (npm run release)
//   node tests/release.mjs --project=mobile
//
// Watched throughout: page errors, console errors/warnings, [QA] output (must be absent in production),
// failed or 4xx/5xx requests, and duplicate actions. Results: test-results/release/release.json + screenshots.
// Exit 1 on any failed check.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const OUT = path.join(ROOT, 'test-results', 'release');
const { chromium, devices } = loadPlaywright();
const PROJECTS = {
    desktop: { touch: false, options: { viewport: { width: 1366, height: 768 } } },
    mobile: { touch: true, options: { ...devices['Pixel 7'] } }
};
const DECKS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT', 'FIRE_WATER', 'FIRE_EARTH', 'FIRE_SWAMP', 'FIRE_LIGHT',
    'WATER_EARTH', 'WATER_SWAMP', 'WATER_LIGHT', 'EARTH_SWAMP', 'EARTH_LIGHT', 'SWAMP_LIGHT'];
const EXISTING_SAVE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/saves/existing.json'), 'utf8');

const results = [];
function check(project, area, label, ok, detail = '') {
    results.push({ project, area, label, ok: !!ok, detail: ok ? '' : String(detail) });
    console.log(`  ${ok ? '✅' : '❌'} [${area}] ${label}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}
const evidence = {};

// ------------------------------------------------------------------ helpers

function watch(page, sink) {
    page.on('pageerror', e => sink.errors.push(`pageerror: ${e.message}`));
    page.on('console', m => {
        const text = m.text();
        if (m.type() === 'error') sink.errors.push(`console.error: ${text}`);
        if (m.type() === 'warning') sink.warnings.push(text);
        if (/\[QA/.test(text)) sink.qaLogs.push(text);
    });
    page.on('requestfailed', r => sink.failedRequests.push(`${r.failure()?.errorText || 'failed'} ${r.url()}`));
    page.on('response', r => { if (r.status() >= 400) sink.failedRequests.push(`${r.status()} ${r.url()}`); });
    page.on('dialog', d => { sink.dialogs.push(d.message()); d.accept(); });
}

const press = (page, touch, target, options = {}) => {
    const locator = typeof target === 'string' ? page.locator(target).first() : target;
    return touch ? locator.tap(options) : locator.click(options);
};
// Two real inputs at the original hit point, even if the first one opens an overlay.
// Re-resolving a now-hidden locator waits for a timeout and does not produce a duplicate input.
async function doublePress(page, touch, selector) {
    const locator = typeof selector === 'string' ? page.locator(selector).first() : selector;
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (touch) { await page.touchscreen.tap(x, y); await page.touchscreen.tap(x, y); }
    else await page.mouse.dblclick(x, y, { delay: 40 });
}
const menuButton = (page, text) => page.locator('#mainMenu button', { hasText: text }).first();
const visible = (page, selector) => page.locator(selector).first().isVisible();
const state = page => page.evaluate(() => ({
    turn: gameState.turn, finalized: gameState.matchFinalized, life: [gameState.playerLife, gameState.enemyLife],
    hand: gameState.playerHand.length, board: gameState.playerBoard.length, lands: gameState.playerBoard.filter(c => c.type === 'land').length,
    credits: gameMeta?.wallet?.credits, wins: gameMeta?.stats?.wins, losses: gameMeta?.stats?.losses,
    packsOpened: gameMeta?.stats?.packsOpened, collection: Object.values(gameMeta?.collection || {}).reduce((s, n) => s + n, 0)
}));

async function boot(page, touch) {
    await press(page, touch, '#clickToStart');
    await page.waitForFunction(() =>
        document.getElementById('introContainer').style.display === 'flex' ||
        document.getElementById('startModal').classList.contains('modal-visible'));
    if (await page.evaluate(() => document.getElementById('introContainer').style.display === 'flex')) {
        await press(page, touch, '#introContainer', { position: { x: 15, y: 15 } });
    }
    await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

const playerTurnReady = page => page.waitForFunction(() =>
    gameState.matchFinalized || (gameState.turn === 'player' && gameState.phase === 'main' && !isProcessingAction), null, { timeout: 30000 });

async function startDeck(page, touch, deckKey) {
    const colors = deckKey.toLowerCase().split('_');
    await press(page, touch, menuButton(page, 'NEW GAME'));
    await press(page, touch, `.deck-mode-btn[data-deck-mode="${colors.length === 1 ? 'single' : 'dual'}"]`);
    for (const c of colors) await press(page, touch, `.element-btn[data-element="${c}"]`);
    await press(page, touch, '#startBtn');
    await page.waitForFunction(() => document.getElementById('gameContainer').style.display === 'flex', null, { timeout: 10000 });
    await playerTurnReady(page);
}

async function quitToMenu(page, touch) {
    await press(page, touch, '.menu-icon-btn');                         // ☰ pause
    await page.waitForFunction(() => document.getElementById('pauseModal').classList.contains('show'));
    await press(page, touch, page.locator('#pauseModal .menu-btn', { hasText: 'MAIN MENU' }));
    await page.waitForFunction(() => document.getElementById('gameConfirmModal').classList.contains('show'));
    await press(page, touch, '#gameConfirmYesBtn');
    await page.waitForFunction(() => document.getElementById('startModal').classList.contains('modal-visible'), null, { timeout: 10000 });
    await page.waitForTimeout(300);
}

async function longPress(page, touch, locator) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (!touch) return page.mouse.click(x, y, { button: 'right' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

async function drag(page, touch, selector) {
    const box = await page.locator(selector).boundingBox();
    const y = box.y + box.height / 2;
    const from = { x: box.x + 10, y };
    const to = { x: box.x + box.width - 10, y };
    if (touch) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
        for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up();
    }
}

// Rip a pack, walk its cards, close it.
async function openPack(page, touch) {
    await page.waitForFunction(() => document.getElementById('packOpeningOverlay').classList.contains('show'), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    await drag(page, touch, '#packTearSurface');
    await page.waitForFunction(() => document.getElementById('packRevealStage').classList.contains('pack-stage-active'), null, { timeout: 5000 });
    const names = [];
    for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(250);
        names.push(await page.textContent('#packCardName'));
        if (i < 4) await press(page, touch, '#packNextBtn');
    }
    await press(page, touch, '#packCloseBtn');
    await page.waitForTimeout(500);
    return names;
}

// Put cards in place for a scripted moment (the rest is played through the UI).
const arrange = (page, spec) => page.evaluate(spec => {
    const make = id => {
        const card = { ...window.__CARD_BY_ID[id], id: Math.random() };
        if (card.type !== 'instant') card.tapped = false;
        if (card.type === 'creature') { card.summoningSick = false; card.damage = 0; }
        return card;
    };
    for (const zone of ['playerHand', 'playerBoard', 'enemyHand', 'enemyBoard']) if (spec[zone]) gameState[zone] = spec[zone].map(make);
    if (spec.playerLife !== undefined) gameState.playerLife = spec.playerLife;
    if (spec.enemyLife !== undefined) gameState.enemyLife = spec.enemyLife;
    if (spec.difficulty) gameState.difficulty = spec.difficulty;
    gameState.landsPlayedThisTurn = 0;
    gameState.playerMana = {};
    updateUI({ immediate: true });
}, spec);

// ------------------------------------------------------------------ playthroughs

async function playthrough(browser, url, project, { existingSave }) {
    const { touch, options } = PROJECTS[project];
    const label = `${project}/${existingSave ? 'existing-save' : 'fresh'}`;
    console.log(`\n[${label}]`);
    const context = await browser.newContext({ ...options });
    if (existingSave) {
        await context.addInitScript(save => {
            if (!sessionStorage.getItem('__seeded')) {
                localStorage.setItem('emoji_elements_meta_v1', save);
                sessionStorage.setItem('__seeded', '1');
            }
        }, EXISTING_SAVE);
    }
    const page = await context.newPage();
    const sink = { errors: [], warnings: [], qaLogs: [], failedRequests: [], dialogs: [] };
    watch(page, sink);
    const shot = name => page.screenshot({ path: path.join(OUT, `${label.replace('/', '-')}-${name}.png`) });

    await page.goto(url);
    await boot(page, touch);
    const prod = await page.evaluate(() => ({
        qaMode: QA_MODE, helpers: Object.keys(window).filter(k => k.startsWith('__qa')),
        backups: JSON.parse(localStorage.getItem('emoji_elements_meta_backups') || '[]')
    }));
    check(label, 'production', 'QA mode is off and no window.__qa* helpers are exposed', !prod.qaMode && prod.helpers.length === 0, JSON.stringify({ qaMode: prod.qaMode, helpers: prod.helpers }));
    // Every sound file loads (the first tap unlocks audio); the intro video may not decode in this Chromium.
    await page.waitForTimeout(1500);
    const media = await page.evaluate(async () => {
        const files = [...new Set(Object.values(audioSystem).map(a => a.src))];
        const status = await Promise.all(files.map(src => fetch(src, { method: 'HEAD' }).then(r => r.status, () => 0)));
        return {
            missing: files.filter((src, i) => status[i] !== 200).map(src => src.split('/').pop()),
            erroring: Object.entries(audioSystem).filter(([, a]) => a.error).map(([k, a]) => `${k}:${a.error.code}`),
            files: files.length,
            video: { status: await fetch('inspiresoftwareintro.mp4', { method: 'HEAD' }).then(r => r.status, () => 0), canPlayH264: document.getElementById('introVideo').canPlayType('video/mp4; codecs="avc1.42E01E"') }
        };
    });
    check(label, 'network', `all ${media.files} sound files and the intro video are served (200) and no sound reports a load error`, media.missing.length === 0 && media.erroring.length === 0 && media.video.status === 200, JSON.stringify(media));
    const start = await state(page);
    if (existingSave) {
        // A save from the previous release: progress kept, its untouched FIRE_SWAMP starter migrated once
        // (PROGRESSION.md §7), and the exact old save kept as the one backup.
        const old = JSON.parse(EXISTING_SAVE);
        const oldCards = Object.values(old.collection).reduce((s, n) => s + n, 0);
        check(label, 'save', 'previous-release save: credits, stats and collection kept; migrated once with the exact old save backed up',
            start.credits === old.wallet.credits && start.wins === old.stats.wins && start.losses === old.stats.losses && start.collection === oldCards &&
            prod.backups.length === 1 && prod.backups[0].reason === 'repair' && prod.backups[0].raw === EXISTING_SAVE,
            JSON.stringify({ start, oldCards, backups: prod.backups.map(b => b.reason) }));
    } else {
        check(label, 'save', 'fresh profile: 100 credits, 300-card starter collection, 0 wins/losses', start.credits === 100 && start.collection === 300 && start.wins === 0, JSON.stringify(start));
    }
    await shot('menu');

    // ---- each deck identity: started through NEW GAME, quit through pause → MAIN MENU → YES
    const identity = [];
    for (const deckKey of DECKS) {
        await startDeck(page, touch, deckKey);
        const r = await page.evaluate(key => {
            const all = [...gameState.playerDeck, ...gameState.playerHand];
            const saved = gameMeta.decks[key].cardIds;
            const ids = all.map(c => c.__id).sort();
            const colors = key.toLowerCase().split('_');
            return {
                selected: gameMeta.selectedDeckKey === key,
                size: all.length,
                matchesSaved: JSON.stringify(ids) === JSON.stringify([...saved].sort()),
                offColor: all.filter(c => !isCardEligibleForDeck(c, colors)).map(c => c.name)
            };
        }, deckKey);
        identity.push({ deckKey, ...r });
        await quitToMenu(page, touch);
    }
    const badDecks = identity.filter(d => !d.selected || d.size !== 60 || !d.matchesSaved || d.offColor.length);
    check(label, 'decks', 'all 15 deck identities start through NEW GAME with exactly the saved 60-card deck, on colour', badDecks.length === 0, JSON.stringify(badDecks.slice(0, 3)));
    check(label, 'pause', 'pause → MAIN MENU → YES quits to the menu (15 times)', true);

    // ---- a match through the UI: land, tap, creature, instant, artifact, inspect, mute, attack → win
    await startDeck(page, touch, 'FIRE');
    await arrange(page, {
        playerHand: ['lands-volcanic-peak', 'creatures-fire-lobster', 'spells-fireball', 'artifacts-mana-gem'],
        playerBoard: ['lands-volcanic-peak', 'lands-volcanic-peak', 'lands-volcanic-peak', 'lands-volcanic-peak', 'creatures-crystal-swan', 'creatures-fire-lion'],
        enemyBoard: [], enemyHand: [], enemyLife: 9
    });
    const before = await state(page);
    await press(page, touch, '#playerHand .card.land');                                   // land
    await page.waitForTimeout(350);
    for (let i = 0; i < 5; i++) { await press(page, touch, '#playerBoard .land-stack-card'); await page.waitForTimeout(120); } // tap 5
    const mana = await page.evaluate(() => gameState.playerMana.fire || 0);
    check(label, 'play', 'play a land, then tap the stack five times: 5 fire mana', mana === 5, `fire=${mana}`);
    await press(page, touch, page.locator('#playerHand .card').filter({ hasText: '🦞' }));  // creature (fire 2)
    await page.waitForTimeout(350);
    await press(page, touch, page.locator('#playerHand .card').filter({ hasText: '💥' }));  // instant: Fireball 3 to the enemy
    await page.waitForTimeout(350);
    await press(page, touch, page.locator('#playerHand .card').filter({ hasText: '💎' }));  // artifact (water 2): not affordable with fire
    await page.waitForTimeout(350);
    const refused = await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show'));
    check(label, 'play', 'an unaffordable card shows its details instead of playing', refused);
    if (refused) { await press(page, touch, '#cardDetailPopup .close-detail'); await page.waitForTimeout(300); }
    const mid = await state(page);
    check(label, 'play', 'creature and instant resolve once; the unaffordable artifact stays in hand', mid.life[1] === 6 && mid.hand === 1 && mid.board === before.board + 2, JSON.stringify({ before, mid }));
    await longPress(page, touch, page.locator('#playerBoard .card').filter({ hasText: '🦢' }));
    await page.waitForTimeout(300);
    const detail = await page.evaluate(() => ({ shown: document.getElementById('cardDetailPopup').classList.contains('show'), text: document.getElementById('detailContent').textContent }));
    check(label, 'inspect', `${touch ? 'long-press' : 'right-click'} shows the card with its keyword rule (Flying)`, detail.shown && /Flying: Can only be blocked/i.test(detail.text), detail.text.slice(0, 80));
    await press(page, touch, '#cardDetailPopup .close-detail');
    await page.waitForTimeout(200);
    await press(page, touch, '#muteBtn');
    await page.waitForTimeout(200);
    const muted = await page.evaluate(() => ({ stored: localStorage.getItem('emojiElementsMuted'), pressed: document.getElementById('muteBtn').getAttribute('aria-pressed'), audioMuted: Object.values(audioSystem).every(a => a.muted) }));
    check(label, 'audio', 'mute: every sound muted, saved, announced', muted.stored === 'true' && muted.pressed === 'true' && muted.audioMuted, JSON.stringify(muted));
    await press(page, touch, '#attackBtn');
    for (const emoji of ['🦢', '🦁']) await press(page, touch, page.locator('#playerBoard .card').filter({ hasText: emoji }));
    // Duplicate action: CONFIRM pressed twice quickly
    await doublePress(page, touch, '#attackBtn');
    await page.waitForFunction(() => document.getElementById('matchRewardOverlay').classList.contains('show'), null, { timeout: 10000 });
    const won = await state(page);
    check(label, 'result', 'attack through the UI wins the match; rewards recorded once (+25 credits, +1 win)', won.finalized && won.wins === start.wins + 1 && won.credits === start.credits + 25, JSON.stringify(won));
    await shot('rewards');
    await doublePress(page, touch, '#matchRewardOverlay .overlay-btn');      // duplicate tap
    const reward = await openPack(page, touch);
    await page.waitForFunction(() => document.getElementById('victoryOverlay').classList.contains('show'), null, { timeout: 8000 });
    const afterReward = await state(page);
    check(label, 'packs', 'free reward pack: rip, 5 cards revealed, collection +5, packs opened +1, opened once', reward.length === 5 && reward.every(Boolean) && afterReward.collection === start.collection + 5 && afterReward.packsOpened === start.packsOpened + 1, JSON.stringify({ reward, afterReward }));
    await shot('victory');
    await press(page, touch, page.locator('#victoryOverlay .overlay-btn', { hasText: 'MAIN MENU' }));
    await page.waitForTimeout(500);

    // ---- pack purchase (with a duplicate tap)
    await press(page, touch, menuButton(page, 'PACK SHOP'));
    await doublePress(page, touch, '.shop-pack-btn[data-theme="fantasy"]');
    const bought = await openPack(page, touch);
    const afterBuy = await state(page);
    check(label, 'packs', 'shop purchase: charged 60 once, 5 cards, packs opened +1', bought.length === 5 && afterBuy.credits === afterReward.credits - 60 && afterBuy.packsOpened === afterReward.packsOpened + 1, JSON.stringify(afterBuy));
    await page.evaluate(() => hidePackShop());

    // ---- a loss: the AI attacks on its turn; END TURN pressed twice
    await startDeck(page, touch, 'WATER');
    await arrange(page, { playerHand: [], playerBoard: [], playerLife: 2, enemyBoard: ['creatures-fire-lobster'], enemyHand: [], difficulty: 'easy' });
    await page.evaluate(() => { gameState.difficulty = 'hard'; });
    const aiTurns = await page.evaluate(() => { window.__aiTurns = 0; const orig = window.aiTurn; window.aiTurn = function () { window.__aiTurns++; return orig.apply(this, arguments); }; return true; });
    void aiTurns;
    await doublePress(page, touch, '#endTurnBtn');
    await page.waitForFunction(() => document.getElementById('loseOverlay').classList.contains('show'), null, { timeout: 20000 });
    const lost = await state(page);
    const turnsRun = await page.evaluate(() => window.__aiTurns);
    check(label, 'result', 'END TURN twice: one AI turn; the AI attack loses the match (+10 credits, +1 loss)', turnsRun === 1 && lost.losses === start.losses + 1 && lost.credits === afterBuy.credits + 10, JSON.stringify({ turnsRun, lost }));
    await shot('defeat');
    await press(page, touch, page.locator('#loseOverlay .overlay-btn', { hasText: 'MAIN MENU' }));
    await page.waitForTimeout(500);

    // ---- save / reload
    await page.reload();
    await boot(page, touch);
    const reloaded = await state(page);
    const backupsAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('emoji_elements_meta_backups') || '[]').length);
    check(label, 'save', 'reloading a clean save writes no new backup', backupsAfterReload === prod.backups.length, `${prod.backups.length} → ${backupsAfterReload}`);
    const mutedAfterReload = await page.evaluate(() => soundSettings.muted && document.getElementById('muteBtn').textContent === '🔇');
    check(label, 'save', 'reload keeps credits, collection, wins/losses, packs opened and mute', reloaded.credits === lost.credits && reloaded.collection === afterBuy.collection && reloaded.wins === lost.wins && reloaded.losses === lost.losses && reloaded.packsOpened === afterBuy.packsOpened && mutedAfterReload, JSON.stringify({ reloaded, mutedAfterReload }));

    // ---- resets (through STATS and the confirm dialog)
    await press(page, touch, menuButton(page, 'STATS'));
    await press(page, touch, page.locator('#statsScreen .menu-btn', { hasText: 'RESET STATS' }));
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.getElementById('gameConfirmModal').classList.contains('show'))) await press(page, touch, '#gameConfirmYesBtn');
    await page.waitForTimeout(300);
    const statsReset = await state(page);
    check(label, 'reset', 'RESET STATS: wins/losses 0; credits and collection kept', statsReset.wins === 0 && statsReset.losses === 0 && statsReset.credits === reloaded.credits, JSON.stringify(statsReset));
    await press(page, touch, page.locator('#statsScreen .menu-btn', { hasText: 'RESET PROGRESS' }));
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.getElementById('gameConfirmModal').classList.contains('show'))) await press(page, touch, '#gameConfirmYesBtn');
    await page.waitForTimeout(400);
    const progressReset = await state(page);
    const backups = await page.evaluate(() => JSON.parse(localStorage.getItem('emoji_elements_meta_backups') || '[]').map(b => b.reason));
    check(label, 'reset', 'RESET PROGRESS: new profile (100 credits, 300 cards), old one kept as a backup', progressReset.credits === 100 && progressReset.collection === 300 && backups.includes('reset'), JSON.stringify({ progressReset, backups }));

    // ---- what the console and network saw
    const external = sink.failedRequests.filter(r => !r.includes('127.0.0.1'));
    // Chromium cancels and re-requests audio/video byte ranges while streaming (net::ERR_ABORTED); that is
    // not a broken file. Anything else, or any 4xx/5xx, is.
    const mediaAborts = sink.failedRequests.filter(r => r.includes('127.0.0.1') && /ERR_ABORTED/.test(r) && /\.(mp3|mp4)$/.test(r));
    const local = sink.failedRequests.filter(r => r.includes('127.0.0.1') && !mediaAborts.includes(r));
    check(label, 'console', 'no page errors or console errors', sink.errors.length === 0, sink.errors.slice(0, 3).join(' | '));
    check(label, 'console', 'no [QA] output in production', sink.qaLogs.length === 0, sink.qaLogs.slice(0, 3).join(' | '));
    check(label, 'network', 'no failed or 4xx/5xx requests for the game\'s own files', local.length === 0, local.join(' | '));
    check(label, 'dialogs', 'no browser alert/confirm dialogs (the game uses its own)', sink.dialogs.length === 0, sink.dialogs.join(' | '));
    const failsafe = sink.warnings.filter(w => /Emergency turn transition|Video play failed/.test(w));
    check(label, 'console', 'no AI-turn failsafe and no intro restart after skipping', failsafe.length === 0, [...new Set(failsafe)].join(' | '));
    evidence[label] = { identity, external, mediaAborts: mediaAborts.length, media, warnings: [...new Set(sink.warnings)].slice(0, 10), start, final: progressReset };
    await context.close();
}

// ------------------------------------------------------------------ long match performance

async function longMatch(browser, url) {
    console.log('\n[desktop/long-match] 50 turns, busy board, real UI updates');
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const sink = { errors: [], warnings: [], qaLogs: [], failedRequests: [], dialogs: [] };
    watch(page, sink);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(url);
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    await page.evaluate(() => { showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); selectDifficulty('hard'); startGame(); });
    await page.clock.runFor(1000);
    // Both sides at 999 life so the match runs to the turn limit; the player plays everything it can.
    await page.evaluate(() => { gameState.playerLife = 999; gameState.enemyLife = 999; });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const sample = async turn => {
        await cdp.send('HeapProfiler.collectGarbage');
        const m = await metrics();
        const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, floaters: document.querySelectorAll('.floating-dmg, .sparkle, .trample-effect').length, particles: typeof particles !== 'undefined' ? particles.length : 0 }));
        return { turn, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: dom.nodes, floaters: dom.floaters, particles: dom.particles, listeners: m.JSEventListeners, scriptSec: +m.ScriptDuration.toFixed(2), layoutSec: +m.LayoutDuration.toFixed(2) };
    };
    const samples = [await sample(0)];
    const turnCosts = [];
    for (let turn = 1; turn <= 50; turn++) {
        const t0 = await metrics();
        await page.evaluate(() => {
            // Play every affordable card through playCard after tapping all lands (one land a turn).
            const land = gameState.playerHand.find(c => c.type === 'land');
            if (land) { playCard(land.id); releaseProcessingLock(); }
            gameState.playerBoard.filter(c => c.type === 'land' && !c.tapped && !c.elements).forEach(c => tapLand(c.id));
            for (let i = 0; i < 6; i++) {
                const card = gameState.playerHand.find(c => c.type !== 'land' && canPayCost(c.cost, gameState.playerMana));
                if (!card) break;
                playCard(card.id); releaseProcessingLock();
            }
            // Top life and decks up so the 50-turn run measures play, not the end of the match
            // (the hard AI's board deals hundreds of damage a turn by turn 40).
            gameState.playerLife = 999;
            gameState.enemyLife = 999;
            if (gameState.playerDeck.length < 10) gameState.playerDeck.push(...generateDeck(['fire', 'water']).slice(0, 20));
            if (gameState.enemyDeck.length < 10) gameState.enemyDeck.push(...generateDeck(['earth', 'swamp']).slice(0, 20));
            const eligible = gameState.playerBoard.filter(canAttack);
            if (eligible.length && !gameState.hasAttackedThisTurn) { enterAttackPhase(); eligible.forEach(c => selectAttacker(c.id)); confirmAttackers(); }
        });
        await page.clock.runFor(400);
        await page.evaluate(() => { releaseProcessingLock(); endTurn(); });
        for (let i = 0; i < 12 && (await page.evaluate(() => gameState.turn)) !== 'player'; i++) await page.clock.runFor(1500);
        const t1 = await metrics();
        turnCosts.push(+(t1.ScriptDuration - t0.ScriptDuration + t1.LayoutDuration - t0.LayoutDuration).toFixed(3));
        if (turn % 10 === 0) samples.push(await sample(turn));
        if (await page.evaluate(() => gameState.matchFinalized)) break;
    }
    const board = await page.evaluate(() => ({
        player: gameState.playerBoard.length, enemy: gameState.enemyBoard.length, finalized: gameState.matchFinalized,
        life: [gameState.playerLife, gameState.enemyLife], decks: [gameState.playerDeck.length, gameState.enemyDeck.length],
        deckedOut: [!!gameState.playerDeckedOut, !!gameState.enemyDeckedOut]
    }));
    console.table(samples);
    const first = samples[1] || samples[0];
    const last = samples[samples.length - 1];
    const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
    const early = avg(turnCosts.slice(0, 10));
    const late = avg(turnCosts.slice(-10));
    check('desktop', 'performance', `long match reached ${last.turn} turns with ${board.player}+${board.enemy} permanents, no errors`, last.turn >= 50 && sink.errors.length === 0, `${JSON.stringify(board)} ${sink.errors.slice(0, 2).join(' | ')}`);
    check('desktop', 'performance', `heap after GC stays bounded (${first.heapMB} MB at turn ${first.turn} → ${last.heapMB} MB at turn ${last.turn})`, last.heapMB < first.heapMB * 1.5 + 5, JSON.stringify(samples));
    check('desktop', 'performance', `event listeners don't accumulate (${first.listeners} → ${last.listeners})`, last.listeners < first.listeners * 1.5 + 200, JSON.stringify(samples));
    check('desktop', 'performance', `script+layout time per turn stays flat (${(early * 1000).toFixed(0)} ms early → ${(late * 1000).toFixed(0)} ms late)`, late < early * 2 + 0.05, JSON.stringify(turnCosts));
    check('desktop', 'performance', 'no lingering floating numbers, sparkles or particles', last.floaters < 10 && last.particles < 300, JSON.stringify(last));
    evidence.longMatch = { samples, board, earlyTurnMs: +(early * 1000).toFixed(1), lateTurnMs: +(late * 1000).toFixed(1) };
    await context.close();
}

async function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch();
    const projects = args.project === 'long' ? [] : args.project ? [args.project] : Object.keys(PROJECTS);
    try {
        for (const project of projects) {
            await playthrough(browser, url, project, { existingSave: false });
            await playthrough(browser, url, project, { existingSave: true });
        }
        if (!args.project || args.project === 'desktop' || args.project === 'long') await longMatch(browser, url);
    } catch (error) {
        check('harness', 'harness', 'playthrough completed', false, error.stack || error.message);
    } finally {
        await browser.close();
        server.close();
    }
    const failed = results.filter(r => !r.ok);
    fs.writeFileSync(path.join(OUT, 'release.json'), JSON.stringify({ date: new Date().toISOString(), browser: chromium.name(), results, evidence }, null, 2));
    console.log(`\nSummary: ${results.length - failed.length} passed · ${failed.length} failed → test-results/release/release.json`);
    process.exit(failed.length ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
