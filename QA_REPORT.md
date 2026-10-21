# EMOJI ELEMENTS: Release QA Report

**Repository state (2026-10-21):**
- **`main`** is at `c2aba7a`, the merge of PR #117 (2026-10-20, on the owner's instruction). It holds the eight QA
  passes and the release-QA pass (`ea286e4`, `e1e8dbc`). Whatever GitHub Pages serves comes from `main`.
- **Branch `claude/compassionate-albattani-aabox6`** is `main` plus the commits in §4 that are **not merged or
  deployed**:
  - menu refresh;
  - card presentation;
  - Collection and Deck Builder;
  - gameplay feedback;
  - Pack Shop and pack opening;
  - this cleanup and final regression pass (§2).

**Verdict for the branch:**
- **Release candidate in Chromium.** Every automated suite and every browser playthrough below passes in
  Chromium at phone, phone-landscape, tablet and desktop sizes.
- **Not fully verified:**
  - Firefox and WebKit (Safari's engine) are not installed here, so `npm run cross-browser` reports them as
    NOT TESTED;
  - not tested on real phones or tablets: iPhone/iPad, Android, Samsung Internet, the installed PWA;
  - not tested with screen readers, real audio output, or the H.264 intro video.

  Run those before calling the build verified (§3).

**Environment:** Playwright 1.56.1, Chromium 141.0.7390.37 (headless), Linux container. Phone, tablet and
landscape sizes use Chromium device emulation (viewport, touch, device scale); **this is browser emulation, not
real-device testing.**

## 1. Release checklist

Results for branch commit `3769c6f` (code) on 2026-10-21. Legend: ✅ pass · ❌ fail · ⛔ blocked (couldn't be
run here).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Card catalog and manifest check (with pack membership) | ✅ | `npm test`: catalog checks passed (268 cards) |
| 2 | Rules, combat, effects, progression, AI, Collection, gameplay feedback and pack suites | ✅ 419 / 419 | rules 30, combat 78, effects 169, progression 27, AI 33, collection 11, feedback 55, packs 16 |
| 3 | Final regression suite (this pass) | ✅ 11 / 11 | `npm run regression` (§2) |
| 4 | Smoke flows, desktop 1280×800 and Pixel 7 (touch) | ✅ 204 / 204 | `npm run smoke` |
| 5 | Layout, touch, keyboard and accessibility at 360×740, 863×360, 712×1138 and 1366×768, plus reduced motion and autoplay | ✅ 469 / 469 | `npm run ui`; axe-core 0 serious violations |
| 6 | Menus and battle setup, card faces | ✅ 289 / 289 · 95 / 95 | `npm run menu`, `npm run cards:ui` |
| 7 | Screens with axe including contrast: feedback, Pack Shop, Collection | ✅ no page errors or serious violations | `npm run feedback:shots`, `packs:shots`, `collection:shots` at desktop, phone and phone-landscape |
| 8 | Fresh-profile and existing-save playthroughs through the real UI, desktop (mouse) and mobile (touch), plus a 50-turn long match | ✅ 97 / 97 | Four playthroughs with 23 checks each, plus the long match: 50 turns, 28+40 permanents, heap after GC 1.7 → 1.9 MB, listeners 229 → 394 (they follow board size), 38 → 47 ms script+layout per turn, no lingering effects. Run on the code commit in a clean worktree. | `npm run release` |
| 9 | A win and a loss | ✅ | In the release playthroughs: win +25 and a pack, loss +10, on desktop and mobile |
| 10 | Each deck identity | ✅ 15 / 15 × 4 playthroughs | Each plays exactly its saved 60-card deck |
| 11 | Every keyword, spell and artifact effect | ✅ | Combat table for both sides; all 70 effect cards cast by the player and the AI |
| 12 | Combat preview = real combat | ✅ | 42 hand-made scenarios plus lethal (`npm run feedback`), and 40 random boards (`npm run regression`) |
| 13 | Pack membership, odds, purchases and rewards charged once | ✅ | `npm run packs`; membership matches the manifest (`npm run regression`) |
| 14 | Save / reload, fresh and existing profiles | ✅ | Release playthroughs, progression suite, and `regression` (both profiles: menus, a purchase, a match; save keys unchanged) |
| 15 | Keyboard-only play | ✅ | UI audit, plus a whole turn by keyboard in `regression` (Tab, Enter plays, A, Enter selects, A confirms, Space ends) |
| 16 | Reduced motion | ✅ | UI audit and `regression`: no particles, no turn pulse, no reveal transitions |
| 17 | Portrait ↔ landscape changes | ✅ emulated | `regression`: 360×740 ↔ 740×360 ↔ 915×412 mid-match, mid-attack and mid-reveal; no sideways overflow, controls reachable, focus kept |
| 18 | Leaving or restarting a match | ✅ | No timers or UI updates after quitting, rows emptied, listeners back to the menu baseline, animation frames 0 in menus (§2) |
| 19 | Match history bounded | ✅ | 80 entries over a 31-turn match; resets with a new match |
| 20 | Console errors and broken requests | ✅ | 0 page errors in every run; release playthroughs check 4xx/5xx and QA-only output |
| 21 | Duplicate actions | ✅ | CONFIRM, OPEN BOOSTER, a shop pack, END TURN and Enter in dialogs act once |
| 22 | Mute / audio | ✅ automated · ⛔ audible output | Can't hear sound headless |
| 23 | Accessibility | ✅ automated · ⛔ screen readers | axe-core, keyboard, dialog focus; VoiceOver/TalkBack not available |
| 24 | QA-only behaviour off in production | ✅ | Checked in every release playthrough |
| 25 | Chromium | ✅ | Every row above, plus `npm run cross-browser`: 20 / 20 |
| 26 | Firefox | ⛔ NOT TESTED | Not installed; `npm run cross-browser` reports it as not tested |
| 27 | WebKit (Safari's engine) | ⛔ NOT TESTED | Not installed. Even when installed, Playwright's WebKit on Linux is not iOS Safari. |
| 28 | Real iPhone/iPad, Android phones, Samsung Internet, installed PWA | ⛔ | No devices here; only Chromium emulation (§3) |
| 29 | CI on the branch head | see the commit's GitHub Actions runs | Workflows: card catalog, the node suites (now with feedback, packs and regression), UI audit |
| 30 | Merge / deploy of the branch | not done | Waiting for the owner's instruction. The release pass is already on `main` via PR #117. |

## 2. Cleanup and final regression pass (`3769c6f`)

Public functions, DOM ids, test hooks, script order and saved data are unchanged.

### Obsolete CSS removed

`styles.css` went from 6,586 to 6,408 lines:
- **Unused rules:** `.card-stack`, `.stack-count`, `.stack-count-enemy`, `.show-tap-all`, `.loading` and
  `.juice-shake`. Their classes appear nowhere in the HTML or JS.
- **Fully overridden blocks:** two `min-width: 768px` blocks whose every declaration a later block of the same
  query overrides.
- **Superseded rarity styles:**
  - the old card rarity borders and the legendary pulse and halo, which the card-presentation pass replaced;
  - the `animation: none` and `content: none` that pass needed only to cancel them;
  - the two keyframes nothing uses any more.
- **Shop button gradients:** the per-theme Pack Shop button gradients and sizes, which the pack pass replaced
  with `#packShopGrid .shop-pack-btn`.

**How it was verified:** a computed-style fingerprint of 24 states, 12 screens at 1366×900 and at a phone size.
The screens are the menu, battle setup, Collection, Deck Builder, Pack Shop, What's inside, a crowded match,
attacker selection with preview, card details, match history, the pack reveal and the summary. It records 62
visual properties plus `::before`/`::after` for 14,830 elements. It is **identical** before and after the
removals. The fingerprint script is deterministic: two runs on the same code differ only in the test server's
port.

### Presentation code consolidated

- **One set of list-row styles:** the Collection, the Deck Builder and the Pack Shop's What's inside now share
  the rules for cost, power/toughness, inactive keywords and rarity colours. The pack pass had copied them, and
  the copy had missed the power/toughness chip.
- **Effect:** the fingerprint shows that only What's inside changed. Its P/T is now the same chip as in the
  Collection, and its rows are 1 px taller.
- **Evidence:** [docs/ui-evidence/final-contents-pt.jpg](docs/ui-evidence/final-contents-pt.jpg) (before
  `ccf16ec`, after).

### Measured results

| What | Before (`ccf16ec`) | After (`3769c6f`) |
|---|---|---|
| **Crowded board** (62 permanents, 12-card hand), time per `updateUI`, median / p95 (desktop, phone) | 14.4 / 28.0 ms, 12.7 / 22.8 ms | 12.6 / 17.8 ms, 13.5 / 21.7 ms |
| Script only (median); the rest is layout | 2.7 ms | 2.2 ms |
| Elements replaced per update | 70 (only the card rows) | 70 |
| Full rebuilds: attacking / one enemy turn | 1 / 6 | 1 / 6 |
| Board and hand scroll kept through an update; focused card kept | yes / yes | yes / yes |
| **Deck Builder** + and −: list scroll kept | yes | yes |
| Deck Builder + and −: keyboard focus | **lost (to the page)** | kept on the same card's button, or the row that took its place |
| Collection: sort and filters keep focus and scroll | yes | yes |
| **Animation frames per second in menus** | 13–60 (the particle loop never stopped) | **0** |
| Timeouts pending 3.5 s after quitting mid enemy turn | 0 | 0 |
| UI updates after quitting | **1** (a queued frame redrew the old hand into the hidden board) | 0 |
| **Event listeners in the menu** (after GC; 93 on a fresh load) | 183 after short matches, **645–689 after a 30-turn match** | **106** after any match |
| Intervals | 1 (the 15 s "stuck lock" safety check) | 1 (kept on purpose) |
| Match history after 31 turns | 80 (bounded) | 80 (bounded); resets with each match |

The crowded board needed no render change: about 13 ms per rebuild, mostly layout, a handful of rebuilds per
action, and scroll and focus survive. The release long match (§1 item 8) shows the same.

### Fixed

| Issue | Fix |
|---|---|
| Deck Builder + and − dropped keyboard focus to the page on every press | `captureDeckBuilderFocus`/`restoreDeckBuilderFocus` around the list rebuild |
| The particle loop cleared the full-screen canvas 60×/s forever, menus included | It runs only while particles are alive and stops itself (`startParticleLoop`) |
| Leaving a match left a UI update queued, which redrew the old hand into the hidden board; the old cards and their listeners stayed until the next match | `returnToMainMenu` cancels the queued update and empties the three card rows |

### New checks

- **`tests/regression.test.mjs`** (`npm run regression`, in CI) has 11 tests:
  - Deck Builder focus and scroll on + and −;
  - Collection filters combined, checked against the manifest;
  - **combat preview = result on 40 random boards for both sides** (life, deaths and each attacker's history
    line);
  - **pack membership = the committed manifest**, with every card in a pack and Lands holding only lands;
  - nothing runs or redraws after quitting mid enemy turn, the rows are empty, and history resets with a new
    match;
  - the particle loop idles;
  - history stays at 80 entries;
  - a whole turn by keyboard;
  - reduced motion;
  - portrait ↔ landscape changes;
  - fresh and existing profiles.
- **Against the previous commit `ccf16ec` it passes 7 of 11.** The four failures:
  - Deck Builder focus and quitting are the bugs fixed here;
  - the particle-loop and reduced-motion tests also fail there because they read the new
    `particleLoopRunning` flag. Reduced motion itself already behaved: it was checked by the UI audit.
- **`tests/cross-browser.mjs`** (`npm run cross-browser`) runs the main flows (menu, Collection, Pack Shop and
  What's inside, a crowded match with the attack preview, OPEN PACK and the summary) at desktop and phone size in
  **each installed engine**. Chromium passes 20 / 20. Firefox and WebKit are reported **NOT TESTED**: their
  Playwright builds aren't installed here. Install them with `npx playwright install --with-deps firefox webkit`.

### Screenshots

- [docs/ui-evidence/final-phone.jpg](docs/ui-evidence/final-phone.jpg): phone 360×740: menu, Collection, Deck
  Builder, Pack Shop, What's inside, attack with preview, match history, pack reveal, summary.
- [docs/ui-evidence/final-desktop-landscape.jpg](docs/ui-evidence/final-desktop-landscape.jpg): desktop match,
  attack with preview, Pack Shop, Deck Builder; phone landscape attack and pack reveal.
- [docs/ui-evidence/final-contents-pt.jpg](docs/ui-evidence/final-contents-pt.jpg): the one visible change.

All are Chromium emulation.

## 2b. Found and fixed in the release pass (`ea286e4`, merged in PR #117)

| Issue | Severity | Fix |
|---|---|---|
| QA mode shipped on: `[QA]` logs every match, error echoing, perf/DOM checks, and `window.__qa*` helpers for players. `__qaDeckBuilderSmoke` overwrites a saved deck if called. | Medium | `QA_MODE` is opt-in with `?qa=1` or `localStorage.emojiElementsQA = '1'`. Helpers and logs are gated. Blocked-autoplay messages are `console.debug`. |
| The AI turn's 12 s failsafe kept running after an AI turn that ended the match, then logged "Emergency turn transition triggered" in every AI win. | Low (harmless, but a leaked timer) | A stale AI turn cancels the failsafe, and the failsafe ignores finished matches |
| Skipping the intro interrupted `play()`; the game then retried muted and kept the intro video playing hidden in the background | Low | No retry once the intro has been skipped |
| No favicon link, so browsers request a missing `/favicon.ico` | Low | `<link rel="icon" href="icon.svg">` |
| QUICK-START said "no intro video", "no audio files needed", "150+ cards", "FIXES.md", "based on emoji-elements.html" | Low (docs) | Rewritten to match the game |

## 3. Remaining issues, by severity

**Verification gaps (block "fully verified"):**
1. **iOS Safari / WebKit not tested.** `npm run cross-browser` is ready to run WebKit once it's installed, but
   Playwright's Linux WebKit is still not iOS Safari. That leaves untested: long-press behaviour and the callout, the
   landscape layout with the notch, `100dvh`, autoplay with the ringer off, and PWA install. iOS also ignores
   the SVG-only manifest icons, so there's no home-screen icon.
2. **Real Android hardware, Firefox and Samsung Internet not tested.** Firefox can be covered by
   `npm run cross-browser` after `npx playwright install firefox`. That leaves untested: Pointer Events
   timing, haptics, and pull-to-refresh during swipes.
3. **Screen readers and audible sound not tested.**

**Gameplay and balance (design decisions, not defects):**

4. **Medium:** the FIRE starter is much stronger than the others against the AI: the AI wins 33% vs about 60%
   on average ([AI.md](AI.md) §4).
5. **Medium:** Hard AI wins 70% against the reference bot; it may be too strong for casual players
   ([AI.md](AI.md) §6).
6. ~~**Medium:** Alien and Robot packs contain no alien or robot cards ([CARD_AUDIT.md](CARD_AUDIT.md),
   decision A).~~ ✅ Resolved in the pack pass: explicit pack membership (CARD_AUDIT.md §7).
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
13. **Low (test sensitivity):** the release long-match check "event listeners don't accumulate" compares with
    turn 10, not with board size. A run whose board grows unusually large (124 permanents once, in the feedback
    pass) can cross it without a leak (UI.md §10).
14. **Low (balance):** the small Alien, Robot and Tech pack pools make their rarest cards frequent; Phantom Train
    (Legendary) is in half of all Tech packs (CARD_AUDIT.md §7).
15. **Low:** the Robot pack has only one Epic, so its last slot is Epic or Rare (documented, shown in the
    shop).

## 4. Commits

**On `main`** (merged in PR #117, `c2aba7a`):

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
| `ea286e4`, `e1e8dbc` | Release QA: QA mode off in production, failsafe and intro fixes, favicon, release playthroughs, this report |

**On the branch only (not merged, not deployed):**

| Commit | Pass |
|---|---|
| `e28488f`, `0349a65` | Main menu and battle setup refresh (UI.md §7) |
| `42040ff` | Card presentation (UI.md §8) |
| `401c99a`, `aa5c31a` | Collection and Deck Builder (UI.md §9) |
| `8e5098d`, `82612af` | Gameplay feedback: turn banner, AI status, attack preview, reasons, match history (UI.md §10) |
| `82a7085`, `ccf16ec` | Pack Shop and pack opening; explicit pack membership (UI.md §11, CARD_AUDIT.md §7) |
| `3769c6f` + docs | Cleanup and final regression (§2) |

No pull request is open for the branch's newer commits.

## 5. Docs reconciled

**In the cleanup pass:**
- **This report:** it said `main` was unchanged at `4b0cd49` and that no pull request had been opened. Both
  stopped being true when PR #117 merged the release pass. The header, checklist, commit table and reproduce
  steps now describe `main` (`c2aba7a`), the unmerged branch, and the current suites.
- **README:** the Testing table lists `regression` and `cross-browser`.
- **CHANGELOG:** a short entry for this pass.
- **Kept as dated records:** QA_BASELINE.md (taken against `4b0cd49`) and the per-pass result tables in
  UI.md §7–§11, as written when each pass ran.

**In the release pass:**
- README: Testing section, the QA helper's `?qa=1`.
- QUICK-START: rewritten to match the game.
- CHANGELOG: a player summary, then one entry per pass.
- QA_BASELINE: D8 fixed, and the helpers need `?qa=1`.

## 6. Reproduce

```bash
npm install && npx playwright install chromium        # add firefox webkit to cover those engines
npm test && npm run rules && npm run combat && npm run effects && npm run progression && npm run ai
npm run collection && npm run feedback && npm run packs && npm run regression
npm run smoke && npm run ui && npm run menu && npm run cards:ui && npm run release   # screenshots in test-results/
npm run cross-browser                                 # every installed engine; missing ones show NOT TESTED
npm run feedback:shots && npm run packs:shots && npm run collection:shots            # screenshots + axe
npm run ai:sim                                        # measured AI sample (~5 min)
```
