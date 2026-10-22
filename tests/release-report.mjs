#!/usr/bin/env node
// Generates an evidence index; never claims that stale artifacts tested the current commit.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from './lib/harness.mjs';
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:ROOT}).trim();
const read=file=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));}catch{return null;}};
const verification=read('test-results/verification/all/results.json');
const browser=read('test-results/cross-browser/results.json');
const soak=read('test-results/soak/results.json');
const lines=[`# Release verification: ${commit}`,`Generated ${new Date().toISOString()}.`,
`\nSource baseline before this release hardening: 2123c128ad0b7d32033fe6d0dc24603cc8913844. No merge or deployment performed.`,
`\n## Complete command`, '`npm ci --no-audit --no-fund && npx playwright install --with-deps chromium firefox webkit && npm run verify`',
`\nEnvironment-specific browser installation details and coverage limits: [RELEASE.md](../RELEASE.md).`,
`\n## Actual results`];
if(verification?.commit===commit){
 lines.push(`Tested tree dirty: ${verification.dirty}. Started ${verification.started}; completed ${verification.completed || 'INCOMPLETE'}. Node ${verification.node}.`, '\n| Check | Result | Seconds | Log |','|---|---|---:|---|');
 for(const r of verification.results)lines.push(`| ${r.name} | ${r.exitCode===0?'PASS':'FAIL'} | ${(r.durationMs/1000).toFixed(1)} | [log](${r.log.replace('test-results/','')}) |`);
} else lines.push('No complete verification artifact for this commit. Older results are not a pass.');
lines.push('\n## Browser engines');
if(browser?.commit===commit)for(const r of browser.results){lines.push(`- ${r.engine}/${r.profile||'launch'}: **${r.status}** ${r.version||''}${r.error?` — ${r.error.split('\n')[0]}`:''}`);for(const shot of (r.screenshots||[]))lines.push(`  - [${shot}](cross-browser/${shot})`);}else lines.push('No current-commit browser results.');
lines.push('\n## Real-time cleanup soak');
if(soak?.commit===commit){lines.push(`**${soak.status}**, seed ${soak.seed}, ${soak.cycles.length} cycles, ${soak.completions||0} natural match completions. ${soak.error||''}`, '\n| Cycle | Heap bytes after GC | DOM nodes / native listeners | Active timeouts / intervals / frames | Connected audio / live sources | Frame p95 ms |','|---|---:|---|---|---|---:|');for(const [i,r]of soak.cycles.entries())lines.push(`| ${i+1} | ${r.heapBytes} | ${r.nodes} / ${r.jsEventListeners} | ${r.timeouts} / ${r.intervals} / ${r.frames} | ${r.audio.connected} / ${r.audio.liveSources} | ${r.frameMs.p95.toFixed(2)} |`);lines.push('[Full measurements](soak/results.json) including frame maxima, source stop/ended counts and cycle screenshots.');}else lines.push('No current-commit soak results.');
lines.push('\n## Resolved failures and local blockers', 'Priority eviction previously removed only voice bookkeeping; stopAll restored gain over still-live sources. Source ownership now stops/disconnects real nodes. Stopping music also cancels its prior fade. Native WebKit playbin2 hung pausing looping MP3s even without game code; Linux checks explicitly use the native playbin3 pipeline. Root dependency installation was unavailable, so this local run used extracted libraries; Firefox required execution outside the outer tool sandbox. These diagnostics are not counted as passing checks. See RELEASE.md for exact setup.', '\n## Remaining limits and real-phone gate','Desktop engine emulation cannot certify speakers, haptics, OS interruptions or mobile Safari. Complete the [phone checklist](../RELEASE.md#real-phone-checklist) before release. Memory figures are post-GC JavaScript heap and DOM/native listener counters, not OS resident memory. Frame samples are headless real time, not device GPU benchmarks. Lifecycle freeze is real CDP; visibility events are explicitly synthetic. Offline rendered waveforms and actual node ownership prove software behavior, not audible device quality.', '\n## Rollback','No deployment exists to roll back. To undo this local hardening without rewriting history, inspect `git log --oneline 2123c12..HEAD`, then revert those commits newest first on a new branch. To roll back a future release, serve the previously approved static artifact atomically; preserve browser saves and export raw profile/achievement/preference storage first. Do not reset progress or delete storage. Save format and economy are unchanged; see PROGRESSION.md for existing multi-key crash limitations.');
fs.mkdirSync(path.join(ROOT,'test-results'),{recursive:true});fs.writeFileSync(path.join(ROOT,'test-results/RELEASE.md'),lines.join('\n')+'\n');console.log('Release evidence: test-results/RELEASE.md');
