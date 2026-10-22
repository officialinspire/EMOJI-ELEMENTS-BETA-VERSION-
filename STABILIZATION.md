# Codex stabilization

The stabilization branch starts at `02a5534` (`origin/claude/audio-feedback`). It contains main
`397089f`, visual themes `4b19811`, battle/pause work through `bd84c8c`, and audio feedback
`856ff08` through their existing ancestry. No feature commits were replayed.

Present: Arcane Fantasy, Deep Space and Neon Sci-Fi themes, saved theme selection, real battle pause,
AI delay suspension, board feedback, synthesized sound effects, separate audio settings and guarded
haptics. No achievement system or achievement branch/commit was found in the fetched remote heads;
the audio engine has an achievement cue, and a future-save fixture mentions achievements, but those
are not an achievement feature. The starting checkout had no uncommitted changes or AGENTS.md.

## Reproductions and fixes

At 568×320, the pack reveal's PREV/NEXT row extended below the viewport. The regression checks
actual button bounds and hit testing before any automatic scrolling. The panel now keeps its header
and controls outside the scrolling card details/summary list. All five cards, PREV/NEXT, summary,
return and close remain usable across phone landscape/portrait transitions and a 200% layout-zoom
viewport. Each new card resets its detail scroll. Pack surfaces allow pinch zoom. Tests use mobile
Chromium emulation, including a CDP pinch-scale check; this does not establish real-device coverage.
Screenshots are written under `test-results/stabilization/`.

The original remaining-delay assertion passed on a fast host but failed with an inserted 500 ms
host delay: Playwright `clock.install()` continues ticking between protocol calls. This was test
timing, not evidence of a pause defect. The corrected test calls `pauseAt` before scheduling the
AI turn, pauses with exactly 1000 ms remaining, advances 30 seconds while paused, and verifies
that resume waits through 999 ms and fires at 1000 ms. An intentional host delay verifies that
wall time cannot move this boundary. No assertions were removed and game pause logic is unchanged.

The aggregate run also exposed a focus race in the paused-board test: Space can correctly activate
the focused RESUME button. The test now waits for modal focus and blurs that button before sending
board shortcuts. A separate test verifies that both Space and Enter on RESUME resume the same
match without advancing its turn. Board snapshot and direct-call guards remain asserted. All battle scenarios now stop the fake
clock before starting a match, also preventing the AI marker's render frame from racing with host
time. The full 15-test battle suite passed three diagnostic runs, including two concurrent runs,
with no game timer or rendering assertions bypassed.

The release runner also referenced the removed `isMuted` global from before the audio settings
change. It now reads `soundSettings.muted` and keeps the existing header-icon and saved-profile
assertions on reload.

## Full Chromium verification

From the checkout, with Node 22+:

```sh
npm install --package-lock=false --no-audit --no-fund
npx playwright install --with-deps chromium
npm run verify
```

`verify` runs the card audit, every `tests/*.test.mjs` suite (two files at a time), all themes and
viewport profiles, UI/menu/card audits, desktop/mobile smoke, and release playthroughs including
the long-match check. It continues after failed commands and exits nonzero if any command fails.
It overwrites per-command logs and `results.json` under `test-results/verification/all/`, recording
full HEAD SHA, dirty status, Node version, commands, exit codes, signals and run times. Individual
runners retain their own detailed JSON and screenshots. Consult current-run logs for test counts;
a successful process launch is not a test pass.

CI uses the same plan in three groups:

```sh
npm run verify -- --group=logic
npm run verify -- --group=visual
npm run verify -- --group=playthroughs
```

The rules job covers catalog, gameplay, saves, battle, audio and pack stabilization.
The UI job includes the theme audit; the playthrough job includes smoke and release. Each uploads
results even when checks fail. `npm run cross-browser` (requires Firefox/WebKit too) and the larger
`npm run ai:sim` statistical sample are optional additional coverage, outside this Chromium gate.
There is no build step or application server dependency; runners serve the checkout themselves.

In the onboarding machine, Playwright's bundled Chromium download and Google Fonts were blocked
by network policy. The installed system Chromium can be selected with the environment-local
launcher provided during setup:

```sh
NODE_OPTIONS=--require=/workspace/emoji-elements-setup/system-chromium.cjs npm run verify
```

This tests system Chromium 154 rather than bundled Chromium 141. It does not hide failed network
requests or establish parity with the bundled browser. Fonts require `fonts.googleapis.com` and
`fonts.gstatic.com`; bundled browser installation requires `cdn.playwright.dev` and
`playwright.download.prss.microsoft.com`. Network-blocked checks must remain failed until access
is available and the affected command is rerun. No merge, deployment or publication is part of
this stabilization task.

## Gameplay determinism and match teardown

`npm run determinism` runs stopped-clock action sequences against the real browser game.
It compares opening decks/hands, legal card plays and draws, easy AI attack choices,
a random-target spell and the awarded pack across sound/haptics, themes and reduced motion.
Extra previews, card inspection, rendering, particles and ID allocation leave the gameplay
stream and authoritative state unchanged. `setGameplaySeed(uint32)` resets the gameplay
stream for a replay; it is runtime state, not a new save format. Production seeds that stream
once on page load. Cosmetic/audio randomness and monotonic instance IDs cannot advance it.
Identical actions must include the same gameplay operations (including opening purchased packs).

Match timers carry a match serial. Completion, abandonment and replacement cancel them,
particles and pending decorative spawns together. Startup debounce belongs to that scope.
Page restoration deliberately keeps the match paused until RESUME. The watchdog does not
release a paused action lock. Terminal draws also stop the current synchronous turn pipeline.

Focused verification (Playwright Chromium installed):

```sh
node --test --test-concurrency=2 tests/rules.test.mjs tests/combat.test.mjs tests/ai.test.mjs tests/feedback.test.mjs tests/battle.test.mjs tests/regression.test.mjs tests/effects.test.mjs tests/audio.test.mjs tests/determinism.test.mjs
npm run smoke
```

The first command uses controlled clocks for correctness; smoke uses real browser time on
desktop and mobile emulation. `npm run verify` automatically includes the new regression
file in the logic CI job. The teardown regression counts outstanding timeouts, intervals,
frames and global listener registrations relative to the initialized page. Finite audio fades
and detached-node CSS cleanup get three seconds to settle. This checks scheduling and
listener balance, not garbage collection or an operating-system memory profile. Physical
phone haptics and background suspension still need device testing.

## Persistence and achievement integration

The earlier baseline's missing-achievements note is historical. The existing implementation
from `c7ef846` is now integrated, with upstream fixes `dd66838` and `8c0ca46`. It has exactly
150 definitions. See [PROGRESSION.md](PROGRESSION.md) and [ACHIEVEMENTS.md](ACHIEVEMENTS.md)
for single-writer storage, backup-before-repair, retry behavior, QA isolation and documented
crash-window limits. `npm run persistence` runs the focused hardening checks; the full logic
CI command automatically includes both new hardening suites and the imported achievement suite.
