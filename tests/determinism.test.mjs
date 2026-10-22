import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useGameBrowser, openGame, startMatch, setup, act } from './lib/game.mjs';
useGameBrowser();

async function stopped(t, seed = 42) {
    const page = await openGame(t, { seed });
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
    return page;
}
const state = page => page.evaluate(() => JSON.parse(JSON.stringify({
    gameState, history: matchHistory, stats: gameStats, meta: gameMeta, rng: gameplayRandomState
})));
const LOBSTER = 'creatures-fire-lobster';
const BEETLE = 'creatures-ember-beetle';
const PEAK = 'lands-volcanic-peak';

// Compare actual playCard/endTurn/AI resolution, not isolated PRNG samples.
test('seeded actions, random targets and rewards ignore presentation and extra renders', { timeout: 120000 }, async t => {
    const runs = [];
    for (const variant of [0, 1, 2]) {
        const page = await stopped(t);
        await page.mouse.click(1, 1);
        await page.emulateMedia({ reducedMotion: variant === 1 ? 'reduce' : 'no-preference' });
        await page.evaluate(async variant => {
            await GameFeedback.unlock();
            GameFeedback.setSetting('muted', variant === 1);
            GameFeedback.setSetting('haptics', variant !== 1);
            applyVisualTheme(Object.keys(VISUAL_THEMES)[variant]);
            gameState.difficulty = 'easy';
            setGameplaySeed(12345);
            // Presentation and runtime identity may be exercised before the match too.
            for (let i = 0; i < variant * 20; i++) { nextCardInstanceId(); GameFeedback.play('summon'); Math.random(); }
        }, variant);
        if (variant !== 1) assert.equal(await page.evaluate(() => GameFeedback.state), 'running', 'sound variation exercised with unlocked audio');
        await startMatch(page);
        const snapshots = [];
        const capture = async () => {
            const s = await state(page);
            // IDs identify runtime objects, not gameplay content; preserve all other card fields.
            for (const zone of ['playerDeck','playerHand','playerBoard','playerGraveyard','enemyDeck','enemyHand','enemyBoard','enemyGraveyard']) {
                for (const c of s.gameState[zone]) { delete c.id; }
            }
            // No attacks are selected at these checkpoints. Wall time is save metadata only.
            if (s.meta.lastPack) { delete s.meta.lastPack.openedAt; delete s.meta.lastPack.acquisitionId; }
            for (const entry of Object.values(s.meta.collection || {})) if (entry && typeof entry === 'object') delete entry.firstSeen;
            snapshots.push(s);
        };
        await capture();
        for (let turn = 0; turn < 3; turn++) {
            if (variant === 2) {
                const before = await state(page);
                await page.evaluate(() => {
                    for (let i = 0; i < 6; i++) {
                        previewCombat(gameState.playerBoard.filter(c => c.type === 'creature'), gameState.enemyBoard, true);
                        showCardDetail(gameState.playerHand[0]); hideCardDetail(); updateUI({ immediate: true });
                        createParticles(20, 20, '#fff', 5); GameFeedback.play('summon');
                    }
                });
                assert.deepEqual(await state(page), before, 'preview, inspection and rendering are read-only, including gameplay RNG');
            }
            // Play an available land, tap mana sources, and play affordable cards through real guards.
            for (let action = 0; action < 5; action++) await act(page, () => {
                gameState.playerBoard.filter(c => c.type === 'land' && !c.tapped).forEach(c => tapLand(c.id));
                const card = gameState.playerHand.find(c => !getPlayRestriction(c));
                if (card) playCard(card.id);
            });
            await page.evaluate(() => endTurn());
            await page.clock.runFor(14000);
            await capture();
        }
        await setup(page, { ...ACTIVE, playerLife: 100, enemyLife: 100 });
        const beforeAI = await page.evaluate(() => gameplayRandomState);
        await page.evaluate(() => endTurn()); await page.clock.runFor(14000);
        assert.notEqual(await page.evaluate(() => gameplayRandomState), beforeAI, 'easy AI actually consumed random attack choices');
        await capture();
        // A legal random-target spell from the catalog with enough mana to cast it.
        await page.evaluate(() => {
            const spell = Object.values(__CARD_BY_ID).find(c => c.type === 'instant' && c.effect === 'destroy');
            __rt.setup({ playerHand: [spell.__id], enemyBoard: ['creatures-fire-lobster', 'creatures-ember-beetle'], playerMana: Object.fromEntries(Object.keys(ELEMENTS).map(k => [k, 20])) });
        });
        await act(page, () => playCard(gameState.playerHand[0].id));
        assert.equal(await page.evaluate(() => gameState.enemyGraveyard.some(c => c.type === 'creature')), true, 'random destroy actually resolved');
        await capture();
        await page.evaluate(() => { gameState.enemyLife = 0; checkGameOver(); });
        await page.clock.runFor(20000);
        await capture();
        runs.push(snapshots);
        await page.close();
    }
    assert.deepEqual(runs[1], runs[0], 'muted/reduced motion matches sound/animation');
    assert.deepEqual(runs[2], runs[0], 'extra presentation and ID allocation match');
});

