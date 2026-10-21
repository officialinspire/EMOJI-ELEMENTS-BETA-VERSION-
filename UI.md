# EMOJI ELEMENTS: Phone, Tablet and Desktop Interaction

How the live game (`index.html`, `index.js`, `styles.css`) behaves under touch, mouse and keyboard at
representative sizes, what this pass fixed, and what still needs a real device. The look is unchanged and so are
the gameplay rules: the rules, combat, progression and effects suites (304 tests) and the smoke suite all pass.

## 1. How it is tested

```bash
node tests/ui-audit.mjs                          # all profiles, ~5 min (npm run ui; also run in CI by ui.yml)
node tests/ui-audit.mjs --profile=phone-landscape
node tests/ui-audit.mjs --label=before --report-only
```

The audit drives the real game in Chromium (Playwright 1.56.1, Chromium 141). It uses real touch events (CDP),
the mouse and the keyboard. For each profile it walks:
- CLICK TO START, the menu, and element/deck selection;
- a busy match (stacked lands, keyword creatures, artifacts, a full hand);
- card inspection, tapping lands, selecting attackers, and the combat result;
- the graveyard and pause;
- rewards, pack ripping and swiping, victory and defeat;
- Deck Builder and Binder.

It takes a screenshot of each screen and records `test-results/ui/<label>/ui-audit.json`. axe-core 4.10.3 runs
on every screen (WCAG 2.0–2.2 A/AA rules).

### Device and browser matrix

| Profile | Size (CSS px) | Input | Emulates | Run |
|---|---|---|---|---|
| android-portrait | 360×740, DPR 3 | touch | Galaxy S8 (narrow Android portrait) | ✅ Chromium |
| phone-landscape | 863×360, DPR 2.6 | touch | Pixel 7 landscape | ✅ Chromium |
| tablet | 712×1138, DPR 2.25 | touch | Galaxy Tab S4 portrait | ✅ Chromium |
| desktop | 1366×768 | mouse + keyboard | common laptop | ✅ Chromium |
| reduced-motion | 1366×768 | mouse | `prefers-reduced-motion: reduce` | ✅ Chromium |
| autoplay | 360×740 | touch | `--autoplay-policy=user-gesture-required` (phone autoplay rules) | ✅ Chromium |
| `tests/smoke.mjs` | 1280×800 and Pixel 7 (412×839) | mouse / touch | full flows | ✅ Chromium |
| iOS Safari, Firefox, Samsung Internet, real devices | — | — | — | ❌ not available here (§6) |

### What is checked

| Area | Checks |
|---|---|
| Layout | No horizontal overflow. Essential controls are on screen and not covered: END TURN, ATTACK, both life totals, hand, both battlefields, dialog buttons. The match screen doesn't scroll the page. Card stats stay inside the card. Text is at least 10 px. |
| Touch | Reachable targets are at least 24 px; those under 44 px are listed. One tap plays one land and taps one land. A long-press inspects without playing or selecting. Swiping the hand or battlefield plays nothing and doesn't scroll the page. Ripping a pack doesn't scroll the page. One swipe shows one pack card. A finger swipe scrolls long menus. |
| Keyboard | Esc closes card details and the graveyard, and resumes from pause. Tab stays inside open dialogs. Space on a button reached with Tab presses that button. Ctrl+A doesn't attack. Cards are reachable with Tab, and I inspects without playing. Focus is visible. Esc on the result screen doesn't strand the board. |
| Accessibility | axe-core on every screen (colour contrast reported separately). Every button and select has a name. |
| Legibility | After combat, blocks are reported by name. |
| Motion | With reduced motion: no looping or long animations, no screen shake, no intro animation. |
| Audio | Nothing plays before the first tap. Mute is saved and announced. Blocked audio raises no errors. |

## 2. Results

Same harness on both sides. "Before" is the previous commit (`e593295`); "after" is this pass.

| Area | Before: failing / checks | After: failing / checks |
|---|---|---|
| Layout | 52 / 208 | 0 / 208 |
| Touch | 16 / 94 | 0 / 94 |
| Keyboard | 10 / 11 | 0 / 13 |
| Accessibility (axe + names) | 108 / 136 | 0 / 136 |
| Legibility (combat) | 4 / 4 | 0 / 4 |
| Motion | 2 / 3 | 0 / 3 |
| Audio | 1 / 7 | 0 / 7 |
| Page errors | 0 / 4 | 0 / 4 |
| **Total** | **193 / 467** | **0 / 469** |

There are two more keyboard checks after the fixes because the card-keyboard checks only run once cards can take
focus.

