# Release hardening

Run with Node 22+ from a clean checkout. Test dependencies and their transitive versions are committed in
`package-lock.json`; CI uses `npm ci`. The game still has no build step or runtime npm dependencies.

```sh
npm ci --no-audit --no-fund
npx playwright install --with-deps chromium firefox webkit
npm run verify
```

The complete command runs catalog and every root test suite, theme/contrast/UI/menu/card audits,
desktop/mobile smoke and release playthroughs, all three engines, and the real-time cleanup soak.
It continues after failures and exits nonzero if any command fails. Logs and exact HEAD/dirty metadata
are in `test-results/verification/all/results.json`. The generated `test-results/RELEASE.md` indexes
current-commit results, screenshots, measurements and rollback instructions. A missing engine is
**BLOCKED** in browser JSON and fails the command; it is never a pass. Do not reuse artifacts from
an earlier commit as release evidence. `npm run cross-browser -- --engine=webkit` runs one engine;
`npm run verify -- --group=soak` repeats the soak independently.

CI runs five groups: logic, visual, playthroughs, the three-engine matrix, and soak. Browser matrix
jobs install their engine with system dependencies and fail on missing/failed launch. Artifacts
upload even after failure. Repository branch protection must require `Browser (chromium)`,
`Browser (firefox)`, `Browser (webkit)` and `Real-time soak` as well as existing verification jobs;
workflow files cannot configure server-side branch protection.

## What is measured

The cross-browser runner boots using the actual start/skip buttons, chooses every shipped theme,
browses collection and inspection, opens all 150 achievement entries, sets up a battle, pauses and
changes settings, completes a natural AI turn, selects and confirms combat, buys/rips/navigates a
pack, rotates a phone viewport, simulates layout zoom and reloads saved progress. Combat positioning
is an explicit fixture; actions use real controls. Phone viewports are desktop engines with touch
capability, not device certification. Themes are selected in portrait; short landscape intentionally
hides menu introduction utilities. Pause settings remain available during battles.

`release.mjs` additionally covers fresh and previous-release profiles, all 15 deck combinations,
scripted UI wins/losses and once-only rewards, then a seeded 50-turn deterministic performance match.
`soak.mjs` uses seed **20261022**, the committed previous-release save, real clocks and three cycles:
all themes → eight natural turns (land plays/taps/end turn) → natural defeat/rematch as needed →
quit → immediate new battle/quit → 40-credit land-pack purchase/reveal/summary/close → cleanup.
No economy or combat-state fixtures are applied in the real-time soak. CDP freeze/restore is real;
visibility events are synthetic because headless automation cannot reproduce OS app switching.

Each cleanup samples post-GC JS heap, native DOM nodes/listeners, live DOM size, pending timeouts,
intervals and animation frames, and 120 real-time frame intervals (median, p95, maximum). The first
completed cycle is the warmed baseline; assertions bound later growth. These are finite regression
budgets, not proof of unbounded-session leak freedom or measurements of OS/GPU memory. Audio probe
records primitive counters and weak node identities, so it does not retain AudioNodes.

The independent Web Audio probe observes actual node creation, connections, source start/stop and
ended events. Regression tests fill the eight-cue budget, force priority eviction, stop pending
future notes, restore gain and wait through the old tail. Only the three persistent bus nodes may
remain connected. Natural completion must release source/filter/envelope nodes. Offline cue tests
check actual rendered peak and duration; headless runs cannot certify speaker quality.

The resilience fixture removes vibration and Web Audio support, aborts real font/media requests,
then starts a battle and completes a UI turn. Theme audits cover contrast (axe plus measured
foreground/background samples), keyboard focus and reduced motion. Layout zoom is represented by
shrinking the CSS viewport, as browser zoom does; root `style.zoom` leaves viewport units unchanged
and is not used as a substitute. Existing stabilization tests include Chromium pinch-scale checks.

## Local browser installation in this workspace

Pinned downloads succeeded. System dependency installation via `playwright install-deps` could not
obtain root (`su: Authentication failure`). For local WebKit only, Debian trixie packages were
downloaded with a workspace-local apt index, extracted under `/workspace/browser-libs/root`, and
both downloaded MiniBrowser wrappers were amended to preserve the incoming `LD_LIBRARY_PATH`.
Required extra packages: libgtk-4-1, libgraphene-1.0-0, libwoff1, libharfbuzz-icu0, libhyphen0,
libmanette-0.2-0, libgles2, libcairo-script-interpreter2, libhidapi-hidraw0, liblzo2-2.

The local verification invocation uses:

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers \
LD_LIBRARY_PATH=/workspace/browser-libs/root/usr/lib/x86_64-linux-gnu \
XDG_CACHE_HOME=/workspace/.cache \
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npm run verify
```

The last variable bypasses the system `ldconfig` preflight, which cannot see extracted libraries;
actual launches and UI checks still must succeed. It is not used in CI. Linux WebKit checks explicitly
select the native GStreamer playbin3 pipeline. The default legacy playbin2 pipeline hangs in native
`HTMLMediaElement.pause()` for a looping MP3 on this host, also reproduced without game code;
non-looping MP3 pause and playbin3 looping pause pass. This selection keeps real decoding, looping,
media controls and Web Audio active. It is recorded in browser JSON and also applies in CI.
The app does not contain a platform-specific media workaround. Stopping a music track does now
cancel any pending fade, so an old transition cannot alter a later session.
Firefox requires execution
outside the outer tool sandbox so its own content-process sandbox can initialize. Browser sandboxing
and TLS verification are not disabled. Chromium uses the previously authorized proxy CA trust DB.
Any later machine without these libraries or permissions must report blocked checks and exit nonzero.

## Real-phone checklist

Record OS/browser/device, commit and results on at least iOS Safari and Android Chrome:

- Start fresh and reload an existing save. Inspect a card; win, lose, rematch, buy and close a pack.
- Listen to every cue at low/high volume and rapid input. Check no distortion, excessive overlap or
  old victory/pack tails returning after mute/unmute, quit, interruption or a new match.
- Check haptics with permission/support present and absent, setting off, reduced motion and silent
  mode. AI actions must not produce player action buzzes; achievement notices have their own cue.
- Receive a call, switch apps, lock/unlock and reconnect headphones/Bluetooth during an AI delay,
  pause, pack reveal and result. Resume once; no stale overlay, extra turn or duplicate reward.
- Rotate during sealed/reveal/summary, use browser text/page zoom and pinch. PREV/NEXT, return,
  summary and close must remain reachable above browser toolbars and safe-area insets.
- Use an external keyboard or accessibility navigation: visible focus, Escape returns focus,
  modal focus stays inside, and all themes remain readable outdoors/high contrast.
- Reload after purchases, achievements, deck edits and preference changes; preserve credits/cards.
  A second tab must explain read-only status instead of overwriting the first tab.

No physical device was attached here; this checklist remains a release gate.

## Rollback

No merge or deployment is part of this task. To undo local hardening, inspect
`git log --oneline 2123c12..HEAD` and revert those commits newest first on a new branch. Preserve
uncommitted work. For any future deployment, serve the previously approved static artifact atomically.
Export raw profile, achievement and preference storage first; never clear player saves to roll back.
This change does not alter save versions, rules, pack prices or rewards. Existing storage limits
(including lack of an atomic transaction across profile and achievement keys) remain in PROGRESSION.md.
