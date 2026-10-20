// Seeded AI-vs-bot match simulation for EMOJI ELEMENTS (used by tests/ai-sim.mjs and tests/ai.test.mjs).
//
// The player side is a fixed "reference bot" that only uses the real player actions (playCard, tapLand,
// activateArtifact, enterAttackPhase/selectAttacker/confirmAttackers, endTurn), so every match exercises the
// same rules a person plays under. The AI side is the game's own aiTurn. Monitors wrap the AI's decision
// points and record anything a player would not be allowed to do (AI.md §2).
// Determinism: Math.random is seeded before index.js loads and Playwright's fake clock drives all timers.

import assert from 'node:assert/strict';

export const STANDARD_DECKS = [
    ['fire'], ['water'], ['earth'], ['swamp'], ['light'],
    ['fire', 'water'], ['fire', 'earth'], ['fire', 'swamp'], ['fire', 'light'], ['water', 'earth'],
    ['water', 'swamp'], ['water', 'light'], ['earth', 'swamp'], ['earth', 'light'], ['swamp', 'light']
];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const TURN_CAP = 70;          // player turns; a 60-card deck decks out by about turn 54
const AI_TURN_BUDGET_MS = 15000;     // simulated time an AI turn may take (its own failsafe fires at 12 s)

function pageInit(seed) {
    let state = seed >>> 0;
    Math.random = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Installed in the page after index.js has loaded: monitors around the AI, and the reference bot.
function installHarness() {
    // Rendering-only loop (canvas particles) stopped: under the fake clock it runs every 16 ms of a ~10 s AI turn.
    window.animateParticles = () => {};
    const sim = window.__sim = {
        violations: [],
        warnings: [],
        turns: [],          // one record per AI turn
        current: null,
        aiTurnStartedAt: 0
    };
    const flag = (rule, detail) => sim.violations.push({ rule, detail, playerTurn: sim.playerTurns || 0 });
    const creatures = board => board.filter(c => c.type === 'creature');
    const manaTotal = pool => Object.values(pool || {}).reduce((s, n) => s + (n || 0), 0);
    const costTotal = cost => Object.values(cost || {}).reduce((s, n) => s + n, 0);

    // ---- would this effect do anything right now? (same targeting rules as resolveSpell)
    sim.effectHasTarget = (card, side) => {
        const mine = side === 'enemy' ? gameState.enemyBoard : gameState.playerBoard;
        const theirs = side === 'enemy' ? gameState.playerBoard : gameState.enemyBoard;
        const myGrave = side === 'enemy' ? gameState.enemyGraveyard : gameState.playerGraveyard;
        const theirHand = side === 'enemy' ? gameState.playerHand : gameState.enemyHand;
        const targetable = creatures(theirs).filter(c => !c.abilities?.includes('hexproof'));
        switch (card.effect) {
            case 'buff': case 'buff_defense': return creatures(mine).length > 0;
            case 'destroy': case 'bounce': return targetable.length > 0;
            case 'tap': return card.skipUntap ? targetable.length > 0 : targetable.some(c => !c.tapped);
            case 'revive': return myGrave.some(c => c.type === 'creature');
            case 'discard': return theirHand.length > 0;
            case 'aoe': return creatures(theirs).length > 0;
            default: return true;
        }
    };

    // ---- AI turn bookkeeping
    const origAiTurn = window.aiTurn;
    window.aiTurn = function () {
        const landsInHand = gameState.enemyHand.filter(c => c.type === 'land').length;
        sim.current = {
            playerTurn: sim.playerTurns || 0,
            landIdsBefore: gameState.enemyBoard.filter(c => c.type === 'land').map(c => c.id),
            landsInHand,
            plays: [],
            manaGenerated: 0,
            manaSpent: 0,
            attacks: null,
            castableLeft: [],
            lethalOnBoard: false,
            lethalBurnHeld: false,
            playerLifeBefore: gameState.playerLife
        };
        sim.aiTurnStartedAt = Date.now();
        return origAiTurn.apply(this, arguments);
    };

    const origStartPlayerTurn = window.startPlayerTurn;
    window.startPlayerTurn = function () {
        const t = sim.current;
        if (t) {
            // Lands that entered the battlefield this turn (lands never leave it; a discarded land never entered).
            const played = gameState.enemyBoard.filter(c => c.type === 'land' && !t.landIdsBefore.includes(c.id)).length;
            delete t.landIdsBefore;
            if (played > 1) flag('ai-two-lands', `${played} lands in one turn`);
            t.landPlayed = played === 1;
            t.missedLand = played === 0 && t.landsInHand > 0;
            // Cards the AI could still afford with what was left (held back by its play limit or instant rule).
            t.manaLeft = manaTotal(gameState.enemyMana);
            t.castableLeft = gameState.enemyHand
                .filter(c => c.type !== 'land' && canPayCost(c.cost, gameState.enemyMana))
                .map(c => `${c.type}:${c.name}`);
            t.durationMs = Date.now() - sim.aiTurnStartedAt;
            t.playerDamage = t.playerLifeBefore - gameState.playerLife;
            // Lethal burn it could still afford and didn't cast.
            t.lethalBurnHeld = !gameState.matchFinalized && gameState.enemyHand.some(c => c.type === 'instant' &&
                c.effect === 'damage' && c.target !== 'all' && c.value >= gameState.playerLife && canPayCost(c.cost, gameState.enemyMana));
            sim.turns.push(t);
            sim.current = null;
        }
        return origStartPlayerTurn.apply(this, arguments);
    };

    const origAiPlayCard = window.aiPlayCard;
    window.aiPlayCard = function (card) {
        const t = sim.current;
        if (gameState.turn !== 'enemy') flag('ai-plays-off-turn', card.name);
        if (gameState.matchFinalized) flag('ai-plays-after-match', card.name);
        if (!gameState.enemyHand.some(c => c.id === card.id)) flag('ai-plays-card-not-in-hand', card.name);
        if (card.type === 'land') flag('ai-land-through-play', card.name);
        if (!canPayCost(card.cost, gameState.enemyMana)) flag('ai-cannot-pay', `${card.name} ${JSON.stringify(card.cost)} with ${JSON.stringify(gameState.enemyMana)}`);
        if (t && t.manaGenerated === 0) t.manaGenerated = manaTotal(gameState.enemyMana);
        const useful = card.type === 'creature' || sim.effectHasTarget(card, 'enemy');
        const result = origAiPlayCard.apply(this, arguments);
        if (Object.values(gameState.enemyMana).some(n => n < 0)) flag('ai-negative-mana', JSON.stringify(gameState.enemyMana));
        if (t) {
            t.plays.push({ name: card.name, type: card.type, effect: card.effect || null, cost: costTotal(card.cost), useful });
            t.manaSpent += costTotal(card.cost);
        }
        return result;
    };

    // Attack declaration: every attacker must be the AI's own, able to attack, and declared once.
    const origResolveEnemyAttack = window.resolveEnemyAttackPhase;
    window.resolveEnemyAttackPhase = function (attackers) {
        const t = sim.current;
        const eligible = gameState.enemyBoard.filter(canAttack);
        if (t && t.attacks) flag('ai-attacks-twice', `turn ${t.playerTurn}`);
        if (gameState.turn !== 'enemy') flag('ai-attacks-off-turn', '');
        const ids = new Set();
        attackers.forEach(a => {
            if (!gameState.enemyBoard.includes(a)) flag('ai-attacker-not-on-board', a.name);
            if (!canAttack(a)) flag('ai-illegal-attacker', `${a.name}: ${getAttackRestriction(a)}`);
            if (ids.has(a.id)) flag('ai-attacker-twice', a.name);
            ids.add(a.id);
        });
        if (t) {
            // Lethal check with the same automatic blocking the game will apply.
            const blockers = gameState.playerBoard.filter(c => c.type === 'creature' && !c.tapped);
            // Blocks go toughest-first to attackers in declaration order, so try the obvious orders.
            const byPower = [...eligible].sort((a, b) => (b.power || 0) - (a.power || 0));
            const unblockedPower = order => {
                const blocks = assignAutoBlockers(order, blockers);
                return order.filter(a => !blocks[a.id]).reduce((s, a) => s + (a.power || 0) * (a.abilities?.includes('double_strike') ? 2 : 1), 0);
            };
            t.lethalOnBoard = Math.max(...[eligible, byPower, [...byPower].reverse()].map(unblockedPower)) >= gameState.playerLife;
            t.attacks = {
                eligible: eligible.length,
                declared: attackers.length,
                attackers: attackers.map(a => ({ id: a.id, name: a.name, power: a.power, toughness: a.toughness }))
            };
            t.boardBefore = { ai: creatures(gameState.enemyBoard).map(c => c.id), player: creatures(gameState.playerBoard).map(c => c.id) };
        }
        const result = origResolveEnemyAttack.apply(this, arguments);
        if (t && t.attacks) {
            const aliveAi = new Set(creatures(gameState.enemyBoard).map(c => c.id));
            const alivePlayer = new Set(creatures(gameState.playerBoard).map(c => c.id));
            t.attacks.attackersLost = t.attacks.attackers.filter(a => !aliveAi.has(a.id)).length;
            t.attacks.playerCreaturesKilled = t.boardBefore.player.filter(id => !alivePlayer.has(id)).length;
        }
        return result;
    };

    // Blocks are automatic for both sides; check the assignment the game makes is legal.
    const checkBlocks = (blocks, attackers, defendingBoard, who) => {
        const used = new Set();
        Object.entries(blocks).forEach(([attackerId, blockerIds]) => {
            const attacker = attackers.find(a => String(a.id) === String(attackerId));
            if (!attacker) { flag(`${who}-block-unknown-attacker`, attackerId); return; }
            if (attacker.abilities?.includes('menace') && blockerIds.length < 2) flag(`${who}-menace-single-block`, attacker.name);
            blockerIds.forEach(id => {
                const blocker = defendingBoard.find(c => c.id === id);
                if (!blocker) flag(`${who}-blocker-not-on-board`, String(id));
                else if (!canBlockAttacker(blocker, attacker)) flag(`${who}-illegal-blocker`, `${blocker.name} blocking ${attacker.name}`);
                if (used.has(id)) flag(`${who}-blocker-used-twice`, blocker?.name || String(id));
                used.add(id);
            });
        });
    };
    const origDeclarePlayerBlockers = window.declarePlayerBlockers;
    window.declarePlayerBlockers = function (attackers) {
        const blocks = origDeclarePlayerBlockers.apply(this, arguments);
        checkBlocks(blocks, attackers, gameState.playerBoard, 'player');
        return blocks;
    };
    const origAiDeclareBlockers = window.aiDeclareBlockers;
    window.aiDeclareBlockers = function () {
        const result = origAiDeclareBlockers.apply(this, arguments);
        const attackers = gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean);
        checkBlocks(gameState.blockers, attackers, gameState.enemyBoard, 'ai');
        return result;
    };

    // ---------------------------------------------------------------- reference bot (player side)
    // One action per call; the caller advances the clock between calls (playCard holds a 200 ms lock).
    const bot = sim.bot = { attackedThisTurn: false };
    const potentialMana = () => {
        const pool = { ...gameState.playerMana };
        gameState.playerBoard.forEach(c => {
            if (c.tapped) return;
            if (c.type === 'land') {
                const el = c.element || (c.elements && c.elements[0]);
                if (el) pool[el] = (pool[el] || 0) + 1;
            } else if (c.type === 'artifact' && c.effect === 'mana') {
                pool.colorless = (pool.colorless || 0) + (c.value || 1);
            }
        });
        return pool;
    };
    const castable = pool => gameState.playerHand
        .filter(c => c.type !== 'land' && canPayCost(c.cost, pool) && (c.type === 'creature' || sim.effectHasTarget(c, 'player')))
        .sort((a, b) => costTotal(b.cost) - costTotal(a.cost));

    bot.step = () => {
        if (gameState.matchFinalized) return 'over';
        if (gameState.turn !== 'player' || gameState.phase !== 'main' || isProcessingAction) return 'wait';
        const manaModal = document.getElementById('manaChoiceModal');
        if (manaModal?.classList.contains('show')) {
            const option = manaModal.querySelector('.mana-choice-btn:not(.cancel-btn)');
            option?.click();
            return 'mana-choice';
        }
        if (gameState.landsPlayedThisTurn < 1) {
            const land = gameState.playerHand.find(c => c.type === 'land');
            if (land) { playCard(land.id); return 'land'; }
        }
        const wanted = castable(potentialMana());
        if (wanted.length) {
            const now = castable(gameState.playerMana);
            if (now.length) { playCard(now[0].id); return `cast:${now[0].name}`; }
            const source = gameState.playerBoard.find(c => !c.tapped && (c.type === 'land' || (c.type === 'artifact' && c.effect === 'mana')));
            if (source) {
                if (source.type === 'land') tapLand(source.id); else activateArtifact(source.id);
                return 'tap';
            }
        }
        if (!bot.attackedThisTurn && !gameState.hasAttackedThisTurn) {
            bot.attackedThisTurn = true;
            const eligible = gameState.playerBoard.filter(canAttack);
            if (eligible.length) {
                const blockers = gameState.enemyBoard.filter(c => c.type === 'creature' && !c.tapped);
                const all = assignAutoBlockers(eligible, blockers);
                const unblocked = eligible.filter(a => !all[a.id]).reduce((s, a) => s + (a.power || 0), 0);
                let chosen;
                if (unblocked >= gameState.enemyLife) {
                    chosen = eligible;
                } else {
                    // Attack when the toughest legal blocker can't kill it, or it trades evenly or better.
                    chosen = eligible.filter(a => {
                        const legal = blockers.filter(b => canBlockAttacker(b, a)).sort((x, y) => y.toughness - x.toughness);
                        if (a.abilities?.includes('menace') ? legal.length < 2 : legal.length === 0) return true;
                        const b = legal[0];
                        const survives = (b.power || 0) < a.toughness;
                        const kills = (a.power || 0) >= b.toughness || a.abilities?.includes('deathtouch');
                        return survives || (kills && costTotal(a.cost) <= costTotal(b.cost));
                    });
                }
                if (chosen.length) {
                    enterAttackPhase();
                    chosen.forEach(a => selectAttacker(a.id));
                    confirmAttackers();
                    return `attack:${chosen.length}`;
                }
            }
        }
        bot.attackedThisTurn = false;
        sim.playerTurns = (sim.playerTurns || 0) + 1;
        endTurn();
        return 'end';
    };
    return true;
}