axe-core violations, as a total of affected nodes over all screens:
- **Before:** `meta-viewport` 68 (zoom disabled) and `scrollable-region-focusable` 48 (card rows and lists that
  can't be scrolled from the keyboard).
- **After:** none.

axe reported no colour-contrast violations either before or after. axe can't measure text over gradients or
images, though, so contrast on gold-on-gradient text still needs a manual check (§6).

### Before/after evidence

Real Chromium screenshots, each scene shown as a before | after pair:

| File | Shows |
|---|---|
| [docs/ui-evidence/android-portrait.jpg](docs/ui-evidence/android-portrait.jpg) | Match header, controls, attack selection, combat report |
| [docs/ui-evidence/phone-landscape.jpg](docs/ui-evidence/phone-landscape.jpg) | The landscape match, card details, combat report, pack PREV/NEXT |
| [docs/ui-evidence/tablet.jpg](docs/ui-evidence/tablet.jpg) | CLICK TO START title, bigger cards, combat report |
| [docs/ui-evidence/desktop.jpg](docs/ui-evidence/desktop.jpg) | Match and combat report |

The full screenshot set (17 screens × 4 profiles) is written to `test-results/ui/` on each run and uploaded by
CI as the `ui-audit-screenshots` artifact.

## 3. Findings and fixes

| # | Problem | Where | Fix |
|---|---|---|---|
| U1 | **Phone landscape unplayable.** The desktop sizes (min-width 768px) applied to an 863×360 phone. Your battlefield and life total were off screen or under the hand. Card details and the pack's PREV/NEXT were cut off. | phone-landscape | A short-landscape layout (max-height 500px): controls in a side column, life/deck/mana beside each battlefield, compact cards, and dialogs that fit. |
| U2 | **A long-press played the card** (QA D6), and in attack selection it also selected the creature. Every card type had its own touch/click/contextmenu code. | touch | One handler for every card, `bindCardPress`, built on Pointer Events. Tap/click/Enter acts. Long-press, right-click or I inspects (or taps all, on a land stack). A long-press never also acts, a touch never fires twice, and moving the finger more than 10 px cancels. |
| U3 | **Blocks were invisible.** Blocking is automatic, and its only feedback was log lines that the next message replaced at once. The `.blocking` style was never used. | all | After each combat, one message lists every attacker, its blockers and what died, held for 3.5 s (later messages wait). 💔 shows damage taken this turn, and a dashed border marks summoning sickness. The game log is an `aria-live` region. |
| U4 | Card information was hover-only on desktop (tooltip) and long-press-only on touch. Enemy cards did nothing on tap. | all | Tapping a card that has no action (a creature outside combat, an enemy card) shows its details. The keyboard shortcut I inspects. |
| U5 | Phone header: the phase label was clipped ("MAIN PHAS"), and the ☰ button was squeezed to 26 px. | android-portrait | Under 420px the title swords are hidden and long labels wrap. The header buttons no longer shrink. |
| U6 | Phone controls: END TURN sat alone on a third row next to two empty cells. | android-portrait, tablet | MULLIGAN · GRAVEYARD · END TURN, then a full-width ATTACK. |
| U7 | Small touch targets: card-detail ✕ 32 px (and a `<div>`, not a button), graveyard ✕ 36 px, tabs 40 px, difficulty buttons 42 px, deck picker 35 px, ☰ 26×40, footer link 15 px tall. | touch | All 44 px. The card-detail ✕ is now a real button. |
| U8 | Keyword badges were 9 px. | all | 11 px. |
| U9 | Tapped (sideways) cards covered their neighbours. | all | Tapped cards get side margins. |
| U10 | Esc did nothing in card details, the graveyard or pause. Esc on VICTORY stranded the finished board (QA D16). | desktop | Esc closes the top dialog (confirmations answer No, the mana choice cancels, pause resumes). Esc does nothing on the reward, victory and defeat screens. |
| U11 | Focus wasn't managed: Tab walked behind open dialogs, and focus was lost when they closed. | desktop | Dialogs get `role="dialog"` and `aria-modal`. Focus moves in, stays in, and returns when the dialog closes. |
| U12 | Shortcuts hijacked keys: Space ended the turn even with a focused button, and Ctrl+A attacked. | desktop | Space/Enter press a control you reached with Tab. After a mouse click Space still ends the turn, as documented. Shortcuts ignore Ctrl/Cmd/Alt. |
| U13 | Cards couldn't be reached by keyboard. | desktop | Cards and land stacks are focusable buttons with names like "Fire Lion, 4/3, costs 4 fire". Focus stays on the same slot after a card is played. Binder and graveyard rows work from the keyboard. |
| U14 | Icon-only buttons had no name (☰, ✕, the 🔥💧🌍💀☀️ element buttons, Deck Builder +/−). Selected and mute states weren't announced. | all | Added `aria-label`s, plus `aria-pressed` on element, deck-mode, difficulty and mute buttons. |
| U15 | Pinch-zoom was disabled (`user-scalable=no`, WCAG 1.4.4). | all | Zoom is allowed. Double-tap zoom stays off through `touch-action`. |
| U16 | With reduced motion, the legendary halo kept spinning (pseudo-elements were missed), and the screen still shook. Particles, sparkles and the intro still played. | reduced-motion | Pseudo-elements are covered. Shake, particles, sparkles and the intro are skipped. Smooth scrolling is off. |
| U17 | When the intro video couldn't play, the menu waited 15 s (QA D11): a `play()` that never settles kept the 3 s watchdog from firing. | autoplay / codecs | The watchdog checks playback progress, and `<source>` errors are caught. The menu now appears within ~3 s. |
| U18 | The mute state wasn't announced. | all | `aria-pressed` on 🔊/🔇. |
| U19 | The CLICK TO START title was clipped on tablets, and the menu title was clipped at the right edge. | tablet, phones | Titles are sized to their panel. |
| U20 | The combat report or other messages showed on top of dialogs. | all | Opening a dialog hides the message. |

Already fine, confirmed by the audit:
- no horizontal overflow at any size;
- one tap never activated twice;
- swiping the hand or pack never scrolled the page;
- one swipe shows one pack card;
- long menus scroll by finger;
- nothing plays before the first tap;
- blocked audio raises no errors.

## 4. Controls (the input model)

| Action | Touch | Mouse | Keyboard |
|---|---|---|---|
| Play a hand card / tap one land / use an artifact / select an attacker | tap | click | Tab to it, Enter |
| Card details | long-press (400 ms), or tap a card with no action | right-click, or click a card with no action | I (or the context-menu key) |
| Tap all lands in a stack | long-press the stack | right-click, or the ⚡ corner button | I on the stack |
| End turn / attack / mulligan | buttons | buttons | Space or E / A / M |
| Cancel attacker selection | ✕ CANCEL | ✕ CANCEL | Tab to it, Enter |
| Match history | 📜 | 📜 | H |
| Close a window / pause | ✕ | ✕ | Esc |

## 5. Implementation notes

- **index.js:**
  - `bindCardPress`, `describeCardForA11y` and `captureRowFocus`/`restoreRowFocus` (cards);
  - `GAME_DIALOGS` with a `MutationObserver` (dialog focus, the Esc order, the Tab trap);
  - `reportCombat` and the hold/queue in `showGameLog`;
  - `prefersReducedMotion()`;
  - the intro watchdog;
  - `lastInputWasPointer` (Space/Enter modality).
- **styles.css:** the block at the end, "INTERACTION POLISH". It only adds or overrides rules, so the old look is
  kept.
  - The landscape grid needs `display: grid !important`, because the match is shown with an inline
    `display: flex` that index.js checks.
- **index.html:**
  - dialog roles and names, button labels and `aria-pressed`;
  - zoom is allowed;
  - the How To Play controls section is rewritten.

## 6. Still to test on real devices

Not possible in this container: only Chromium is installed, touch is emulated, and there is no audio output, no
screen reader and no H.264.

| # | Device / browser | What to check |
|---|---|---|
| R1 | iPhone Safari (portrait and landscape) | The landscape grid with the notch (safe areas). A long-press shows details with no iOS callout or text selection. Tap/long-press timing. `100dvh` with the toolbar shown and hidden. |
| R2 | Android Chrome (real phone) | Long-press vs the OS context menu. Haptics. Pull-to-refresh/overscroll during swipes. Pinch-zoom then resuming play. |
| R3 | Samsung Internet, Firefox Android, Firefox desktop | Pointer Events behaviour, the landscape media query, focus trapping. |
| R4 | Any phone with sound | The intro plays with sound after the first tap, menu music starts, and mute persists. With the ringer off on iOS. |
| R5 | VoiceOver (iOS/macOS), TalkBack (Android) | Card names read sensibly, the combat report is announced, and dialogs trap and return focus. |
| R6 | Desktop with a real H.264 build (Chrome/Edge/Safari) | The intro plays to the end; reduced motion skips it. (Here the video never decodes, so the "intro skipped" check passes either way.) |
| R7 | Tablet with a keyboard, and iPad landscape (1024×768+) | Keyboard play end to end. The ≥768 px layout on a short landscape tablet. |
| R8 | Manual contrast review | Gold text on gradient panels, red P/T badges, disabled MULLIGAN. axe can't measure text over gradients. |
| R9 | Orientation change mid-match, split screen | Layout switches with no lost state. |

## 7. Main menu and battle setup refresh

A focused visual and UX pass on the main menu and battle setup. It keeps the dark arcane purple-and-gold look,
the vanilla HTML/CSS/JS structure, and every existing id, `data-*` attribute, `onclick` route and handler. The
match screen, in-game dialogs and rules are unchanged.

### What changed

| # | Before | After |
|---|---|---|
| M1 | Six identical gold buttons. Nothing marked NEW GAME as the main action. | NEW GAME is one large gold tile with a line of supporting text. The other five entries are violet tiles in a grid, each with an icon, a label and a short description. |
| M2 | Labels "BINDER / COLLECTION" and "GAME STATS". No hint of what each screen does. | New Game, Deck Builder, Collection, Pack Shop, How to Play, Stats, each with a one-line description. Stats shows your win/loss record. |
| M3 | Credits only showed inside the Pack Shop. Collection size only showed inside the Binder. | A status row shows credits, and collection progress as "owned / 268" with a meter. Both come from the saved profile (`updateMenuStatus`). |
| M4 | Setup order was deck type, "Select elements" (heading with nothing under it), difficulty, then the elements. | Four numbered steps: 1 Deck type, 2 Elements, 3 AI difficulty, 4 Your deck. |
| M5 | Element buttons were emoji only. Their names were in `aria-label` and invisible. Selection was a pink glow and a scale-up. | Each element shows its name in its own colour. A ✓ badge marks a pick (no reliance on colour alone). A live hint says how many picks are left, and unpicked elements dim when a two-colour deck is full. In a single-colour deck, tapping another element switches to it. |
| M6 | No explanation of the difficulties. | The selected level is explained from `DIFFICULTY_INFO`, which matches `AI_PROFILES` and AI.md §3. One shared line says every level plays by your rules with a legal 60-card deck in 1 or 2 random elements. |
| M7 | Nothing showed which deck you were about to play. | A summary of the saved deck for those colours: card counts by type, average cost of non-land cards, its rarest cards, and "Starter list" or "Customized". It is computed from `gameMeta.decks[key]`, the same deck `createPlayerDeck` will use. |
| M8 | NEW GAME always reset to "Two Colors" with nothing picked. The last deck was saved (`gameMeta.selectedDeckKey`) but never shown. | NEW GAME, PLAY AGAIN and TRY AGAIN start with the saved deck picked, also after a reload. |
| M9 | Short landscape (863×360): the desktop sizes applied, and only two entries showed without scrolling. The setup needed a long scroll. | Compact logo, entries in a 3 + 2 grid, setup in two columns. NEW GAME and START BATTLE are on screen without scrolling. |
| M10 | The desktop title was clipped at the right edge (the panel overflowed by 5 px). | The panel is wider (600 px; 760–940 px for setup and Deck Builder) and the title is sized to fit. |
| M11 | Esc did nothing on setup, How to Play and Stats. After BACK, focus always went to NEW GAME. | Esc returns from every menu screen. Focus returns to the entry that opened the screen, and each screen's heading is focused when it opens. |
| M12 | The footer link was 37 px tall. The How to Play pages could scroll but not take focus (axe `scrollable-region-focusable`). | 44 px link. The pages are focusable regions. |

Design system, in the "MENU REFRESH" block at the end of `styles.css`, scoped to `#startModal`:
- **Spacing:** steps of 4, 8, 12, 16 and 24 px (`--space-*`); radii of 8, 12 and 16 px.
- **Type:** Uncial Antiqua for the logo only, Cinzel for headings and labels, Inter for supporting text.
- **Buttons:** primary (gold fill: NEW GAME and START BATTLE), secondary (violet tile with a gold hairline), back
  (ghost) and danger (the two resets).
- **Element accents:** `--el`, `--el-soft` and `--el-glow`, set per `[data-element]`.
- **Decoration:** two local SVGs (`menu-sigil.svg`, a five-node arcane circle, 1 KB; `menu-divider.svg`, a gold
  filigree rule, 1 KB), used as CSS masks and backgrounds.

### Evidence

`tests/menu-audit.mjs` (`npm run menu`, also in CI) runs on a fresh profile at desktop 1366×768 (mouse and
keyboard), narrow phone 360×740, short landscape 863×360 and tablet 712×1138 (touch). It checks:
- layout and touch target size;
- text size;
- hierarchy and labels;
- that the status values match `gameMeta`;
- setup: element names, the ✓ marker, difficulty text against the AI settings, and deck summary numbers against
  the saved deck;
- saved-deck restore, including after a reload;
- routing and keyboard;
- axe (contrast included) on every menu screen.

The same final version of the audit was run on `main` before the change and on this branch after it:

| Area | `main` (before): failing / checks | This branch (after): failing / checks |
|---|---|---|
| Layout (overflow, 44 px controls, 11 px text, NEW GAME and START on screen) | 56 / 115 | 0 / 115 |
| Accessibility (axe, contrast included) | 4 / 36 | 0 / 36 |
| Hierarchy (NEW GAME first and largest) | 4 / 8 | 0 / 8 |
| Labels and supporting text | 8 / 8 | 0 / 8 |
| Credits and collection progress | 8 / 8 | 0 / 8 |
| Setup (names, ✓ marker, difficulty text, deck summary) | 40 / 64 | 0 / 64 |
| Saved deck restored (and after a reload) | 8 / 8 | 0 / 8 |
| Keyboard (Tab, Enter/Space, Esc, focus return) | 6 / 10 | 0 / 10 |
| Routing, audio start, page errors | 0 / 32 | 0 / 32 |
| **Total** | **134 / 289** | **0 / 289** |

Regression on this branch:
- card catalog: passed;
- rules, combat, progression, effects and AI: 337/337;
- smoke: 204/204;
- UI audit: 469/469.

The smoke, release and UI audits now open Collection and Stats by their new labels, and the UI audit chooses
"Two Colors" before picking an element, because NEW GAME now restores the saved deck.

Before/after screenshots (real Chromium):

| File | Shows |
|---|---|
| [docs/ui-evidence/menu-desktop.jpg](docs/ui-evidence/menu-desktop.jpg) | Desktop 1366×768: menu and battle setup |
| [docs/ui-evidence/menu-phone.jpg](docs/ui-evidence/menu-phone.jpg) | Phone 360×740: the full menu and setup panels |
| [docs/ui-evidence/menu-landscape.jpg](docs/ui-evidence/menu-landscape.jpg) | Phone landscape 863×360: menu and setup |

### Limitations

- Only Chromium was run (desktop size and emulated touch devices). Safari/WebKit, Firefox and real phones are
  untested (§6). That includes CSS `mask` on the SVG decorations, which has been supported since Safari 15.4 and
  Firefox 53; where it is missing, the decoration just doesn't draw.
- The difficulty explanations describe `AI_PROFILES` as written. If those settings change, `DIFFICULTY_INFO` must
  change with them. The audit catches it only for the phrases it checks.
- On a fresh profile, NEW GAME starts with FIRE picked: `gameMeta.selectedDeckKey` defaults to `FIRE`, and the
  save can't tell "never chosen" from "chose FIRE".
- Difficulty is still not saved between sessions. It never was, and it is outside this pass.

## 8. Card presentation

One card presentation across the hand, both battlefields, card details and pack reveals. The emoji stays the
artwork. Catalog ids, stats, costs, inferred rarity, rules, saved data and `bindCardPress` (tap, long-press,
right-click, keyboard) are unchanged. The card catalog check and its manifest are unchanged.

### The face

| Part | Hand | Battlefield | Notes |
|---|---|---|---|
| Art | the emoji in an element-coloured window | same | **Mono:** that element's colour. **Dual:** a diagonal split between both colours (29 two-colour cards and Distant Planet). **Rainbow:** all five. **Colorless:** neutral steel (10 colorless artifacts, 3 free artifacts, Crystal Wasteland). |
| Cost (top-left) | one pip per colour with its count. Colorless is ◇N and free is 0, both on a square pip, so they differ by shape as well as colour. | hidden; the damage badge 💔N goes here | |
| Top-right | keywords (up to 3, then +N) or the type icon (✨ instant, ⚙️ artifact, ⛰️ land) | same | Instants also get a rune ring, artifacts a steel bevel, lands an earthen base. |
| Bottom-left | — | state marker: 💤 summoning sick, ⚔️ attacking | |
| Bottom-right | power/toughness on a dark chip | same | |
| Border | rarity colour: common bronze, rare blue, epic purple, legendary gold. Nothing animates. | same; enemy cards add a thin red rim | The legendary pulse, the spinning halo and the per-rarity glow are gone. |

The sizes are unchanged: 58×78 on phones (62×82 with borders), 52×68 in short landscape and 80×105 on desktop.
The larger badges apply only where the cards are larger.

### States, without relying on colour

| State | Cue |
|---|---|
| Tapped | Turned sideways (as before) and dimmed |
| Summoning sick | Dashed border, 💤 marker, faded art. Now also on **enemy** creatures, which previously had no mark. |
| Damaged | 💔N badge |
| Attacking (selected) | Lifted, with an outline and the ⚔️ marker. The looping glow is gone. |
| Playable / unplayable (hand) | Playable cards lift, with a ring. Unplayable cards sit flat, dimmed and desaturated. The looping green glow is gone. |
| Flash (any card with it) | The badge is greyed and struck through, and details label it "No effect" with the `KEYWORD_RULES` text. Flash is never shown as working. |

### Details and pack reveals

- **Card details:**
  - The art window uses the same element background, and the border shows the rarity.
  - Tags show type, rarity (●/◆/⬢/★) and element names.
  - Cost appears as pips plus text ("4 Fire + 1 Earth", "2 Colorless", "Free").
  - Power/toughness is current, with the printed values when an effect has changed them.
  - On a battlefield card, its state: tapped, damage this turn, summoning sick, attacking.
  - Each keyword shows its badge, name and the `KEYWORD_RULES` text.
  - Instants and artifacts keep the "Rules:" line from `describeEffect`, and lands list the mana they make.
- **Pack reveals:** the same element background and rarity border, with a rarity tag, cost pips and
  power/toughness.

### Implementation

- **`index.js`:** small shared helpers next to `KEYWORD_RULES`:
  - `getCardRarity`, `getCardIdentity` and `applyCardIdentity`;
  - `renderCostPips` and `describeCost`;
  - `createKeywordBadge` and `renderKeywordDetail`;
  - `CARD_TYPE_INFO` and `RARITY_INFO`.
  
  `createCardElement`, the land stacks, `showCardDetail` and `setPackOpeningCard` all use them. The art stays
  the card's first child, so existing rules that target it still apply.
- **`styles.css`:** the "CARD FACES" block at the end. Element colours are `--elc-*`, rarity colours are
  `--rarity-*`, and backgrounds use `color-mix()`.
- **Fix:** on phones, the card-details popup opens under the finger. The click that ends the long-press then
  landed on the popup and closed it at once (the new audit caught this). The popup now ignores clicks for 0.5 s
  after opening. `bindCardPress` is unchanged.

### Evidence

`tests/card-faces.mjs` (`npm run cards:ui`, also in CI) renders the following through the game's own renderers,
at phone 360×740, short landscape 863×360 and desktop 1366×768:
- representative cards of every type × element, plus dual, colorless, free, rainbow, and each rarity;
- a crowded board with every state;
- card details;
- pack reveals.

The same test was run before and after this change:

| Area | Before: failing / checks | After: failing / checks |
|---|---|---|
| Faces (exact cost incl. colorless and free, P/T, element identity, distinct and dual backgrounds, type marker) | 18 / 21 | 0 / 21 |
| Rarity (distinct borders, nothing animating forever) | 3 / 6 | 0 / 6 |
| States (non-colour cues, enemy summoning sickness) | 3 / 18 | 0 / 18 |
| Keywords (badge + label + rules text in details; Flash inactive) | 6 / 9 | 0 / 9 |
| Details (type, rarity, elements, cost, P/T, board state) | 9 / 15 | 0 / 15 |
| Pack reveal (rarity, type, cost, P/T; colorless ◇) | 6 / 6 | 0 / 6 |
| Layout (overflow, badges inside cards, ≥ 10 px text, compact phone cards, controls on screen) | 0 / 13 | 0 / 13 |
| Input (long-press inspects without playing; one tap plays one land) | 1 / 4 | 0 / 4 |
| Page errors | 0 / 3 | 0 / 3 |
| **Total** | **46 / 95** | **0 / 95** |

Screenshots (before | after):

| File | Shows |
|---|---|
| [docs/ui-evidence/cards-phone.jpg](docs/ui-evidence/cards-phone.jpg) | Phone: the hand-face gallery, and a crowded board |
| [docs/ui-evidence/cards-desktop.jpg](docs/ui-evidence/cards-desktop.jpg) | Desktop: a crowded board with tapped, sick, damaged and attacking creatures, dual, rainbow and colorless lands, and a mixed hand |
| [docs/ui-evidence/cards-landscape.jpg](docs/ui-evidence/cards-landscape.jpg) | Phone landscape board |
| [docs/ui-evidence/cards-details.jpg](docs/ui-evidence/cards-details.jpg) | Details: keywords and board state; pack reveal |

**Limitations:**
- Chromium only. `color-mix()` needs Safari 16.2+ or Firefox 113+. Older browsers fall back to the previous flat
  card background, and every marker and badge still shows.
- Crowded rows still scroll sideways on phones, as before.
- The audit's representative cards are chosen from the live catalog by rule (first match), not hand-picked.
- The graveyard list, Binder and Deck Builder rows keep their old list layout. This pass covers the hand,
  battlefield, details and pack reveal.

## 9. Collection (Binder) and Deck Builder

Usability for the two list screens. Deck legality (`validateDeckBuild`), copy limits, land caps, progression,
collection counts, card ids, all 15 decks and the save format are unchanged. Browsing and unsaved edits never
write to the save.

### What changed

| Area | Before | After |
|---|---|---|
| Binder contents | Owned cards only, sorted by name | All 268 cards. Unowned ones have a dashed row, a grey art tile, a "Not owned" tag and `x0`. Ownership views: all, owned, not owned. |
| Binder totals | "153 unique cards • 300 total cards" | "153 of 268 unique cards • 300 total cards", plus "Showing N of 268 cards" for the current filters |
| Search, filter, sort | none | **Search:** name, card text and keyword names. **Filters:** element (each colour, "two or more colours", colorless), type, mana value (0–5, 6+), rarity, ownership. **Sort:** name, mana value, rarity, type, copies owned. The filters combine, and "Clear" resets them. On narrow phones the selects fold under "Filters & sort (N on)" while search stays visible. |
| Deck Builder pool | Owned eligible cards, name only | Every card legal for the deck, filtered as above (owned by default). Each row has the element art tile, cost pips, type, power/toughness, keywords, rarity, "In deck N · Owned M" and an ⓘ button for the full card details. |
| Disabled Add | Enabled until the deck was full; a blocked press showed a reason afterwards | A greyed (`aria-disabled`) + with the reason under the card and in its tooltip: **not owned**, **all owned copies in the deck**, **copy limit** (2, or 1 legendary), or **deck full**. Pressing it repeats the reason in the status line. The reasons are the same limits the save checks. |
| Deck list | Name and count, sorted by name | Grouped into creatures, spells, artifacts and lands, cheapest first, with the same row preview and ⓘ |
| Summary | "Deck size: 60/60" | Cards out of 60, lands (with the cap), creatures, spells, artifacts, and a mana curve (0–5, 6+, non-land cards), all from the working deck |
| Errors | The validator's sentences in the status line after a failed save | A live list of what stops the save, each with a fix where one is clear: "Add 1 more card", "Too many lands: 21 (at most 20). Remove 1 land" [Remove 1 land], "X: 3 in the deck, but you own 2. Remove 1" [Remove 1], "X isn't legal in a Fire deck" [Remove X]. A one-colour deck shows its single land cap once. |
| Unsaved edits | Leaving or switching decks dropped them silently | A "● Unsaved changes" marker. BACK, Esc or switching decks asks "Discard them?": No keeps the draft (and the deck picker), Yes discards. Filters never touch the draft. |
| Deck picker | Keys (`FIRE_WATER`) | Names ("🔥 Fire + 💧 Water"); the option values are still the keys |

### Implementation

- **`index.js`:**
  - Shared list helpers before `renderBinderCollection`: `CARD_FILTER_OPTIONS`, `cardFilterState`,
    `cardMatchesFilters`, `sortCardsForList`, `buildCardFilterBar`, `resetCardFilters`, `renderCardRowMeta`
    and `createCardRowArt`. They reuse the card-face helpers from §8 (`getCardIdentity`, `renderCostPips`,
    `CARD_TYPE_INFO`, `RARITY_INFO`).
  - Deck Builder: `getAddBlockReason`, `getDeckIssues`, `isDeckBuilderDirty`, `confirmDiscardDeckEdits`,
    `renderDeckBuilderSummary` and `loadDeckIntoBuilder`, plus a guard in `backToMenu`.
  - `getDeckIssues` runs `validateDeckBuild` first and returns nothing when it accepts the deck. Every error
    it reports becomes an issue; one it doesn't recognise is shown verbatim.
- **`styles.css`:** the "COLLECTION AND DECK BUILDER" block. Controls are 44 px. Text contrast doesn't rely on
  opacity: only the decorative art tile of unowned cards is faded.
- **DOM contracts kept:**
  - `#binderList .binder-row` with `.binder-row-name` (the name first) and `.binder-row-count` (`xN`);
  - `#deckBuilderPool` / `#deckBuilderDeck .deck-builder-row`, where the first button adds or removes and
    `.deck-builder-name` reads "emoji name";
  - `#deckBuilderStatus` "Deck size: N/60";
  - SAVE disabled until the size is right;
  - `#binderSummaryBadge` and `#deckBuilderDeckKey`.
- **Fixed during the pass:** the battle-setup summary from §7 is also named `renderDeckSummary`. Function
  declarations with the same name override each other silently, so the Deck Builder's summary uses
  `renderDeckBuilderSummary`.

### Evidence

`tests/collection.test.mjs` (`npm run collection`, in CI with the rules suites) has 11 browser tests:
- **Binder:**
  - full catalog, unowned rows marked, totals, owned and not-owned views;
  - 11 filter combinations, each checked against an independent computation from the catalog, plus the 4
    sort orders;
  - a row opens its rules.
- **Pool:** 7 filter combinations over the deck's legal cards, with the draft unchanged after each.
- **Rows:** in-deck and owned counts, cost and stats. Every Add reason (not owned, no copies left, copy limit
  including legendary, deck full). A blocked press adds nothing and explains itself.
- **Summary and curve:** they match the working deck before and after edits.
- **Invalid deck:** 21 lands. The save is refused, the save data stays byte-identical, and the issue's action
  fixes it. The issues agree with `validateDeckBuild`.
- **Unsaved edits:** BACK, Esc and switching decks ask. No keeps the draft, Yes discards it.
- **Saving:** a saved edit survives a reload and reopens clean.
- **Existing save** (`tests/fixtures/saves/existing.json`): browsing plus unsaved edits never change the stored
  save; totals match the fixture; all 15 decks open legal at 60 cards with no issues.

| Suite | Before (`42040ff`) | After |
|---|---|---|
| `tests/collection.test.mjs` | 0 / 11 | 11 / 11 |
| Card catalog | pass | pass |
| Rules, combat, progression, collection, effects, AI (node) | 337 / 337 (without collection) | 348 / 348 |
| Smoke | 204 / 204 | 204 / 204 |
| UI audit | 469 / 469 | 469 / 469 |
| Menu audit (Collection and Deck Builder screens at 4 sizes: 44 px controls, 11 px text, axe including contrast) | 289 / 289 | 289 / 289 |
| Card faces | 95 / 95 | 95 / 95 |
| Release playthroughs | 97 / 97 | 97 / 97 |

Two existing tests changed with the new screens:
- The progression test's Binder check uses the "Owned" view and the new summary text. The counts it asserts are
  the same.
- The smoke Deck Builder check targets a row's first button (add/remove), since rows now also have ⓘ.

Screenshots (`npm run collection:shots` for the states; before | after):

| File | Shows |
|---|---|
| [docs/ui-evidence/collection-phone.jpg](docs/ui-evidence/collection-phone.jpg) | Phone 360×740. **Collection:** before, after, and filtered by Fire, rarest first, with unowned cards. **Deck Builder:** before; after with an edit over the land cap (unsaved marker, summary and curve, the issue and its fix); the unsaved-changes question. |
| [docs/ui-evidence/collection-deckbuilder-desktop.jpg](docs/ui-evidence/collection-deckbuilder-desktop.jpg) | Desktop: the same Deck Builder state, with creature filters and blocked-Add reasons |

### Limitations

- Chromium only, as for the other UI passes. `<details>` and `aria-disabled` are widely supported.
- The pool's ownership filter defaults to "Owned cards", as before. "All legal cards" shows unowned ones with
  the not-owned reason.
- Filter choices are kept for the session, not saved.
- The "Remove N lands" fix removes the most numerous basic land (of that colour, for a colour cap). Players who
  want a specific land can remove it themselves.
- Land caps are not checked when a land is added (the validator only checks them on save, as before). They show
  up at once in the issue list instead.

## 10. Gameplay feedback

Clearer information during a match. Combat rules, random targeting, automatic blocking, mana, rewards and
timers are unchanged. Nothing here reveals the AI's hand.

### What changed

| Area | Before | After |
|---|---|---|
| Whose turn | A small header pill ("MAIN PHASE", "ENEMY TURN"), hidden on phones by the title | A banner above the battlefield: **Turn N**, "⚔️ Your turn · Main phase / Choose attackers" or "🤖 Enemy turn · *what the AI is doing*". It pulses once (0.6 s) when the turn changes, and not at all under reduced motion. It is a polite live region. The header pill stays on wider screens. |
| AI status | Toasts only | The banner names each paced AI step: starting its turn, drawing a card, playing a land (named, since it is now public) or none, tapping mana / choosing what to play, the card it plays, plays nothing, attacking with N / not attacking. |
| Attacker selection | ATTACK became CONFIRM; END TURN was disabled | **✓ CONFIRM n** (the count, with a matching accessible name) and **✕ CANCEL**, which leaves without attacking and keeps the attack available. `Space`/`E` still mean END TURN, which waits until you confirm or cancel. |
| Why a creature can't attack | Logged after a click | In attack selection, eligible creatures get a dashed outline; the others say why on the card ("Tapped", "Defender", "Next turn"), in the tooltip and in the accessible name. The text comes from `getAttackRestriction`, which `canAttack` uses. |
| Why a hand card can't be played | Logged after a click | Unplayable cards are dimmed with a reason chip ("Land used", "🔒🔥2") and the full reason in the tooltip, accessible name and card details: "Wait for your turn", "One land per turn: you have played one", "Needs 2 🔥 more in your mana pool (1 untapped land)". `getPlayRestriction` makes the same checks as `playCard`, in the same order. |
| Combat preview | none | While attackers are chosen, a **Preview** strip under the banner: "Enemy ❤️ 20 → 15 · Enemy loses 5 · You lose 0" (or "🏆 Wins the match"). "Blocks and results" opens one line per attacker ("🦁 Fire Lion: blocked by 🪲 Ember Beetle · Ember Beetle dies · Fire Lion survives · Enemy ❤️ -2"), with the note "Not final. Blocking is automatic and uses the board as it is when you confirm." Cards are marked ✓ survives / ☠ dies / 🛡 blocks, also in their accessible names. |
| Match history | none (toasts disappear) | **📜** in the header (or `H`) opens a dialog listing the last 80 events, grouped by turn: turns, plays and what they did (life, damage, stats, destroyed / returned / entered cards, draws, discards), upkeep effects, each attack with its per-attacker blocks, damage, deaths and life change, "Enemy does not attack", mulligans and the result. A badge counts entries since it was last opened. It uses the shared dialog handling (focus moves into it; `Esc`, ✕ or the backdrop closes it). |

### How the preview stays pure and exact

- `applyDamage` and `dealUnblockedDamage` take a life target that defaults to the live one
  (`changePlayerLife`/`changeEnemyLife`).
- `previewCombat(attackers, defendingBoard, isPlayerAttacking)` copies the creatures, calls the same
  `assignAutoBlockers` on the copies, and runs the same damage code into its own life ledger. That ledger follows
  the live rules: life stops at 0, nothing changes after a loss, and the player is checked first.
- It never touches `gameState`, the save, `Math.random`, timers, sounds, particles or rewards. The tests check
  this with a fingerprint of the state plus spies on randomness and timers.
- Combat deals no random damage and has no death triggers, so the prediction is exact for the current board.
- The preview is keyed on the chosen attackers, each creature's power, toughness, damage, tapped state and
  abilities, and both life totals. It is recomputed only when that key changes, at the start of each UI update.
  Outside attacker selection it is hidden and cleared.

### Match history, recorded once

- `recordHistory` is called from the engine where things resolve: `playCard`, `aiPlayCard` and the AI's
  land / fallback plays, upkeep, `resolveAttackersWithHistory` (both sides' combat), turn starts, mulligan and
  `finalizeMatch`.
- Rendering only reads `matchHistory`, so opening, closing or re-rendering never adds entries.
- Each per-attacker line comes from `describeCombatPair`, the same function the preview uses. The parity tests
  compare the two texts directly.
- Only public information is written: cards as they are played or revealed, and counts for draws.

### Implementation

- **`index.js`:**
  - Match history: `recordHistory`, `describeChangesSince`, `describeCombatPair`, `resolveAttackersWithHistory`,
    `renderMatchHistory`, `showMatchHistory` / `hideMatchHistory` (registered in `GAME_DIALOGS`).
  - Reasons and status: `getPlayRestriction` / `getMissingMana`, `setAiStatus` / `updateTurnBanner`.
  - Preview: `previewCombat`, `refreshCombatPreview`, `renderCombatPreviewPanel`, `markPreviewOutcome`.
  - Attack controls: `setAttackControls`, `cancelAttack`.
  - A turn counter, `gameState.round`.
- **`index.html`:** `#turnBanner` (with `#combatPreview`), `#historyBtn` with `#historyBadge`, and the
  `#historyModal` dialog.
- **`styles.css`:** the "GAMEPLAY FEEDBACK" block. Below 520 px the header phase pill is hidden (the banner
  replaces it). Animations stop under `prefers-reduced-motion`.
- **Kept:** END TURN / ATTACK ids and shortcuts, and `#phaseIndicator` (no longer a live region, so the banner
  isn't announced twice).

### Evidence

`tests/feedback.test.mjs` (`npm run feedback`, in CI with the rules suites) has 55 browser tests:
- **Parity, 21 scenarios × both sides (42 tests):**
  - first strike (attacker, blocker, both);
  - double strike (unblocked, into a tough blocker, with trample);
  - trample (over a chump, into a damaged blocker, against deathtouch);
  - deathtouch (attacker, blocker, with first strike);
  - menace (one blocker left so it is unblocked, two blockers, against a first striker);
  - lifelink (blocked, unblocked, blocked and dying);
  - and a mixed three-attacker board.
  Each one is previewed, checked to have changed nothing, then the real attack resolves and the result is
  compared: both life totals, which creatures died, damage left on survivors, and the history line for each
  attacker.
- **Lethal (2 × both sides):** the match ends part-way. Lifelink after the killing blow is ignored and life stops
  at 0, in the preview and in the game.
- **Selection:** CONFIRM count / CANCEL, `Space` refused mid-attack, the attack still available after CANCEL.
- **Reasons:** creature reasons match `getAttackRestriction`. Each hand-card reason predicts whether `playCard`
  plays it (2 Fire mana with no land played, then with a land already played).
- **Staleness:** the only blocker tapping, a life change and selecting or deselecting an attacker each refresh
  the preview; it is hidden outside attacker selection and on the enemy turn.
- **Banner, AI status, motion:** the turn number and side, the AI steps seen during a real enemy turn, a single
  short pulse, and no animation under reduced motion.
- **History:** recorded once (re-rendering adds nothing), bounded at 80, opened from the header and `H`,
  focus inside the dialog, closed with `Esc`, and no AI hand card named before it is played (over several real AI turns).

| Suite | Before (`aa5c31a`) | After |
|---|---|---|
| `tests/feedback.test.mjs` | 0 / 55 | 55 / 55 |
| Card catalog | pass | pass |
| Rules, combat, progression, collection, effects, AI (node) | 348 / 348 | 348 / 348 |
| Smoke | 204 / 204 | 204 / 204 |
| UI audit (the battle screen with the banner, at 4 sizes) | 469 / 469 | 469 / 469 |
| Menu audit | 289 / 289 | 289 / 289 |
| Card faces | 95 / 95 | 95 / 95 |
| Release playthroughs (on the code commit, in a clean worktree) | 97 / 97 | 96 / 97 on the full run, then 5 / 5 on a long-match re-run (see below) |
| `tests/feedback-shots.mjs`: page errors and serious axe violations (including contrast), with the preview open and in the history dialog, at desktop, phone and phone-landscape | n/a | none |

**The one release failure.** On the first full run, the long-match check "event listeners don't accumulate"
failed: 251 → 801, against a limit of 1.5 × the turn-10 count + 200. That run's board grew to 124 permanents
(22 + 102); earlier runs had 64–80. Listeners follow board size (about 4–5 per permanent), as QA_REPORT.md
notes, and the check compares against turn 10, not against the board. Three things show it isn't a leak from
this pass:
- **Fixed board, new interactions:** 40 rounds of selecting attackers, cancelling, re-rendering and opening and
  closing the history keep listeners flat (225 → 225; the old code: 222 → 222).
- **Old and new code side by side (long match only):** old 237 → 479 with 71 permanents; new 229 → 438 with 66
  permanents. Both pass all 5 performance checks.
- **Heap and time:** both stayed bounded in every run.

The check's limit can still be crossed by an unusually large board. It is unchanged in this pass.

Screenshots (`npm run feedback:shots`): before, then after (selection, preview details, enemy turn, history).

| File | Shows |
|---|---|
| [docs/ui-evidence/feedback-phone.jpg](docs/ui-evidence/feedback-phone.jpg) | Phone 360×740 |
| [docs/ui-evidence/feedback-landscape.jpg](docs/ui-evidence/feedback-landscape.jpg) | Phone landscape |
| [docs/ui-evidence/feedback-desktop.jpg](docs/ui-evidence/feedback-desktop.jpg) | Desktop 1366×768 |

### Limitations

- The preview covers the attack the player is choosing. The AI's attacks are recorded in the history, not
  previewed: the AI confirms at once.
- The preview predicts combat only. Nothing else can happen between CONFIRM and damage today; if instant-speed
  responses are ever added, the preview's note would need to say so.
- The history keeps the last 80 events of the current match only, in memory. It is not saved and resets with a
  new match. Older entries are dropped and the dialog says how many.
- Chromium only, as for the other UI passes. Real-device checks are still listed in §6.

## 11. Pack Shop and pack opening

Pack membership, pools and odds are in [CARD_AUDIT.md](CARD_AUDIT.md) §7. This section covers the screens.

**Unchanged:**
- prices, pack size, rewards and the save format;
- `purchasePack`, `openPackOpeningOverlayFromMeta`;
- the rip gesture and the swipe between cards;
- the ids the existing tests use: `.shop-pack-btn[data-theme]`, `#packTearSurface`, `#packPrevBtn`,
  `#packNextBtn`, `#packCloseBtn`, `#packCardName`, `#packCardCounter`.

### What changed

| Area | Before | After |
|---|---|---|
| Shop tiles | Six gradient buttons, "🧙 Fantasy Pack · 60 Credits". Nothing said what was inside or whether you could afford it. | One tile per pack: <ul><li>CSS-and-emoji art in the pack's colours, with foil stripes, a crimped edge and four of its rarest cards;</li><li>the name and a price chip ("💳 60");</li><li>a one-line description;</li><li>the slots ("3 × Common · 1 × Rare · 1 × Epic/Legendary");</li><li>"N cards · you have M";</li><li>BUY and What's inside.</li></ul> Three columns on wide screens, one on phones. |
| Affordability | Learnt only after pressing | Short of credits, a tile shows "NEED 20 MORE" on a dashed button, a muted wrapper and "You have 💳 40 of 60". The button's accessible name says the same. It stays pressable and explains in the status line; nothing is charged. It updates whenever credits change. |
| Contents preview | none | **What's inside** (dialog): <ul><li>the description;</li><li>how many cards the pack can contain and its slots;</li><li>for each rarity, how many cards there are and the exact chance of each one being in a pack (from `getPackOdds`);</li><li>any fallback note ("Card 5: this pack has only 1 Epic/Legendary card, so it can also be Rare.");</li><li>every card, rarest first, with art tile, cost, type, power/toughness, keywords, rarity, and "Owned ×N" or "Not owned".</li></ul> BUY inside it closes it and buys. Esc, ✕ or the backdrop closes it, with the same focus handling as other dialogs. |
| Sealed pack | 📦 on an orange panel; drag only | The pack's own art, icon and name. The instruction says "Slide across the pack to rip it open, or press OPEN PACK", and there is an **OPEN PACK** button. A win pack's title names its theme: "🎁 Victory Pack · Robot". |
| Card reveal | Emoji, name, type, rarity, cost and power/toughness | Also the keywords as chips (Flash marked inactive), the rules line for instants and artifacts (`describeEffect`), the mana for lands, the creature's flavour line, and **✨ NEW · First copy** or **You own 3 (had 2)**. NEW compares with ownership **before** the pack (§ below). The counter is a polite live region. |
| Summary | none | **ALL 5 CARDS** (always there, highlighted on the last card) shows the five cards with their rarity and NEW or "Own N", plus a line such as "2 new to your collection · Best: Battle Mech (Epic)". Each card jumps back to its reveal. Focus moves to **DONE**, which closes the pack, as ✕ does. NEXT still stops at the last card. |

### NEW, and purchases charged once

- `addPackToCollection` records each card's count just before the pack is added. That record is in memory only,
  so the save keeps `lastPack { themeKey, cardIds, openedAt }` exactly.
- After a reload, `getPackOwnedBefore` works the count out as "owned now − 1", because a pack never holds a card
  twice.
- `purchasePack` refuses while a pack is open (`pack_open`): a second click, tap or Enter buys nothing. Win
  rewards were already recorded once (`matchFinalized`).

### Evidence

`tests/packs.test.mjs` (`npm run packs`, in CI with the rules suites) has 16 browser tests:
- **Pools:**
  - membership covers exactly the 268 catalog ids, and every card is in a pack;
  - the Alien and Robot pools hold the alien and robot cards and no Nature/City filler;
  - Science Fiction keeps all 56 Science Fiction cards;
  - Lands is exactly the 8 lands, without Badlands Boar.
- **Generation:**
  - 3000 seeded packs per pack: 5 different cards, all from the pool, each slot from its planned tiers, and
    every pool card pulled at least once;
  - tier rates match `getPackOdds`;
  - per-card rates for Robot, Lands and Alien match it too (6000 packs each).
- **Fallbacks:** Robot's widened slot 5 and its note, a 3-card pool completed from the catalog, an unknown pack.
- **Unchanged:** prices, pack size, win credits and theme weights.
- **Shop:**
  - each tile's price, slots, owned count and art;
  - affordability at 50 and at 60 credits;
  - What's inside for all six packs: exactly the pool, owned counts, every percentage and note; Esc closes only
    the dialog;
  - one charge for a double click, Enter twice in the dialog, and a call while the pack is open;
  - short of credits: nothing saved, the message, "NEED 10 MORE".
- **Opening:**
  - NEW only for cards owned 0 before the pack, and "You own 3 (had 2)" for the rest; the summary agrees;
  - after a reload, NEW is still right and `lastPack` keeps its three keys;
  - OPEN PACK with the keyboard; full information for a creature, an artifact, a land, an instant and a
    legendary; DONE closes;
  - win reward: +25 and one pack, once; the title names the theme; the cards come from that pool.
- **Saves:** the existing-save fixture buys, reloads and keeps its keys, collection, `lastPack`, credits and
  decks.

| Suite | Before (`82612af`) | After |
|---|---|---|
| `tests/packs.test.mjs` | 1 / 16 (only the existing-save test) | 16 / 16 |
| Card catalog (with the new membership checks) | pass | pass |
| Rules, combat, progression, collection, effects, AI, feedback (node) | 403 / 403 | 403 / 403 |
| Smoke | 204 / 204 | 204 / 204 |
| UI audit | 469 / 469 | 469 / 469 |
| Menu audit (the Pack Shop at 4 sizes: 44 px controls, 11 px text, axe including contrast) | 289 / 289 | 289 / 289 |
| Card faces (pack reveal checks) | 95 / 95 | 95 / 95 |
| Release playthroughs (on the code commit, in a clean worktree; packs bought with a duplicate tap, win packs ripped) | 97 / 97 | 97 / 97 |
| `tests/pack-shots.mjs`: page errors and serious axe violations (including contrast) in the shop, What's inside and the summary, at desktop, phone and phone-landscape | n/a | none |

**Existing tests changed:**
- The progression test's pack-slot check now reads the slot plan. It expects 3 Common, 1 Rare and 1 Epic+ for
  every pack, including Lands now that it holds only lands, and Epic or Rare for Robot's card 5.

**Fixed during the pass:**
- The first version marked unaffordable BUY buttons `aria-disabled`. Playwright then refused to press them, and
  the smoke test caught it.
- Pressing an unaffordable BUY is meant to explain, so the button is no longer marked disabled. Its label says
  how many credits are missing.

Screenshots (`npm run packs:shots`; before, then after):

| File | Shows |
|---|---|
| [docs/ui-evidence/packs-phone.jpg](docs/ui-evidence/packs-phone.jpg) | Phone 360×740. **Before:** the shop and a "Robot" pack that revealed Growth. **After:** the shop at 50 credits, What's inside (Robot), the sealed Robot pack, a reveal with NEW, and the summary. |
| [docs/ui-evidence/packs-desktop.jpg](docs/ui-evidence/packs-desktop.jpg) | Desktop 1366×900: the same, with three tile columns |
| [docs/ui-evidence/packs-landscape.jpg](docs/ui-evidence/packs-landscape.jpg) | Phone landscape: the shop, What's inside, a reveal and the summary |

### Limitations

- In phone landscape the fuller reveal is taller than the screen. The panel scrolls to PREV/NEXT, as it did for
  the shorter reveal.
- The odds shown are exact for the pack's slots; they don't include the win-pack theme weights.
- The art is CSS and emoji, so it depends on the device's emoji font, like the cards.
- Chromium only, as for the other UI passes.

## 12. Visual themes and logo

Branch audit at the start of the pass: the six earlier visual/UX passes (menu, cards, collection, feedback, packs,
cleanup) are all on `main` (`397089f`). This pass branches from there (`claude/visual-themes`).

**Unchanged:**
- the menu routes and `data-menu-target`s, the intro skip flow (tap → intro → tap to skip);
- accessible names: the menu logo is still a level-1 heading named "Emoji Elements", and the controls, dialogs and
  ids are unchanged;
- keyboard navigation, saved decks, the save format and the game rules.

### One interface, three token sets

A theme is only a set of tokens on `<html data-theme="arcane|deep-space|neon">`, plus `[data-ui-theme]` on the
picker's options, so each option previews itself. The rules after the token sets (styles.css "VISUAL THEMES") are
shared by all three. There are no per-theme copies of the interface.

| Token group | Arcane Fantasy (default) | Deep Space | Neon Sci-Fi |
|---|---|---|---|
| Background | violet ink `#090611`→`#23113d`, soft violet and crimson glows | navy `#04060d`→`#0e1a35`, a sparse fixed starfield, two faint nebulae | near-black `#05040a`, a faint 44 px grid fading towards the top, a magenta horizon |
| Accent (`--gold-1`, fills) | gold `#f2cf72` | ice blue `#9fd6ff` | cyan `#5cefff` |
| Second accent (`--accent`) | violet `#8a7dff` | periwinkle `#8f9bff` | magenta `#ff4fd8` |
| Danger / ATTACK | crimson | rose | hot pink-red |
| Display / headings / UI type | Uncial Antiqua / Cinzel / MedievalSharp | Exo 2 | Orbitron (logo) / Chakra Petch |
| Element colours (`--elc-*`) | the card-pass colours | slightly cooler | more saturated |
| Same in all three | Inter body text, rarity colours, card layout and state markers | | |

How the old rules were moved onto tokens, without changing how anything looked first:
- 322 literal colours and fonts in older rules were replaced by tokens with Arcane's values. Examples: the gold
  `#ffd700`, the violet `rgba(138,125,255,…)` and the card bases `#1b1030`/`#140b22`.
- The computed-style fingerprint of 24 screen states (14,830 elements, about 62 properties each) was identical
  before and after. Only then were the themes and the new components added.

**Storage:**
- The theme is saved under `localStorage.emoji_elements_theme`, apart from the profile
  (`emoji_elements_meta_v1`).
- An inline script in `<head>` applies it before the first paint. An unknown value falls back to Arcane, and
  blocked storage means the theme lasts the visit.
- RESET PROGRESS removes only the profile, so it keeps the theme. Switching theme never writes the profile.

### Logo

- **Mark:** `#ee-sigil`, an inline SVG symbol: a ring and pentagram in the theme's accent, with the five element
  nodes in `--elc-*`.
- **Wordmark:** live text. A small tracked "EMOJI" sits above "Elements" in the theme's display face, with a
  gradient fill (gold, starlight-to-ice, or cyan-to-magenta). It has no animation.
- **Three sizes:**
  - hero: the sigil above the stacked wordmark (start screen);
  - menu: the sigil beside it;
  - bar: one line in the match header. "EMOJI" is hidden at 420 px and below so the header keeps its room.
- Each theme scales the logo (`--logo-scale`), because Orbitron is much wider than Uncial.
- The ⚔️ swords around the old all-caps title are gone.

### Start screen and main menu

- **Start screen:**
  - a panel with the hero logo, the tagline, one pill-shaped **▶ Click to start** and a quiet hint ("Sound on ·
    tap or click anywhere");
  - the old 2-second opacity pulse is replaced by one 0.7 s rise;
  - the intro and its skip are unchanged.
- **Main menu:**
  - the logo;
  - V2 BETA beside a **Theme: …** chip (a 44 px button with a three-colour swatch);
  - the tagline, the credits and collection chips, then the six entries.
  - **NEW GAME** stays the one large accent tile. It now has a › that moves on hover and lifts slightly. After
    the first battle its second line names the deck it will start from ("Last deck: 🔥 Fire + 💧 Water").
- The menu sits on a 42 % scrim over the theme background (stars, grid) instead of 95 % black.
- Outside Arcane, the gold divider takes the theme's accent.
- Hover and focus states:
  - tiles brighten their border and icon ring;
  - every new control has a 3 px focus ring in `--gold-2`.

### Theme picker

- **Where:** the menu chip, or 🎨 THEME in the pause menu. It opens above the pause menu.
- **Structure:** a `role="radiogroup"` of three `role="radio"` buttons with a roving tabindex.
- **Each option** is drawn in its own theme: a sigil, three swatches, the name in that theme's heading font, and
  a description. The chosen one has a 2 px ring and the text "✓ Selected", so the choice isn't shown by colour
  alone.
- **Keys:** arrow keys, Home and End pick a theme immediately; Esc, ✕ or the backdrop close the picker.
- **Dialog handling:** it is in `GAME_DIALOGS`, so focus is trapped while it is open and returns to the chip
  (or THEME) when it closes. From the pause menu, Esc closes only the picker.

### Comfortable during a long match

| Before | After |
|---|---|
| Phase label glowed in and out every 2 s (`phaseGlow`) | still |
| ATTACK pulsed every 1.2 s whenever it was enabled (`attackPulse`) | a steady red fill with a thin ring |
| Enemy turn: phase label pulsed every 1.5 s (`enemyPulse`) | a steady red label and a stronger enemy border |
| VICTORY / DEFEAT text scaled 1 → 1.1 every second, forever (`victoryPulse`) | pops in once |
| Base rules for playable and attacking cards still had looping glows (hidden by later rules) | set to none, so nothing can bring them back |
| MULLIGAN royal blue, GRAVEYARD and END TURN bright gold gradients, all with outer glow | MULLIGAN and GRAVEYARD are quiet panel buttons; END TURN is the one accent fill |
| Hand: 3 px double gold border with glow | 1 px accent line (padding +2 px keeps the same inner size) |
| Result banners: full-screen gold or red wash | a dark scrim with the theme's glow |

With reduced motion, the one-off entrances (start panel, result text) are also off (the existing global rule).

### Evidence

All suites were run on the battle-pause branch, which contains this pass, in headless Chromium.

| Check | Result |
|---|---|
| `npm run themes` (`tests/theme-audit.mjs`): 3 themes × desktop 1366×900, phone 360×740, landscape 740×360; 10 screens each, axe including contrast, measured label contrast, overflow, clipping, logo fit, looping animations; storage, keyboard and reduced-motion checks | **1209 / 1209** |
| Menu audit, once per theme (`--theme=`) | 289 / 289 × 3 |
| UI audit, once per theme | 469 / 469 × 3 |
| Card faces, once per theme | 95 / 95 × 3 |
| Smoke | 204 / 204 |
| Release playthroughs | 97 / 97 |
| Node suites (rules, combat, effects, progression, collection, feedback, packs, regression, AI) | 430 / 430 |
| Cross-browser | Chromium 20 / 20; Firefox and WebKit not installed (NOT TESTED) |

**Contrast and layout failures found, and fixed in the pass:**
- **MAIN MENU on the victory and defeat banners:** white on cornflower blue, 3.27:1. It is now a themed
  secondary button, 12:1 or better.
- **MULLIGAN:** light text on royal blue when enabled. It is now a panel button.
- **The theme picker in short landscape:** the selected option opened below the fold, half hidden. It now scrolls
  into view, and the options are compact.

**Contrast that axe can't judge:** axe marks text over gradients as "needs review". The theme audit therefore
also measures key labels against the pixels behind them; 621 measurements, the lowest 6.04:1 (ATTACK in Deep Space on a phone; AA needs 4.5).

**Remaining limits:**
- Logo text uses a gradient fill, so it is checked by eye only.
- Firefox, WebKit and real devices are not tested.

Screenshots (theme audit):

| File | Shows |
|---|---|
| [docs/ui-evidence/themes-desktop.jpg](docs/ui-evidence/themes-desktop.jpg) | Desktop: start, menu, picker and match in each theme |
| [docs/ui-evidence/themes-phone.jpg](docs/ui-evidence/themes-phone.jpg) | Phone 360×740: start, menu, picker, match and pause in each theme |
| [docs/ui-evidence/themes-landscape.jpg](docs/ui-evidence/themes-landscape.jpg) | Phone landscape 740×360: menu, match and attack preview in each theme |

## 13. Battle screen and pause

This pass builds on §12 (branch `claude/battle-pause`, from `claude/visual-themes`). It changes how the match
reads and how pause behaves.

**Unchanged:**
- combat calculations, the preview (`previewCombat`), rewards, saves and card interactions;
- the ids and texts the existing tests use. The pause buttons still contain RESUME and MAIN MENU, and MAIN
  MENU still goes through `confirmQuit`.

### Findings at the start

Measured on a crowded late-game board (12 cards a side, 7 in hand) at 1366×900, 360×740 and 640×360:

| Finding | Evidence |
|---|---|
| **Pause didn't pause.** The panel covered the screen, but the AI's turn kept running on its timers. | Pause right after END TURN, wait 7 s: the AI drew, played two cards and attacked, history went from 1 to 6 entries, your next turn started, and a toast showed **above** the pause panel. |
| Toasts sat in the middle of the screen, over cards | On every size; in 640×360 landscape they covered the enemy's creatures. |
| Selected attackers and predicted blockers were both red outlines | Solid red and dashed red; easy to mix up at a glance. |
| The predicted outcome (✓, ☠, 🛡) was centred on the card | It covered the creature's art. |
| The deck count was as loud as life | Same size, accent colour and glow; no label. |
| During the enemy turn your side dropped to 60 % opacity at 70 % brightness | Your creatures were hard to read just when the AI attacked them. |
| Nothing showed what the AI had just done, apart from a toast and the banner | You had to compare boards. |
| The pause panel offered only Resume, Main menu and Theme | Large gold buttons of equal weight; Main menu between the other two. |

### Pause

How pausing works:
- **Timers:** the match's own timers go through `matchDelay`. These are the AI turn's steps, its 12 s failsafe,
  the action-lock failsafes and releases, and the toasts. `pauseGame` freezes them, keeping the time each had
  left; `resumeGame` re-arms them with that time. A step 1 s from firing still waits 1 s after RESUME.
- **Input:** the board becomes `inert`, so no clicks, taps, focus or keys reach it. The actions themselves
  (`playCard`, `tapLand`, `endTurn`, `enterAttackPhase`, `selectAttacker`, `mulligan`, `activateArtifact`,
  tap all) also return while paused.
- **Presentation:** CSS animations on the board hold, effect particles are dropped, the toast hides, and the
  music drops to 40 % (back up on resume).
- **Focus:** it moves to RESUME and stays inside the panel; RESUME or Esc returns it to where it was (the
  dialog code in `GAME_DIALOGS`).
- **Hidden page:** the match pauses itself when the page is hidden (another tab or app).
- **Leaving:**
  - MAIN MENU uses the existing confirmation. NO returns to the still-paused match.
  - YES leaves and clears the paused state, the old match's timers and its pending toasts. (Before, a combat
    report's hold could also delay a menu message.)

The panel, top to bottom:
1. **PAUSED**, with "Turn 10 · Your turn · You ❤️ 7 · Enemy ❤️ 11".
2. **RESUME**: the one filled, accent-coloured button.
3. **Settings**, as rows with switches. The switches are `role="switch"`, and each shows ON/OFF in text as
   well as colour.
   - **Sound:** the existing mute; the header 🔊 agrees.
   - **Music:** effects stay on; disabled while Sound is off.
   - **Haptics:** a short buzz on long-press and when you take damage. On devices without vibration it reads
     "Not available on this device" and is disabled.
   - **Theme:** opens the §12 picker on top; Esc closes only the picker.
   - Each setting is saved under its own key (`emojiElementsMuted`, `emojiElementsMusicOff`,
     `emojiElementsHaptics`), never in the profile.
   - The sound pass that followed added Effects and the two volume sliders, and the same rows on the main menu
     ([AUDIO.md](AUDIO.md) §4).
4. **Controls** (collapsed): tap, long-press and attack in three lines, plus the keyboard keys. The keys are
   hidden on touch-only devices.
5. **MAIN MENU**, below a dashed rule: an outlined button, with "Leaves this match. You'll be asked to
   confirm."

In short landscape the panel has two columns (resume, help and leave on the left; settings on the right), so
nothing needs scrolling.

### Reading the board

| What | How it shows (shape or text first, colour second) |
|---|---|
| Whose turn | The banner ("⚔️ Your turn" / "🤖 Enemy turn · Playing a land: …"), the header label, and a 4 px bar on the active side's inner edge. |
| AI activity | The banner says what the AI is doing. Cards it put down since its turn began get a **NEW** tag and a ring until its next turn. During its attack, its attackers have a solid outline, drop slightly and show ⚔️; your automatic blockers have a dotted outline and 🛡. Your side is only lightly dimmed (90 %, a little desaturated) so it stays readable. |
| Chosen attackers | Solid 3 px outline in the danger colour, lifted, ⚔️ bottom-left |
| Could attack | Dashed accent outline |
| Can't attack | A reason chip ("Tapped", "Defender", "Next turn"); it wraps on 52 px landscape cards instead of being cut |
| Predicted blockers | Dotted outline in the second accent, and 🛡 (🛡☠ if it dies) |
| Predicted outcome | ✓ or ☠ in a small chip low on the card, above power/toughness, so the art stays visible |
| Damage | 💔N, top-left, with a red rim |
| Tapped | Turned sideways, as before |
| Playable / unplayable in hand | Lifted with a ring / flat and dimmed with the reason, as before |
| Counters | Life is the largest number on each side. Deck (🎴) and the enemy's hand size (✋, new) are smaller and quieter. All have screen-reader labels ("Enemy life", "Enemy deck", "Enemy hand", "Your life", "Your deck"). |
| Messages | On the turn banner for their usual 2 s (combat reports 3.5 s), opaque, with a red edge for the enemy's. They never cover a card; in the menus they stay centred. |

### Evidence

**New suite.** `tests/battle.test.mjs` (`npm run battle`, in CI) has 14 tests:
- **Pause stops the match:** 30 s paused right after END TURN changes nothing; resume finishes the AI turn in
  the same match.
- **Remaining time:** a step 1 s from firing still waits about 1 s after RESUME.
- **No input while paused:** keys, clicks and direct calls do nothing.
- **Focus:** it returns to the card that had it.
- **Settings:** switches are saved apart from the profile and come back after a reload.
- **Theme from pause:** the picker opens on top, and Esc closes only it.
- **Leaving:** MAIN MENU → NO keeps the match paused; YES leaves with no timers left, and the next match plays.
- **Hidden page:** the match pauses itself.
- **Toasts:** with 21 cards on screen they sit on the turn banner and overlap none.
- **AI activity marks:** NEW, its attackers and your automatic blockers.
- **Outlines:** attacker, could-attack and predicted-blocker outlines are solid, dashed and dotted.
- **Counters:** labelled, with the enemy's hand size.
- **A 15-turn session with a pause each turn:** at most a few timers pending, no errors.

**Theme audit.** It now also checks the docked toasts (yours and the enemy's), the pause panel's rows and the
counters, in every theme and size.

**Results**, the same run as §12:

| Suite | Result |
|---|---|
| Battle | 14 / 14 |
| Theme audit (with the battle screens) | 1209 / 1209 |
| Smoke (pause → RESUME, pause → MAIN MENU → YES) | 204 / 204 |
| Release playthroughs (quits through the new pause panel 15 times) | 97 / 97 |
| UI audit (pause dialog focus trap and Esc) | 469 / 469 per theme |

**Two test races fixed** (the game was right both times):
- **"The AI's activity is marked":** the test read the board in the same instant the attack was recorded,
  before the scheduled redraw. It now waits one frame.
- **"Remaining time":** under heavy machine load the fake clock also moved with real time. The margins are now
  ±300 ms, which still tells "the time left" from "at once" and from "the full 1.5 s again".

Screenshots, before (`claude/visual-themes`) and after:

| File | Shows |
|---|---|
| [docs/ui-evidence/battle-desktop.jpg](docs/ui-evidence/battle-desktop.jpg) | Deep Space, 1366×900, crowded late game: attack preview, a toast, pause |
| [docs/ui-evidence/battle-phone.jpg](docs/ui-evidence/battle-phone.jpg) | Neon, 360×740: attack preview, a toast, the enemy turn, pause; after, also the enemy's attack with NEW marks |
| [docs/ui-evidence/battle-landscape.jpg](docs/ui-evidence/battle-landscape.jpg) | Arcane, 640×360: attack preview, a toast over the enemy board, pause |

**Real devices:** not tested here. Touch was emulated in Chromium at phone sizes; haptics need an Android
phone.
