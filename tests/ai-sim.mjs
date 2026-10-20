#!/usr/bin/env node
// Seeded AI simulation for EMOJI ELEMENTS: every starter deck against the AI at every difficulty.
//
//   node tests/ai-sim.mjs                         # 15 decks × 3 difficulties × 6 seeds (npm run ai:sim)
//   node tests/ai-sim.mjs --seeds=2 --workers=4   # smaller / faster
//   node tests/ai-sim.mjs --deck=FIRE_WATER --difficulty=hard --seeds=10
//   node tests/ai-sim.mjs --label=before          # results file name
//
// The player side is a fixed reference bot (tests/lib/ai-sim.mjs) that plays through the real player
// actions; the AI is the game's own. Each match records rule violations, errors, stalls, length, winner, and
// AI decision measures. Results: test-results/ai-sim-<label>.json; the summary is printed.
// Exit 1 if any match has a rule violation, error or stall.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';
import { STANDARD_DECKS, DIFFICULTIES, runMatch, summarize } from './lib/ai-sim.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const SEEDS = Number(args.seeds || 6);
const WORKERS = Number(args.workers || 4);
const LABEL = args.label || 'current';
const decks = STANDARD_DECKS.filter(d => !args.deck || d.join('_').toUpperCase() === String(args.deck).toUpperCase());
const difficulties = DIFFICULTIES.filter(d => !args.difficulty || d === args.difficulty);

// Seeds are fixed per (deck, difficulty, n), so any single match can be re-run on its own.
const jobs = [];
decks.forEach((deck, di) => difficulties.forEach((difficulty, fi) => {
    for (let n = 0; n < SEEDS; n++) jobs.push({ deck, difficulty, seed: 1000 + di * 100 + fi * 10 + n });
}));

async function main() {
    const { chromium } = loadPlaywright();
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch();
    const matches = [];
    const started = Date.now();
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const job = jobs[next++];
            let match;
            try {
                match = await runMatch(browser, url, job);
            } catch (error) {
                match = { ...job, deck: job.deck.join('_').toUpperCase(), winner: null, reason: 'harness-error', errors: [String(error.message || error)], violations: [], turns: [], playerTurns: 0, aiDeck: { legendaries: 0, overLimit: 0 } };
            }
            matches.push(match);
            const bad = match.violations.length || match.errors.length || /stalled|cap|error/.test(match.reason || '');
            process.stdout.write(bad ? 'x' : (match.winner === 'ai' ? 'A' : 'p'));
            if (matches.length % 60 === 0) process.stdout.write(` ${matches.length}/${jobs.length}\n`);
        }
    };
    try {
        await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, worker));
    } finally {
        await browser.close();
        server.close();
    }
    process.stdout.write('\n');

    matches.sort((a, b) => a.seed - b.seed);
    const summary = summarize(matches);
    const out = path.join(ROOT, 'test-results', `ai-sim-${LABEL}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ label: LABEL, seeds: SEEDS, date: new Date().toISOString(), summary, matches }, null, 2));

    const o = summary.overall;
    console.log(`\n${matches.length} matches in ${Math.round((Date.now() - started) / 1000)} s → ${path.relative(ROOT, out)}`);
    console.log('\nBy difficulty (AI win rate vs the reference bot):');
    console.table(Object.fromEntries(Object.entries(summary.byDifficulty).map(([k, s]) => [k, {
        aiWin: s.aiWinRate, turns: s.avgPlayerTurns, missedLand: s.missedLandDrops, manaUse: s.manaUse, heldCastable: s.castableHeldTurns,
        useless: s.uselessCasts, attackRate: s.attackRate, lostPerAttack: s.attackersLostPerAttack, missedLethal: s.missedLethal,
        burnHeld: s.lethalBurnHeld, deckouts: s.deckouts, stalls: s.stalls, violations: s.violations, errors: s.errors
    }])));
    console.log('By starter deck:');
    console.table(Object.fromEntries(Object.entries(summary.byDeck).map(([k, s]) => [k, { aiWin: s.aiWinRate, turns: s.avgPlayerTurns, matches: s.matches }])));
    console.log('End reasons:', summary.reasons);
    console.log('Violations:', summary.violationKinds);
    console.log('Affordable cards the AI left in hand, by type (turns):', summary.castableHeldKinds);
    console.log('AI decks: avg legendaries', summary.aiDeck.avgLegendaries, '· decks over the copy limit', summary.aiDeck.decksOverCopyLimit, 'of', matches.length);
    const failing = o.violations + o.errors + o.stalls;
    console.log(`\nOverall: AI win rate ${o.aiWinRate}, ${o.avgPlayerTurns} player turns, ${o.violations} violations, ${o.errors} errors, ${o.stalls} stalls`);
    process.exit(failing ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