// Runs one match in a fresh context. Returns a summary record.
export async function runMatch(browser, url, { seed, deck, difficulty, turnCap = TURN_CAP }) {
    // Reduced motion skips particles and shake (index.js), which keeps simulated turns cheap.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    // Offline and silent: external fonts and the audio/video files are not needed to play.
    await context.route(/^(?!http:\/\/127\.0\.0\.1)|\.(mp3|mp4)$/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text());
        if (m.type() === 'warning' && /Emergency turn transition|AI scoring failed|AI attack selection failed|Error during AI turn/.test(m.text())) errors.push(`warn: ${m.text()}`);
    });
    page.on('dialog', d => d.dismiss());
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.addInitScript(pageInit, seed);
    await page.goto(url);
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    await page.evaluate(installHarness);
    await page.evaluate(({ deck, difficulty }) => {
        showElementSelection();
        setDeckMode(deck.length === 1 ? 'single' : 'dual');
        deck.forEach(el => selectElement(el));
        selectDifficulty(difficulty);
        startGame();
    }, { deck, difficulty });
    await page.clock.runFor(500);
    const aiDeck = await page.evaluate(() => {
        const all = [...gameState.enemyDeck, ...gameState.enemyHand];
        const counts = {};
        all.forEach(c => { counts[c.__id || c.name] = (counts[c.__id || c.name] || 0) + 1; });
        const overLimit = Object.entries(counts).filter(([id, n]) => {
            const card = window.__CARD_BY_ID[id];
            return card && card.type !== 'land' && n > getDeckCardCopyLimit(card);
        }).length;
        const legendaries = all.filter(c => c.__rarity === 'legendary').length;
        const colors = [...new Set(all.filter(c => c.type === 'land').map(c => c.element))];
        return { colors, overLimit, legendaries, size: all.length };
    });

    let outcome = null;
    let actions = 0;
    let stuck = 0;
    while (!outcome) {
        const state = await page.evaluate(() => ({ over: gameState.matchFinalized, turn: gameState.turn, playerTurns: window.__sim.playerTurns || 0 }));
        if (state.over) break;
        if (state.playerTurns >= turnCap) { outcome = 'turn-cap'; break; }
        if (state.turn === 'enemy') {
            let back = false;
            for (let waited = 0; waited < AI_TURN_BUDGET_MS && !back; waited += 1500) {
                await page.clock.runFor(1500);
                back = await page.evaluate(() => (gameState.turn === 'player' && !isProcessingAction) || gameState.matchFinalized);
            }
            if (!back) { outcome = 'ai-turn-stalled'; break; }
            continue;
        }
        const action = await page.evaluate(() => window.__sim.bot.step());
        if (process.env.SIM_DEBUG) console.log(state.playerTurns, action, await page.evaluate(() => [gameState.playerLife, gameState.enemyLife]));
        actions++;
        await page.clock.runFor(action === 'end' ? 1600 : 250);
        if (action === 'wait') {
            if (++stuck > 60) { outcome = 'player-turn-stalled'; break; }
        } else {
            stuck = 0;
        }
        if (actions > turnCap * 60) { outcome = 'action-cap'; break; }
    }

    const result = await page.evaluate(() => {
        const s = window.__sim;
        return {
            finalized: gameState.matchFinalized,
            playerLife: gameState.playerLife,
            enemyLife: gameState.enemyLife,
            playerDeckedOut: !!gameState.playerDeckedOut,
            enemyDeckedOut: !!gameState.enemyDeckedOut,
            playerTurns: s.playerTurns || 0,
            violations: s.violations,
            turns: s.turns
        };
    });
    await context.close();

    let winner = null;
    let reason = outcome;
    if (!outcome && result.finalized) {
        const playerLost = result.playerLife <= 0 || result.playerDeckedOut;
        winner = playerLost ? 'ai' : 'player';
        reason = (playerLost ? (result.playerDeckedOut ? 'player-decked' : 'player-life') : (result.enemyDeckedOut ? 'ai-decked' : 'ai-life'));
    }
    return { seed, deck: deck.join('_').toUpperCase(), difficulty, winner, reason, aiDeck, errors, ...result };
}

