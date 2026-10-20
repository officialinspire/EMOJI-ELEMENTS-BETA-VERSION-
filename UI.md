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
