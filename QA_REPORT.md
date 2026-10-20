# EMOJI ELEMENTS: Release QA Report

**Build under test:** branch `claude/compassionate-albattani-aabox6`. It carries the eight QA passes (listed below)
plus the release-QA commit that adds this report. `main` (`4b0cd49`) is unchanged: nothing has been merged or
deployed.

**Verdict:**
- **Release candidate.** Every automated suite, and every browser playthrough below, passes in **Chromium** at
  desktop, phone and tablet sizes.
- **Not fully verified:** real iPhone/iPad (Safari/WebKit), real Android devices, Firefox, Samsung Internet,
  screen readers, real audio output, and the H.264 intro video could not be tested here (§3). Run those before
  calling the build verified.

Environment: Playwright 1.56.1, Chromium 141.0.7390.37 (headless), Linux container. Phone and tablet use Chromium
device emulation with touch input; they are not real devices.

## 1. Release checklist

Legend: ✅ pass · ❌ fail · ⛔ blocked (couldn't be run here).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Card catalog and manifest check | ✅ | `npm test`: catalog checks passed (268 cards) |
| 2 | Rules, combat, effects, progression and AI suites | ✅ 337 / 337 | `node --test tests/{rules,combat,progression,effects,ai}.test.mjs` |
| 3 | Smoke flows, desktop 1280×800 and Pixel 7 (touch) | ✅ 204 pass, 0 fail, 0 known defects | `npm run smoke` |
| 4 | Layout, touch, keyboard and accessibility at 360×740, 863×360, 712×1138 and 1366×768, plus reduced motion and autoplay | ✅ 469 / 469 | `npm run ui`; axe-core: 0 violations on 17 screens × 4 sizes ([UI.md](UI.md)) |
| 5 | Fresh-profile playthrough through the real UI: desktop (mouse) and mobile (touch) | ✅ | `npm run release`: 23 checks each |
| 6 | Existing-save playthrough (a save from the previous release): desktop and mobile | ✅ | Credits, stats and collection kept; the one-time FIRE_SWAMP starter migration keeps the exact old save as a backup; a reload writes no new backup |
| 7 | A win and a loss | ✅ | Win: an attack through the UI, then rewards (+25, +1 win). Loss: END TURN, then the AI's attack (+10, +1 loss). Both on desktop and mobile. |
| 8 | Each deck identity | ✅ 15 / 15 × 4 playthroughs | Started through NEW GAME. Each plays exactly its saved 60-card deck, on colour. |
| 9 | Representative cards: every type | ✅ | Through the UI: land (play, tap ×5), creature, instant (Fireball resolves once), artifact (unaffordable → details) |
| 10 | Every keyword | ✅ | Combat table: 31 scenarios × player and AI attacking; flash documented as having no effect ([RULES.md](RULES.md) §8) |
| 11 | Every spell and artifact effect | ✅ | All 70 effect cards cast by the player and by the AI ([EFFECTS.md](EFFECTS.md)) |
| 12 | Pack purchase and free reward | ✅ | Shop: charged 60 once, 5 cards. Win reward: OPEN BOOSTER, rip, 5 cards, collection +5, packs opened +1. |
| 13 | Save / reload | ✅ | Credits, collection, wins, losses, packs opened and mute survive a reload |
| 14 | Mute / audio | ✅ automated · ⛔ audible output | Mute mutes every sound, is saved and announced (`aria-pressed`). All 21 sound files and the intro video are served (200). Nothing plays before the first tap. Whether sound is actually heard can't be checked headless. |
| 15 | Pause / quit | ✅ | ☰ → MAIN MENU → YES, 15 times per playthrough; Esc pauses and resumes (UI audit) |
| 16 | Reset | ✅ | RESET STATS (wins/losses 0, collection kept); RESET PROGRESS (new profile, old one kept as a backup) |
| 17 | Console errors | ✅ | 0 page errors and 0 console errors in all playthroughs. Two warnings found and fixed in this pass (§2). |
| 18 | Broken asset requests | ✅ | 0 responses with 4xx/5xx; Google Fonts loaded. Chromium's routine media range re-requests (`net::ERR_ABORTED` on .mp3/.mp4) are not broken files. Added a favicon link. |
| 19 | Duplicate actions | ✅ | Pressing CONFIRM, OPEN BOOSTER, a shop pack or END TURN twice acts once. Tap/long-press never fires twice (UI audit). |
| 20 | Accessibility | ✅ automated · ⛔ screen readers | axe-core 0 violations; full keyboard play; dialogs trap and restore focus; names and states announced. VoiceOver/TalkBack not available. |
| 21 | Responsive layout | ✅ emulated · ⛔ real devices | 4 sizes, no overflow or clipping; phone landscape playable |
| 22 | Long-match performance | ✅ | 50 turns, 80 permanents in play. Heap after GC 1.6 → 1.7 MB; DOM 440 nodes; no lingering effects; ~44 ms script + layout per late turn. Listeners grow with board size (≈ 4 per permanent), not per turn. |
| 23 | QA-only behaviour off in production | ✅ | `QA_MODE` is off unless `?qa=1`. Production console has no `[QA]` lines and `window` has no `__qa*` helpers (checked in every playthrough). The smoke suite keeps them with `?qa=1`. |
| 24 | Docs reconciled with the shipped game | ✅ | README, QUICK-START, CHANGELOG and this report (§5) |
| 25 | AI: rule parity, stalls, loops | ✅ | 45-match sanity sample: 0 violations, 0 errors, 0 stalls. Measured 360-match sample in [AI.md](AI.md). |
| 26 | iPhone / iPad Safari (WebKit) | ⛔ | Only Chromium is installed here |
| 27 | Android Chrome / Samsung Internet on a device | ⛔ | No device; emulation only |
| 28 | Firefox (desktop and Android) | ⛔ | Not installed |
| 29 | Installed PWA (Add to Home Screen) | ⛔ | Needs a device |
| 30 | CI on the release commit | see the commit's GitHub Actions runs | Workflows: card catalog, rules/combat/progression/effects/AI, UI audit |
| 31 | Merge / deploy | not done | Waiting for the owner's instruction |

## 2. Found and fixed in this release pass

| Issue | Severity | Fix |
|---|---|---|
| QA mode shipped on: `[QA]` logs every match, error echoing, perf/DOM checks, and `window.__qa*` helpers for players. `__qaDeckBuilderSmoke` overwrites a saved deck if called. | Medium | `QA_MODE` is opt-in with `?qa=1` or `localStorage.emojiElementsQA = '1'`. Helpers and logs are gated. Blocked-autoplay messages are `console.debug`. |
| The AI turn's 12 s failsafe kept running after an AI turn that ended the match, then logged "Emergency turn transition triggered" in every AI win. | Low (harmless, but a leaked timer) | A stale AI turn cancels the failsafe, and the failsafe ignores finished matches |
| Skipping the intro interrupted `play()`; the game then retried muted and kept the intro video playing hidden in the background | Low | No retry once the intro has been skipped |
| No favicon link, so browsers request a missing `/favicon.ico` | Low | `<link rel="icon" href="icon.svg">` |
| QUICK-START said "no intro video", "no audio files needed", "150+ cards", "FIXES.md", "based on emoji-elements.html" | Low (docs) | Rewritten to match the game |

## 3. Remaining issues, by severity

**Verification gaps (block "fully verified"):**
1. **iOS Safari / WebKit not tested.** That leaves untested: long-press behaviour and the callout, the
   landscape layout with the notch, `100dvh`, autoplay with the ringer off, and PWA install. iOS also ignores
   the SVG-only manifest icons, so there's no home-screen icon.
2. **Real Android hardware, Firefox and Samsung Internet not tested.** That leaves untested: Pointer Events
   timing, haptics, and pull-to-refresh during swipes.
3. **Screen readers and audible sound not tested.**

**Gameplay and balance (design decisions, not defects):**

4. **Medium:** the FIRE starter is much stronger than the others against the AI: the AI wins 33% vs about 60%
   on average ([AI.md](AI.md) §4).
5. **Medium:** Hard AI wins 70% against the reference bot; it may be too strong for casual players
   ([AI.md](AI.md) §6).
6. **Medium:** Alien and Robot packs contain no alien or robot cards ([CARD_AUDIT.md](CARD_AUDIT.md),
   decision A).
7. **Low:** the Flash keyword (9 creatures) has no effect (RULES.md C15).
8. **Low:** spells pick random targets, and blocking is automatic for both sides (EFFECTS.md E2, RULES.md R5.4).
9. **Low:** open economy choices: a pack on every win, guaranteed rare + epic slots, no duplicate protection
   ([PROGRESSION.md](PROGRESSION.md) §8).
10. **Low:** `emoji-elements.html` (the old single-file version) is still in the repo and reachable at its URL.
    It isn't linked, but it shares the `emojiElementsStats` key. Recommend moving it to `legacy/` or deleting
    it.
11. **Low:** duplicate card names (Signal Tower, Chrono Watch), and Crystal Wasteland is legal in no deck
    (CARD_AUDIT.md D, H).
12. **Cosmetic:** the AI's unspent mana stays visible during your turn.

## 4. Commits on the branch

| Commit | Pass |
|---|---|
| `2065c86` | QA baseline and repeatable desktop/mobile smoke tests |
| `0096b58` | Card catalog audit, unusable-card fixes, catalog regression check |
| `766867a` | Turn and resource rules, deterministic rules suite |
| `8fe4d17` | Combat rules and keywords, combat suite |
| `2faa5cd` | Progression and saved data: repair instead of wipe, backups |
| `e593295` | Spell and artifact effects, effects suite |
| `0025386` | Phone/tablet/desktop interaction, UI audit with before/after evidence |
| `4d67aa3` | AI rule parity and decisions, seeded AI simulation |
| release-QA commit | QA mode off in production, failsafe and intro fixes, favicon, release playthroughs (`tests/release.mjs`), this report, docs |

No pull request has been opened for this branch. The repository's previous PRs (#112–#116) are closed.

## 5. Docs reconciled

- **README:**
  - fixed a bullet misplaced under the AI difficulty line;
  - the QA helper now notes `?qa=1`;
  - added a Testing section listing every suite;
  - the roadmap no longer lists the dual decks, which all ten pairings now have.
- **QUICK-START:** rewritten to match the shipped game: 268 cards, 15 decks, intro and sound, the controls
  including keyboard, and house rules.
- **CHANGELOG:** a player summary at the top, then one entry per pass.
- **QA_REPORT:** now this release report (it previously pointed to QA_BASELINE).
- **QA_BASELINE:** D8 is now fully fixed, and QA helpers are noted as needing `?qa=1`.

## 6. Reproduce

```bash
npm install && npx playwright install chromium
npm test && npm run rules && npm run combat && npm run effects && npm run progression && npm run ai
npm run smoke && npm run ui && npm run release      # browser playthroughs; screenshots in test-results/
npm run ai:sim                                       # measured AI sample (~5 min)
```