// Aggregates match records into the numbers reported in AI.md.
export function summarize(matches) {
    const by = (keyFn) => {
        const groups = {};
        matches.forEach(m => { (groups[keyFn(m)] ||= []).push(m); });
        return groups;
    };
    const stats = list => {
        const decided = list.filter(m => m.winner);
        const aiTurns = list.flatMap(m => m.turns);
        const attackTurns = aiTurns.filter(t => t.attacks && t.attacks.eligible > 0);
        const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
        const plays = aiTurns.flatMap(t => t.plays);
        return {
            matches: list.length,
            aiWinRate: decided.length ? +(decided.filter(m => m.winner === 'ai').length / decided.length).toFixed(3) : null,
            avgPlayerTurns: +(sum(list, m => m.playerTurns) / list.length).toFixed(1),
            undecided: list.length - decided.length,
            deckouts: list.filter(m => /decked/.test(m.reason || '')).length,
            violations: sum(list, m => m.violations.length),
            errors: sum(list, m => m.errors.length),
            missedLandDrops: +(sum(aiTurns, t => t.missedLand ? 1 : 0) / Math.max(1, aiTurns.length)).toFixed(3),
            manaUse: +(sum(aiTurns, t => t.manaSpent) / Math.max(1, sum(aiTurns, t => t.manaGenerated || t.manaLeft + t.manaSpent))).toFixed(3),
            castableHeldTurns: +(sum(aiTurns, t => t.castableLeft.length ? 1 : 0) / Math.max(1, aiTurns.length)).toFixed(3),
            uselessCasts: plays.filter(p => !p.useful).length,
            attackRate: +(sum(attackTurns, t => t.attacks.declared) / Math.max(1, sum(attackTurns, t => t.attacks.eligible))).toFixed(3),
            attackersLostPerAttack: +(sum(attackTurns, t => t.attacks.attackersLost) / Math.max(1, sum(attackTurns, t => t.attacks.declared))).toFixed(3),
            missedLethal: aiTurns.filter(t => t.lethalOnBoard && t.playerDamage < (t.playerLifeBefore || 0)).length,
            lethalBurnHeld: aiTurns.filter(t => t.lethalBurnHeld).length,
            stalls: list.filter(m => /stalled|cap/.test(m.reason || '')).length
        };
    };
    return {
        overall: stats(matches),
        byDifficulty: Object.fromEntries(Object.entries(by(m => m.difficulty)).map(([k, v]) => [k, stats(v)])),
        byDeck: Object.fromEntries(Object.entries(by(m => m.deck)).map(([k, v]) => [k, stats(v)])),
        byDeckAndDifficulty: Object.fromEntries(Object.entries(by(m => `${m.deck}/${m.difficulty}`)).map(([k, v]) => [k, {
            aiWinRate: stats(v).aiWinRate, avgPlayerTurns: stats(v).avgPlayerTurns, matches: v.length
        }])),
        reasons: Object.fromEntries(Object.entries(by(m => m.reason || 'unknown')).map(([k, v]) => [k, v.length])),
        violationKinds: matches.flatMap(m => m.violations).reduce((acc, v) => { acc[v.rule] = (acc[v.rule] || 0) + 1; return acc; }, {}),
        castableHeldKinds: matches.flatMap(m => m.turns.flatMap(t => t.castableLeft.map(c => c.split(':')[0])))
            .reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
        aiDeck: {
            avgLegendaries: +(matches.reduce((s, m) => s + m.aiDeck.legendaries, 0) / matches.length).toFixed(2),
            decksOverCopyLimit: matches.filter(m => m.aiDeck.overLimit > 0).length
        }
    };
}

export function assertNoViolations(match) {
    assert.deepEqual(match.violations, [], `rule violations in seed ${match.seed} ${match.deck}/${match.difficulty}`);
    assert.deepEqual(match.errors, [], `errors in seed ${match.seed} ${match.deck}/${match.difficulty}`);
}
