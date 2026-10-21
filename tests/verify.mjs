#!/usr/bin/env node
// One Chromium verification plan, also split into the three CI jobs. Continue after failures; preserve exits.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT } from './lib/harness.mjs';

const group = process.argv[2]?.replace(/^--group=/, '') || 'all';
if (!['all', 'logic', 'visual', 'playthroughs'].includes(group) || process.argv.length > 3) {
    console.error('Usage: npm run verify [-- --group=logic|visual|playthroughs]');
    process.exit(2);
}
const suites = fs.readdirSync(path.join(ROOT, 'tests')).filter(name => name.endsWith('.test.mjs')).sort();
const plan = [
    ['logic', 'catalog', ['tests/card-audit.mjs']],
    ['logic', 'suites', ['--test', '--test-concurrency=2', ...suites.map(name => `tests/${name}`)]],
    ['visual', 'themes', ['tests/theme-audit.mjs']],
    ['visual', 'ui', ['tests/ui-audit.mjs', '--label=ci']],
    ['visual', 'menu', ['tests/menu-audit.mjs', '--label=ci']],
    ['visual', 'cards', ['tests/card-faces.mjs', '--label=ci']],
    ['playthroughs', 'smoke', ['tests/smoke.mjs']],
    ['playthroughs', 'release', ['tests/release.mjs']]
].filter(([g]) => group === 'all' || g === group);
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const report = {
    commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']),
    node: process.version, group, started: new Date().toISOString(), results: []
};
const out = path.join(ROOT, 'test-results', 'verification', group);
fs.mkdirSync(out, { recursive: true });
console.log(`Verifying ${report.commit}${report.dirty ? ' (working tree has changes)' : ''} [${group}]`);
for (const [, name, args] of plan) {
    console.log(`Running ${name}: node ${args.join(' ')}`);
    const log = path.join(out, `${name}.log`);
    const fd = fs.openSync(log, 'w');
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    const row = { name, args, exitCode: result.status, signal: result.signal,
        error: result.error?.message, durationMs: Date.now() - started, log: path.relative(ROOT, log) };
    report.results.push(row);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name} (${row.durationMs} ms), ${row.log}`);
}
report.completed = new Date().toISOString();
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(report.results.every(row => row.exitCode === 0) ? 0 : 1);
