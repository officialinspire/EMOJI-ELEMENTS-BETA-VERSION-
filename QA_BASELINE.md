# QA Baseline — EMOJI ELEMENTS v2 beta

Baseline taken 2026-10-20 against `main` @ `4b0cd49` (after PR #116). This replaces `QA_REPORT.md`.
It records what the code **actually does**, so planned changes can be checked against it. It does not
propose a redesign.

**Status: 🔴 Red.** Every match victory soft-locks on the reward screen (D1). D2 (Deck Builder could not save
any deck) is **fixed** by the card-catalog pass; see [CARD_AUDIT.md](CARD_AUDIT.md). Menus, the shop, pack opening,
losses, persistence, deck saving and the turn loop work.

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
| desktop (1280×800) | 13: boot, intro fallback, navigation, deck builder, dual-deck persistence, pack shop, turn cycle, 3-turn natural play, win, loss, corrupt-save recovery, defect probes, reset progress | 101 | 0 | 7 |
| mobile (Pixel 7 emulation, touch) | 8: boot, navigation, deck builder, pack shop, turn cycle, win, loss, touch/long-press | 90 | 0 | 6 |
| **Total** (exit 0, ~2 min) | 21 | **191** | **0** | **13**: D1, D6 and D8–D12 still reproduce; D2–D5 and D7 are fixed (D3 moved to the rules suite) |

Two more suites:
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
5. **Win:** MATCH REWARDS (+25 credits, 1 pack) → **OPEN BOOSTER (broken for pointer/touch, D1)** → pack
   overlay → ✕ → VICTORY (Play Again / Main Menu).
   **Loss:** DEFEAT (Try Again / Main Menu). The +10 credits are not shown (D20).
6. **Pack overlay** (win or shop): drag/swipe across the sealed pack to rip it → card 1 of 5 auto-reveals →
   PREV/NEXT or swipe (D12) → ✕ back to the previous screen.
7. **Pack Shop:** credits badge; Fantasy, SciFi, Tech, Alien and Robot cost 60, Lands costs 40.
   An insufficient balance shows an inline message.
8. **Deck Builder:** pick one of 15 deck keys → "Eligible Owned Cards" (+) and "Deck List" (−) → RESET TO
   STARTER · GUIDE · SAVE DECK. Save requires the exact starter size and passes validation.
9. **Binder:** owned cards with counts; click one for details.
10. **Stats:** W/L/total/win rate · RESET STATS · RESET PROGRESS (wipes meta, D9).

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
  Dual decks are generated as well, but their two-colour cards are not added to the collection (D10).

## 6. Saved data (`localStorage`)

| Key | Written by | Shape / notes |
|---|---|---|
| `emoji_elements_meta_v1` | live game | `{version:1, initialized, collection:{cardId:count}, decks:{KEY:{deckKey, colors, starterCardIds, cardIds}}, selectedDeckKey, stats:{wins, losses, packsOpened}, wallet:{credits}, lastPack:{themeKey, cardIds, openedAt}\|null}`. On every load it is re-validated: unknown IDs are dropped, deck lists are clamped to owned copies, and a missing mono deck is re-seeded. Corrupt JSON gets a fresh starter meta (verified). |
| `emojiElementsStats` | live game **and** legacy file | `{wins, losses, total}`. The live game mirrors it on every save and reads it only if the meta is missing. |
| `emojiElementsMuted` | live game | `"true"`/`"false"` |
| `emojiElementsProgress` | legacy file only | `{coins, boosterPacks}` |

Reset paths: Stats → RESET PROGRESS (meta only) · `__qaResetMeta()` (confirm + reload) ·
`localStorage.removeItem('emoji_elements_meta_v1')`.
QA helpers on `window`: `__qaDumpMeta`, `__qaResetMeta`, `__qaNavSmoke`, `__qaBuyPack(theme)`,
`__qaDeckBuilderSmoke(key)` (**note:** this overwrites the saved deck), `__qaPerfBurst`.

---

## 7. Known defects, by gameplay impact

Evidence: **T** = reproduced by `tests/smoke.mjs` (XFAIL). **S** = seen in a test screenshot.
**C** = found by reading code, not yet exercised.

| ID | Pri | Defect | Where | Ev. |
|---|---|---|---|---|
| D1 | **P0** | **Every win soft-locks.** The MATCH REWARDS "OPEN BOOSTER" button ignores mouse and touch, because `.overlay-btn {pointer-events:none}` is re-enabled only for the victory and lose overlays. This came in with `4cdcb72`. Rewards are already saved; the only ways past it are keyboard Tab+Enter or reloading. | `styles.css:2453-2462` | T |
| D2 | ✅ fixed | ~~**Deck Builder cannot save any real deck.**~~ Fixed in the card-catalog pass: basic lands are exempt from the copy limit; land totals are still capped. Validation applies the 2-copy limit to basic lands, while starters run 20–22 copies ("Volcanic Peak exceeds max copies (2)"). The + button also refuses a 3rd land. This breaks the loop of opening packs to improve decks. | `index.js:1254-1257, 1296-1299, 3109` | T |
| D3 | ✅ fixed | ~~About 25% of matches gave the AI a broken deck (`colorless` colour, typeless placeholder cards).~~ The AI's colours now come from the five real colours. Covered by `tests/rules.test.mjs` (40 seeded matches). | `index.js` `startGame` | T |
| D4 | ✅ fixed | ~~Repeatable mana: a tapped land untapped after its mana was spent.~~ A land now untaps only to refund unspent mana (RULES.md R4.4). | `index.js` `tapLand` | T |
| D5 | ✅ fixed | ~~The player's creatures untapped at the end of the player's own turn.~~ Permanents now untap at the start of their controller's turn, so the player's attackers can't block on the AI turn (RULES.md R5.3). | `index.js` `endTurn` | T |
| D6 | P1 | **Touch: long-pressing a hand card to read it also plays it** when the finger lifts. Land stacks already guard against this. | `index.js:5822-5847` | T |
| D7 | P2 | Revive returns the top graveyard card of any type (an instant, artifact or land can land on the battlefield). | `index.js:4692-4708` | T |
| D8 | P2 | `QA_MODE = true` ships to players: a debug line ("stage=reveal progress=100% …") shows in the pack overlay, "QA:" text appears in the Deck Builder status, and `[QA]` console noise. | `index.js:8, 2231-2246, 3086` | T, S |
| D9 | P2 | RESET PROGRESS leaves the in-memory stats. The Stats screen keeps the old numbers, and the next match writes the old wins/losses back into the meta. | `index.js:3433-3458, 485-497` | T |
| D10 | P2 | The FIRE_SWAMP starter list includes Web Trap, which nobody owns. After the first reload the deck is clamped to 59 cards, matches use the 59-card deck, and it can never be saved. | `index.js:1494-1501, 1619` | T |
| D11 | P2 | If the intro mp4 can't be decoded, the menu waits 15 s unless the player taps. `play()` stays pending, so the "paused" watchdog never fires, and `<source>` errors miss the `<video>` error listener. | `index.js:647-653, 715` | T |
| D12 | P2 | Pack reveal swipe advances one card per ~55 px of finger travel, so a normal 150 px swipe skips a card and a long one skips several. | `index.js:2570-2585` | T |
| D13 | P3 | The pack overlay is titled "🎁 Victory Pack" even for shop purchases. | `index.html:81` | S |
| D14 | ✅ fixed | ~~No loss for drawing from an empty deck.~~ New house rule: drawing from an empty deck loses (RULES.md R6.1). | `index.js` `drawCard` | T |
| D15 | P3 | `flash` (9 creatures) and `unblockable` (Otter Scout, Surf) have no rules effect. | combat/play code | C |
| D16 | P3 | Esc on the VICTORY overlay closes it and leaves the finished board with no result UI (exit via ☰). | `index.js:6362-6367` | C |
| D17 | P3 | `stats.packsOpened` counts win packs when awarded (not when opened); shop packs are never counted. | `index.js:2633, 2977-3028` | C |
| D18 | P3 | `inferRarity` never returns `uncommon`, so the pack "uncommon" slot draws `rare` cards and the uncommon glow is unused. | `index.js:1124-1149` | C |
| D19 | P3 | Duplicate card names: "Signal Tower" and "Chrono Watch" each exist as both a creature and an artifact. | card DB | C |
| D20 | P3 | The DEFEAT screen does not show the +10 credits earned. | `index.html:62-66` | C |

**Design gaps to settle before a redesign (not counted as defects):** the player cannot choose blockers
(everything is auto-blocked, always); spells have no targeting; the player always goes first; easy and
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
| QA_REPORT (old) | Browser automation blocked by a Chromium SIGSEGV; every feature "✅ Implemented" | Automation works; D1 breaks the win flow (D2, deck saving, is now fixed). |

---

## 9. Manual test matrix (not automated here)

Run these on real hardware. Each row starts from a fresh profile (clear site data).

| # | Platform | Steps | Expected | Status |
|---|---|---|---|---|
| M1 | Chrome desktop (Win/Mac) | Click to start, watch the intro to the end | Intro plays with sound, then the menu with music | Not run |
| M2 | Firefox desktop | Smoke flows from §4: start, play 2 turns, shop pack, deck builder | Same as Chromium; no console errors | Not run |
| M3 | Safari macOS | Same as M2, plus mute toggle | Audio starts only after the click | Not run |
| M4 | iOS Safari (iPhone) | Tap to start; intro; tap a land; long-press a card; rip a pack by swipe; win → OPEN BOOSTER | Touch works; expect **D1, D6, D12** | Not run |
| M5 | Android Chrome | Same as M4, plus haptics on long-press | Vibration fires; expect **D1, D6, D12** | Not run |
| M6 | Samsung Internet | Same as M4 | Same as M5 | Not run |
| M7 | Any mobile, landscape | Start a match, rotate | END TURN and the hand stay reachable | Not run |
| M8 | Any | Open `index.html` via `file://` | Boots and saves progress (README says this mostly works) | Not run |
| M9 | Android/iOS | Add to Home Screen (manifest) | Standalone launch with icon | Not run |
| M10 | Any | Play a full natural match to a win, all difficulties | Finishes; expect **D1** at rewards | Not run |

## 10. Next recommended fix

**D1.** D2 was fixed in the card-catalog pass. D1 is a one-selector change with the largest player-facing impact:
- **D1:** add `.match-reward-overlay.show .overlay-btn` to the `pointer-events: auto` rule in `styles.css`.

Then **D3:** remove `colorless` from the AI's colour pool in `startGame`. After each fix, run
`node tests/smoke.mjs`: the matching XFAIL should turn into XPASS. Then convert it to a plain `check` and
delete the row above.