const ACTIVE = { enemyHand: [PEAK, BEETLE], enemyBoard: [PEAK, PEAK, LOBSTER], enemyDeck: Array(10).fill(LOBSTER), playerHand: [], playerBoard: [] };

test('quit and immediate rematch at each AI phase cancels all old work', { timeout: 120000 }, async t => {
    const page = await stopped(t);
    for (const delay of [0, 1500, 2500, 4000, 5000, 6500, 8000]) {
        await startMatch(page);
        await setup(page, ACTIVE);
        await page.evaluate(() => { endTurn(); createSparkles(10,10); createTrampleEffect(10,10); });
        await page.clock.runFor(delay);
        await page.evaluate(() => { returnToMainMenu(); });
        assert.deepEqual(await page.evaluate(() => [matchTimers.size, particles.length, particleLoopRunning]), [0,0,false]);
        await startMatch(page);
        await page.clock.runFor(500);
        const fresh = await state(page);
        await page.clock.runFor(30000);
        assert.deepEqual(await state(page), fresh, `no stale mutations/rewards at AI offset ${delay}`);
        assert.equal(await page.evaluate(() => ['victoryOverlay','loseOverlay','matchRewardOverlay','cardDetailPopup'].some(id => document.getElementById(id).classList.contains('show'))), false);
    }
});

test('repeated hide/restore and pause cycles preserve the exact remaining AI delay', async t => {
    const page = await stopped(t);
    await startMatch(page); await setup(page, ACTIVE);
    await page.evaluate(() => endTurn());
    await page.clock.runFor(500);
    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange')); pauseGame();
        });
        const paused = await state(page);
        await page.clock.runFor(60000);
        assert.deepEqual(await state(page), paused);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange')); resumeGame(); resumeGame();
        });
    }
    await page.clock.runFor(999);
    assert.equal(await page.evaluate(() => aiStatusText), 'Starting its turn');
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(() => aiStatusText), 'Drawing a card');
});

test('completion cancels pending AI work and awards exactly once before a rematch', async t => {
    const page = await stopped(t);
    await startMatch(page); await setup(page, ACTIVE);
    await page.evaluate(() => endTurn()); await page.clock.runFor(1800);
    await page.evaluate(() => { gameState.enemyLife = 0; checkGameOver(); });
    const completed = await state(page);
    await page.evaluate(() => { checkGameOver(); finalizeMatch('win'); });
    await page.clock.runFor(30000);
    assert.deepEqual(await state(page), completed);
    assert.equal(await page.evaluate(() => matchTimers.size), 0);
    await startMatch(page); const next = await state(page);
    await page.clock.runFor(30000); assert.deepEqual(await state(page), next);
});

