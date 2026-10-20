# QA Baseline — EMOJI ELEMENTS v2 beta

Baseline taken 2026-10-20 against `main` @ `4b0cd49` (after PR #116). This replaces `QA_REPORT.md`.
It records what the code **actually does**, so planned changes can be checked against it. It does not
propose a redesign.

**Status: 🟢 Green in automation.** Every known defect found by the suites is fixed. That includes:
- the win soft-lock (D1);
- the Deck Builder save bug (D2);
- a data-loss bug: a save with a missing or different `version`, or corrupt JSON, was replaced by a new profile
  with no copy kept. It is now repaired and backed up ([PROGRESSION.md](PROGRESSION.md) §7);
- touch long-press playing the card (D6);
- the slow intro fallback (D11);
- an unplayable phone-landscape layout ([UI.md](UI.md)).

The full loop works on phone, tablet and desktop sizes. What's left needs real devices and browsers other than
Chromium (§9, UI.md §6) and design decisions (PROGRESSION.md §8, EFFECTS.md §4).

---

## 1. Entry point

| File | Verdict | Evidence |
|---|---|---|
| `index.html` + `index.js` + `styles.css` | **Live game** | `manifest.json` `start_url: ./index.html`; `og:url` is the site root; README names it; it holds every v2 feature (meta save, shop, deck builder, binder). |
| `emoji-elements.html` | **Legacy, not referenced anywhere** | A self-contained single file with inline CSS and JS (3,161 lines). Has no pack shop, deck builder or meta save. It uses its own `emojiElementsProgress` key (coins/boosterPacks) and **shares** `emojiElementsStats` with the live game. Nothing links to it. |

⚠️ This legacy file is still being edited by mistake. Commit `15fd75f` (PR #112, "Fix end-of-match flow with
victory rewards modal") changed **only** `emoji-elements.html`, so that fix never reached the live game.
Recommendation: move it to `legacy/` or delete it, so future fixes land in `index.js`.

---

## 2. How to test

```bash
node tests/smoke.mjs                    # desktop (1280×800) + mobile (Pixel 7 emulation), ~2 min
node tests/smoke.mjs --project=mobile   # or: npm run smoke / smoke:desktop / smoke:mobile
node tests/smoke.mjs --only=shop,win    # subset; --headed to watch; --verbose echoes page console
```

- **Requirements:** Node 18+ and Playwright with Chromium. The script uses a local `playwright` (`npm i`, then
  `npx playwright install chromium`) or falls back to a global install. It serves the repo itself, so no
  separate server is needed.
- **Outcomes:** `PASS` = expected behaviour. `FAIL` = regression (exit 1). `XFAIL` = a known defect below still
  reproduces (exit 0). `XPASS` = that defect no longer reproduces, so update this file.
- **Artifacts:** screenshots and `smoke-results.json` go to `test-results/` (gitignored).
- **Test hooks used:** the suite reads `gameState`, `gameMeta` and `localStorage`. Win and loss are forced with
  `changeEnemyLife(-N)` / `changePlayerLife(-N)`. Probes call `generateDeck`, `tapLand`, `endTurn` and
  `resolveSpell`. No game code was changed to make this testable.

### Result of this baseline run

Run in the cloud container: Playwright 1.56.1, Chromium 141.0.7390.37 headless.

| Project | Scenarios | PASS | FAIL | XFAIL |
|---|---|---|---|---|
| desktop (1280×800) | 13: boot, intro fallback, navigation, deck builder, dual-deck persistence, pack shop, turn cycle, 3-turn natural play, win, loss, corrupt-save recovery, defect probes, reset progress | 108 | 0 | 0 |
| mobile (Pixel 7 emulation, touch) | 8: boot, navigation, deck builder, pack shop, turn cycle, win, loss, touch/long-press | 96 | 0 | 0 |
| **Total** (exit 0, ~2 min) | 21 | **204** | **0** | **0**: D1–D12 are all fixed (D3 moved to the rules suite) |

More suites:
- **AI:** `node --test tests/ai.test.mjs` (`npm run ai`), 33 tests, ~2.5 min:
  - targeted rule-parity and decision scenarios;
  - a seeded simulation of all 15 starter decks × 3 difficulties.

  The measured sample is `node tests/ai-sim.mjs` (`npm run ai:sim`, 360 matches, ~6 min). See [AI.md](AI.md).
- **Phone, tablet and desktop interaction:** `node tests/ui-audit.mjs` (`npm run ui`), ~5 min. Four profiles:
  - 360×740 Android portrait;
  - 863×360 phone landscape;
  - 712×1138 tablet;
  - 1366×768 desktop.

  It also runs reduced-motion and mobile-autoplay passes. It walks every screen and checks:
  - overflow and clipping;
  - touch-target sizes and double activation;
  - long-press and gestures;
  - keyboard focus and Esc;
  - axe-core accessibility;
  - motion and audio.

  Before: 193 of 463 checks failed. After: 469 of 469 pass. See [UI.md](UI.md).
- **Spell and artifact effects:** `node --test tests/effects.test.mjs` (`npm run effects`). 169 tests, ~2 min.
  Every instant and artifact is cast once by the player and once by the AI on a mirrored board, and the exact
  result is checked. Further tests cover upkeep timing, mana artifacts, "until end of turn", Deep Freeze,
  leaving the battlefield, hexproof, empty zones and lethal effects. The rules are in [EFFECTS.md](EFFECTS.md).
- **Progression and saved data:** `node --test tests/progression.test.mjs` (`npm run progression`). 27 tests,
  ~1.5 min. They load **real saves from the previous build** (`tests/fixtures/saves/`: existing, pre-dual,
  partial, future-version, renamed-card, corrupt, legacy-stats) and check that the collection and credits survive,
  every saved deck is legal and playable, packs/credits/rewards/resets behave, and backups are kept. The rules
  are in [PROGRESSION.md](PROGRESSION.md).
- **Combat:** `node --test tests/combat.test.mjs` (`npm run combat`). 78 tests, ~2.5 min. A 31-row scenario table
  is run with the player attacking and with the AI attacking, plus eligibility, keyword, graveyard and UI-text
  tests. The rules are in [RULES.md](RULES.md) §8.
- **Turn and resource rules:** `node --test tests/rules.test.mjs` (`npm run rules`). 30 tests, ~1.5 min, all
  passing. They use a seeded `Math.random`, Playwright's fake clock and card fixtures. The rules are defined
  in [RULES.md](RULES.md).
- **Card catalog:** `node tests/card-audit.mjs` (`npm test`, also run in CI by
  `.github/workflows/card-catalog.yml`), browser-free. See [CARD_AUDIT.md](CARD_AUDIT.md).

**Runner notes**
- The old report said Chromium crashed with SIGSEGV at launch. **That does not reproduce:** Chromium launches
  in about 0.7 s.
- Playwright's Chromium cannot decode H.264, so `inspiresoftwareintro.mp4` never plays under automation.
  The suite skips the intro with a tap, which is a real user path. Separately, this surfaced D11.
- Firefox, WebKit, real iOS/Android devices and audio output were **not** run. See the manual matrix in §8.

---

## 3. Rules as implemented

| Area | Actual behaviour (`index.js`) |
|---|---|
| Setup | Each player has 20 life and a 7-card hand. The player always goes first and skips the draw on turn 1. The AI draws every turn. |
| Mulligan | One mulligan to 6 cards, on your first turn, only before your first action (no land played or tapped, no card cast). See RULES.md R2.1. |
| Player deck | Built from the saved meta deck chosen by the selected colours (`FIRE`, `FIRE_WATER`…). It falls back to a random `generateDeck()` if that deck is missing, empty or invalid. Mono decks: 20 lands + 40 non-lands. Dual decks: 11 + 11 lands + 38 non-lands. |
| AI deck | Random each match: 50% mono / 50% dual, colours drawn from the five real colours (the `colorless` pick, D3, is fixed). Creature count is random (18–24), spells 7–13, artifacts fill the rest. |
| Mana | Tap a land for 1 mana of its colour. Dual or Rainbow lands open a colour picker. The pool empties at end of turn. Shortfalls in coloured mana can be paid from colourless mana, but colourless costs accept any colour. A tapped land can be clicked again to undo it, but only while its mana is unspent (the mana is refunded). Mana artifacts are clicked to add colourless mana. |
| Lands | One land per turn. Lands on the board are drawn as stacks (click taps one; ⚡ / right-click / long-press taps all). |
| Creatures | Summoning sickness unless the creature has haste. `defender` creatures cannot attack. |
| Combat | Press ATTACK, select attackers, then CONFIRM, once per turn. **Both sides block automatically:** each attacker is blocked by the highest-toughness legal blocker if one exists (2 blockers for menace). Implemented keywords: flying/reach, first strike, double strike, deathtouch, trample, lifelink, vigilance, menace, haste, defender, hexproof (against spells only). `flash` and `unblockable` do nothing (D15). Damage clears at end of turn. |
| Spells | Instants resolve on cast with no player-chosen targets. Damage spells hit the opponent's face (or all enemy creatures for AoE). destroy, tap, bounce and buff pick **random** targets. Revive returns the top graveyard card of **any** type (D7). |
| Artifacts | `buff`, `buff_defense`, `aoe` and `draw_on_play` resolve once, then go to the graveyard. `draw`, `heal` and `damage` artifacts trigger at their owner's upkeep. `mana` artifacts are tapped manually. |
| AI turn | Untap, draw, upkeep, play a land, then tap **all** its lands. Easy and medium make one non-land play per turn; hard makes 2 and may cast instants. Attacks: easy picks each creature with 70% chance; medium picks the best-scored 60%; hard attacks with everything. |
| End of match | Life ≤ 0 (checked on every life change). Drawing from an empty deck also loses (RULES.md R6.1). The player's loss is checked first. |
| Rewards | **Win:** +25 credits and **one free pack every time** (`WIN_FREE_PACK_CHANCE` is unused), with the theme weighted at random. **Loss:** +10 credits, no pack. |

## 4. UI flows

1. **Boot:** "CLICK TO START" → intro video (tap to skip; it ends on video end, after 15 s, or via a 3 s
   watchdog that only fires while paused, see D11) → main menu with music.
2. **Main menu:** NEW GAME · DECK BUILDER · PACK SHOP · BINDER / COLLECTION · HOW TO PLAY (2 pages) · GAME STATS.
3. **New game:** choose Single or Two Colors (default Two), difficulty Easy/Medium/Hard (default Easy) and the
   element(s). START BATTLE is enabled only when exactly 1 or 2 elements are chosen. The match uses the saved
   deck for that colour key and stores it as `selectedDeckKey`.
4. **Match HUD:** ☰ pause (Resume / Main Menu with confirm), mute, phase label, enemy and player life, deck count
   and mana pool, hand. Buttons: MULLIGAN · GRAVEYARD (player/enemy tabs) · ATTACK→CONFIRM · END TURN.
   Keys: Space/E end turn, A attack, M mulligan, Esc pause. Right-click (desktop) or long-press (touch) shows
   card details.
5. **Win:** MATCH REWARDS (+25 credits, 1 pack) → OPEN BOOSTER → pack overlay ("Victory Pack") → ✕ →
   VICTORY (Play Again / Main Menu).
   **Loss:** DEFEAT, showing "+10 Credits" (Try Again / Main Menu).
6. **Pack overlay** (win or shop): drag/swipe across the sealed pack to rip it → card 1 of 5 auto-reveals →
   PREV/NEXT or swipe (one card per swipe) → ✕ back to the previous screen. Shop packs are titled
   "<Theme> Pack".
7. **Pack Shop:** credits badge; Fantasy, SciFi, Tech, Alien and Robot cost 60, Lands costs 40.
   An insufficient balance shows an inline message.
8. **Deck Builder:** pick one of 15 deck keys → "Eligible Owned Cards" (+) and "Deck List" (−) → RESET TO
   STARTER · GUIDE · SAVE DECK. Save requires the exact starter size and passes validation.
9. **Binder:** owned cards with counts; click one for details.
10. **Stats:** W/L/total/win rate · RESET STATS · RESET PROGRESS (new profile; the old one is kept as a backup).

## 5. Card source

- **Location:** a single inline `CARD_DATABASE` in `index.js` (lines ~778–1096), in the categories `lands`,
  `creatures`, `spells` and `artifacts`. There is no external data file.
- **Counts:** 268 cards: 8 lands (5 basic, Crystal Wasteland [colourless], Distant Planet [light/swamp],
  Rainbow [any]), 190 creatures, 41 instants, 29 artifacts. 29 cards cost two colours. 10 cost colourless
  only; 3 are free.
- **IDs:** `${category}-${slug(name)}`, for example `lands-volcanic-peak` and `creatures-ancient-dragon`.
  They are stable only as long as names and categories stay the same, so renaming a card orphans saved copies.
- **Rarity** is inferred by a heuristic (`inferRarity`) from keywords, stats, abilities and effects.
  Result: 204 common, 41 rare, 14 epic, 9 legendary, and **no uncommon** (D18). Legendary cards are limited
  to 1 copy, others to 2; basic lands are limited only by the land caps.
- **Pack theme** is taken from the `theme` field (Fantasy, Science Fiction, Nature, City) and then from
  name/description keywords. Pools under 16 cards get padded with neutral cards.
- **Starter collection:** the cards of the 5 mono starter decks (153 unique cards, no legendaries).
  Dual starter decks are built only from those owned cards, so all 15 are legal on a fresh profile (D10 fix).

## 6. Saved data (`localStorage`)

| Key | Written by | Shape / notes |
|---|---|---|
| `emoji_elements_meta_v1` | live game | `{version:1, initialized, collection:{cardId:count}, decks:{KEY:{deckKey, colors, starterCardIds, cardIds}}, selectedDeckKey, stats:{wins, losses, packsOpened}, wallet:{credits}, lastPack:{themeKey, cardIds, openedAt}\|null}`. On every load it is repaired, never replaced: unknown IDs are dropped, deck lists are clamped to owned copies, missing standard decks are added from owned cards. Corrupt JSON gets a fresh profile after the old text is backed up. See [PROGRESSION.md](PROGRESSION.md) §7. |
| `emoji_elements_meta_backups` | live game | Up to 3 `{savedAt, reason, raw}` copies of the profile text, taken before any repair, reset or corrupt-save replacement. |
| `emojiElementsStats` | live game **and** legacy file | `{wins, losses, total}`. The live game mirrors it on every save and imports its wins/losses only when no meta exists. |
| `emojiElementsMuted` | live game | `"true"`/`"false"` |
| `emojiElementsProgress` | legacy file only | `{coins, boosterPacks}` |

Reset paths: Stats → RESET PROGRESS (meta and stats, after a backup) · `__qaResetMeta()` (confirm + reload) ·
`localStorage.removeItem('emoji_elements_meta_v1')`.
QA helpers on `window`: `__qaDumpMeta`, `__qaResetMeta`, `__qaNavSmoke`, `__qaBuyPack(theme)`,
`__qaDeckBuilderSmoke(key)` (**note:** this overwrites the saved deck), `__qaPerfBurst`.

---

## 7. Known defects, by gameplay impact

Evidence: **T** = reproduced by `tests/smoke.mjs` (XFAIL). **S** = seen in a test screenshot.
**C** = found by reading code, not yet exercised.

| ID | Pri | Defect | Where | Ev. |
|---|---|---|---|---|
| D1 | ✅ fixed | ~~**Every win soft-locks.** The MATCH REWARDS "OPEN BOOSTER" button ignored mouse and touch.~~ Its button is now included in the `pointer-events: auto` rule. | `styles.css` | T |
| D2 | ✅ fixed | ~~**Deck Builder cannot save any real deck.**~~ Fixed in the card-catalog pass: basic lands are exempt from the copy limit; land totals are still capped. Validation applies the 2-copy limit to basic lands, while starters run 20–22 copies ("Volcanic Peak exceeds max copies (2)"). The + button also refuses a 3rd land. This breaks the loop of opening packs to improve decks. | `index.js:1254-1257, 1296-1299, 3109` | T |
| D3 | ✅ fixed | ~~About 25% of matches gave the AI a broken deck (`colorless` colour, typeless placeholder cards).~~ The AI's colours now come from the five real colours. Covered by `tests/rules.test.mjs` (40 seeded matches). | `index.js` `startGame` | T |
| D4 | ✅ fixed | ~~Repeatable mana: a tapped land untapped after its mana was spent.~~ A land now untaps only to refund unspent mana (RULES.md R4.4). | `index.js` `tapLand` | T |
| D5 | ✅ fixed | ~~The player's creatures untapped at the end of the player's own turn.~~ Permanents now untap at the start of their controller's turn, so the player's attackers can't block on the AI turn (RULES.md R5.3). | `index.js` `endTurn` | T |
| D6 | ✅ fixed | ~~Touch: long-pressing a hand card to read it also played it.~~ All cards now share one press handler: a long-press only inspects (UI.md). | `index.js` `bindCardPress` | T |
| D7 | ✅ fixed | ~~Revive returned the top graveyard card of any type.~~ It now returns the most recent creature (RULES.md C10). | `index.js` | T |
| D8 | ✅ fixed (player-facing) | ~~QA debug text shown to players.~~ The pack-overlay debug line now appears only with `window.__qaShowPackDebug = true`, and the Deck Builder status no longer says "QA:". `QA_MODE` and its console logging remain. | `index.js` | T |
| D9 | ✅ fixed | ~~RESET PROGRESS left the in-memory stats.~~ It now resets the stats, their legacy mirror and the Stats screen (PROGRESSION.md P5.2). | `index.js` `resetMetaProgress` | T |
| D10 | ✅ fixed | ~~The FIRE_SWAMP starter list included Web Trap, which nobody owns, so the deck shrank to 59 cards.~~ Dual starters are now built only from owned cards (Curse replaces Web Trap); untouched saved FIRE_SWAMP decks are migrated (PROGRESSION.md §7). | `index.js` `createInitialMeta`, `validateMeta` | T |
| D11 | ✅ fixed | ~~If the intro mp4 couldn't be decoded, the menu waited 15 s.~~ The 3 s watchdog now checks playback progress, and `<source>` errors are caught. | `index.js` intro | T |
| D12 | ✅ fixed | ~~Pack reveal swipe skipped cards.~~ One swipe now advances one card. | `index.js` `moveSwipe` | T |
| D13 | ✅ fixed | ~~Shop packs were titled "🎁 Victory Pack".~~ They are now titled "🛒 <Theme> Pack". | `index.js` | T |
| D14 | ✅ fixed | ~~No loss for drawing from an empty deck.~~ New house rule: drawing from an empty deck loses (RULES.md R6.1). | `index.js` `drawCard` | T |
| D15 | P3 | `flash` (9 creatures) has no rules effect. (`unblockable` was fixed in the combat pass.) | combat/play code | C |
| D16 | ✅ fixed | ~~Esc on the VICTORY overlay closed it and stranded the finished board.~~ Esc now leaves the result screens alone (UI.md). | `index.js` keyboard | T |
| D17 | ✅ fixed | ~~Shop packs were never counted in `stats.packsOpened`.~~ Every pack now counts when it is added to the collection. | `index.js` `purchasePack` | T |
| D18 | P3 | `inferRarity` never returns `uncommon`, so the pack "uncommon" slot draws `rare` cards and the uncommon glow is unused. | `index.js:1124-1149` | C |
| D19 | P3 | Duplicate card names: "Signal Tower" and "Chrono Watch" each exist as both a creature and an artifact. | card DB | C |
| D20 | ✅ fixed | ~~The DEFEAT screen did not show the +10 credits.~~ It now shows "💳 +10 Credits". | `index.html`, `index.js` | T |
| D21 | ✅ fixed | ~~Spell and artifact effects disagreed with their text~~: Earthquake/Avalanche hit only enemy creatures, Anger was permanent, Deep Freeze didn't freeze, Thought Steal skipped its draw on an empty enemy hand, a lethal Drain Life skipped its life gain, buffs survived bounce and death, and the AI never used mana artifacts. See EFFECTS.md §3. | `index.js` `resolveSpell` and AI turn | T |

**Design gaps to settle before a redesign (not counted as defects):** the player cannot choose blockers
(everything is auto-blocked, always); spells have no targeting (random legal targets, EFFECTS.md E2); the player always goes first; easy and
medium AI make only one non-land play per turn.

---

## 8. Documentation vs code

| Doc | Claim | Actual |
|---|---|---|
| README | Win gives a 15% free-pack chance (`WIN_FREE_PACK_CHANCE`) | Every win gives 1 pack; the constant is unused. (In-game text matches the code.) |
| README | Dual starters: 10 lands per colour, 20 lands, `NON_LAND_COUNT = 40` | 11 per colour: 22 lands + 38 non-lands. Mono decks are 20 + 40. |
| README | Five dual keys listed | Ten dual keys (every pair). |
| README | Five rarity tiers including `uncommon` | Four are produced; there is no `uncommon` (D18). |
| README | "Binder screen optional / not guaranteed"; roadmap: add binder, wire battle setup to `selectedDeckKey` | Both already exist. |
| README | Copy limit: 2 for non-legendary | Correct for non-lands. Basic lands are now limited only by the land caps (D2 fix); special lands have 2. |
| QUICK-START | "Based on original emoji-elements.html", "FIXES.md", "No intro video", "150+ cards", "No audio files needed" | The live build is `index.js`; `FIXES.md` does not exist; there is a click-to-start screen and intro video; there are 268 cards; the audio files are used. |
| QUICK-START | "Click tapped lands to untap" | True, but this is the D4 exploit path. |
| CHANGELOG | Stops at "v2.0": 85+ creatures, deck building as a "next step", gameplay music "ready to integrate" | 190 creatures; the deck builder, shop, binder, meta save and gameplay music all shipped without changelog entries. |
| CHANGELOG / How To Play | Flash ("instant speed"), unblockable | Not implemented (D15). |
| QA_REPORT (old) | Browser automation blocked by a Chromium SIGSEGV; every feature "✅ Implemented" | Automation works. The win flow (D1) and deck saving (D2) were broken; both are now fixed. |
| README (old) | 15% chance of a free pack per win; 60-card starters next to a 2-copy limit | Every win gives a pack. Basic lands are exempt from the copy limit (land caps apply). README now matches; see PROGRESSION.md. |

---

## 9. Manual test matrix (not automated here)

Run these on real hardware. Each row starts from a fresh profile (clear site data).

| # | Platform | Steps | Expected | Status |
|---|---|---|---|---|
| M1 | Chrome desktop (Win/Mac) | Click to start, watch the intro to the end | Intro plays with sound, then the menu with music | Not run |
| M2 | Firefox desktop | Smoke flows from §4: start, play 2 turns, shop pack, deck builder | Same as Chromium; no console errors | Not run |
| M3 | Safari macOS | Same as M2, plus mute toggle | Audio starts only after the click | Not run |
| M4 | iOS Safari (iPhone) | Tap to start; intro; tap a land; long-press a card; rip a pack by swipe; win → OPEN BOOSTER | Touch works; long-press inspects without playing | Not run |
| M5 | Android Chrome | Same as M4, plus haptics on long-press | Vibration fires; long-press inspects without playing | Not run |
| M6 | Samsung Internet | Same as M4 | Same as M5 | Not run |
| M7 | Any mobile, landscape | Start a match, rotate | END TURN and the hand stay reachable | Not run |
| M8 | Any | Open `index.html` via `file://` | Boots and saves progress (README says this mostly works) | Not run |
| M9 | Android/iOS | Add to Home Screen (manifest) | Standalone launch with icon | Not run |
| M10 | Any | Play a full natural match to a win, all difficulties | Finishes; OPEN BOOSTER works | Not run |

## 10. Next recommended fix

Run the device-only checks in [UI.md](UI.md) §6 on a real iPhone (Safari) and Android phone. WebKit, Firefox and
real touch hardware were not available here. Then the design decisions:
- the economy ([PROGRESSION.md](PROGRESSION.md) §8);
- spell targeting and equipment ([EFFECTS.md](EFFECTS.md) §4);
- Flash (RULES.md C15).
