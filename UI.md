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