// Track browser scheduling after bootstrap; persistent application listeners/intervals already
// installed at bootstrap form the baseline. Detached card listeners belong to their DOM nodes.
test('repeated teardown returns timers, frames and global listeners to baseline', async t => {
    const page = await stopped(t);
    await page.clock.runFor(3000);
    await page.evaluate(() => {
        const timers = new Set(), frames = new Set(), intervals = new Set(), listeners = [];
        const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
        window.setTimeout = (fn, ms, ...args) => {
            const id = timeout(() => { timers.delete(id); fn(...args); }, ms); timers.add(id); return id;
        };
        window.clearTimeout = id => { timers.delete(id); clear(id); };
        const interval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
        window.setInterval = (...args) => { const id = interval(...args); intervals.add(id); return id; };
        window.clearInterval = id => { intervals.delete(id); clearInterval(id); };
        const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = fn => { const id = raf(time => { frames.delete(id); fn(time); }); frames.add(id); return id; };
        window.cancelAnimationFrame = id => { frames.delete(id); cancel(id); };
        for (const target of [window, document]) {
            const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
            target.addEventListener = (type, fn, options) => {
                if (!listeners.some(l => l.target === target && l.type === type && l.fn === fn)) listeners.push({ target, type, fn });
                add(type, fn, options);
            };
            target.removeEventListener = (type, fn, options) => {
                const i = listeners.findIndex(l => l.target === target && l.type === type && l.fn === fn);
                if (i >= 0) listeners.splice(i, 1); remove(type, fn, options);
            };
        }
        window.__resources = () => ({ timers: timers.size, frames: frames.size, intervals: intervals.size, listeners: listeners.map(l => l.type) });
    });
    const baseline = await page.evaluate(() => __resources());
    for (let i = 0; i < 4; i++) {
        await startMatch(page); await setup(page, ACTIVE);
        await page.evaluate(() => {
            endTurn(); createParticles(50,50,'#fff',20); createSparkles(50,50);
            const card = document.querySelector('#enemyBoard .card');
            card.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
            if (matchSerial % 2) pauseGame();
            returnToMainMenu();
        });
        await page.clock.runFor(3000); // finite audio fades and detached-node CSS cleanup settle
        assert.deepEqual(await page.evaluate(() => __resources()), baseline, `resource baseline after cycle ${i}`);
        assert.equal(await page.evaluate(() => document.getElementById('cardDetailPopup').classList.contains('show')), false, 'old long press cannot reopen inspector');
    }
});

test('quit during startup allows an immediate replacement match without the old debounce', async t => {
    const page = await stopped(t);
    const result = await page.evaluate(() => {
        const start = () => { showElementSelection(); setDeckMode('single'); selectElement('fire'); startGame(); };
        start(); const first = matchSerial;
        returnToMainMenu(); start();
        return { newer: matchSerial > first, active: document.getElementById('gameContainer').style.display, starting: isStartingGame };
    });
    assert.deepEqual(result, { newer: true, active: 'flex', starting: true });
    await page.clock.runFor(299);
    assert.equal(await page.evaluate(() => isStartingGame), true);
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(() => isStartingGame), false);
});

test('deck-out during an AI phase stops upkeep and queued actions at completion', async t => {
    const page = await stopped(t);
    await startMatch(page);
    await setup(page, { ...ACTIVE, enemyDeck: [] });
    await page.evaluate(() => {
        const artifact = Object.values(__CARD_BY_ID).find(c => c.type === 'artifact' && c.effect === 'draw');
        gameState.enemyBoard.push(__rt.card(artifact.__id));
    });
    await page.evaluate(() => endTurn()); await page.clock.runFor(1500);
    const completed = await state(page);
    assert.equal(completed.gameState.matchFinalized, true, 'empty draw really ended the match');
    assert.equal(completed.meta.stats.wins, 1);
    await page.evaluate(() => { drawCard('player'); processUpkeepEffects(false); });
    await page.clock.runFor(30000);
    assert.deepEqual(await state(page), completed, 'no draws, upkeep or AI work after terminal draw');
});
