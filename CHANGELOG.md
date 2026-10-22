# EMOJI ELEMENTS - Beta Version Changelog

## Unreleased: Achievements

For players:
- **150 achievements** across 13 categories. Some are milestones (first win, 50 wins, every card collected).
  Most are about how you play: a Clean Sweep of three blockers, winning By a Thread on 1 life, freezing a
  creature that was already tapped, or getting Phoenix and Phoenix Firebird out together. Four are hidden.
- **🏆 Achievements screen** from the main menu and the pause menu: category filters, an Unlocked filter,
  progress bars, unlock dates.
- **Unlock notices:** a small pill at the top of the screen, one at a time, "· N more" when several arrive
  together. They wait while you're paused or opening a pack, never cover your hand or turn buttons, and can
  play a short sound and buzz (switch on the Achievements screen).
- **Existing players** get credit for what their profile proves (wins, losses, packs, cards owned, credits) in
  one quiet notice. Past plays and combos are never guessed.

Under the hood:
- `achievements.js` (`window.Achievements`): the catalog, lifetime counters, the current match's context, and
  a versioned store under its own key (`emoji_elements_achievements_v1`). Unlocks are saved at once, counters
  in batches. Migration keeps unknown ids, drops bad fields, backs up a corrupt store, and never overwrites a
  newer version. Nothing is saved in QA mode.
- `index.js` reports confirmed outcomes (`reportAchievement`) from the places they happen: card resolution,
  combat, life changes (with their source), match end, packs, deck saves. A report can never throw into the game.
- `ACHIEVEMENTS.md` documents the events and storage, and lists all 150 triggers. The table is generated from
  the code (`npm run achievements:doc`).
- `npm run achievements` unlocks each of the 150 from real game events and tests unlock-once, reloads,
  migration, backfill, QA isolation, the screen, the notices and a long match. It is part of CI.

## Unreleased: Sound and haptics

For players:
- **New sound effects for everything you do.**
  - There are distinct sounds for menu clicks, picking up and playing cards (fantasy and sci-fi summons
    differ), land taps (a quick run steps up in pitch), spells, artifacts, attacks, blocks, damage, healing,
    deaths, the pack rip, card reveals (a rising arpeggio for rare, epic and legendary), victory, defeat and
    "not allowed".
  - All are short and quiet by design. Before, one sound served for selection, summons, spells and artifacts
    alike, clicks rang for 2 seconds, and the defeat sting ran almost 10 seconds at full scale.
  - Tonal sounds follow the visual theme.
- **One sound per hit.** Damage and healing used to replay a sound once per life point. A heal spell also
  played its sound twice.
- **Pack opening has sound.**
- **Settings:**
  - Sound (everything), Music and Effects, each with a volume slider, and Haptics.
  - In the pause menu and from the new **🔊 Sound** chip on the main menu.
  - Remembered on this device, never in your profile.
- **Haptics** (phones with vibration): short patterns when you play a card, attack, take damage, open a pack,
  reveal a rare card, win or lose. Never for the AI's own actions, never before your first touch, single short
  pulses with reduce motion, and nothing at all where vibration isn't available.
- **Faster start on phones:** 2 audio files load before the first tap instead of 19.

Under the hood:
- **`feedback.js` (`window.GameFeedback`):** a Web Audio effects engine with per-cue cooldowns, a cap on
  overlapping voices, pitch variation and a compressor. It also holds the sound settings and the one guarded
  `haptic(kind)` helper.
- **Unlock:** audio starts only after a gesture, and is resumed quietly after interruptions.
- **Music and the intro are unchanged.** The 17 effect MP3s are removed.
- **Achievements:** the game has none, so the achievement cue exists but nothing triggers it yet.
- **New suite:** `tests/audio.test.mjs` (`npm run audio`, 15 tests, in CI).
- **Sound board:** `docs/sound-board.html`, for listening on a device.
- **[AUDIO.md](AUDIO.md):** the audit, measurements, settings, haptic patterns, and what was checked
  automatically versus on a real device. Nothing has been heard on a real device yet.

## Unreleased: Battle screen and pause

For players:
- **Pause really pauses.** Before, the pause menu only covered the screen. Behind it, the AI went on playing its
  whole turn, your next turn began, and a message popped up over the menu.
  - Now the AI's turn, its 12 s failsafe, the action locks and the messages all wait.
  - The board takes no clicks, taps or keys while paused.
  - RESUME carries on the same match with the time each step had left, and puts focus back where it was.
  - The match also pauses itself when you switch tab or app.
- **A new pause menu.**
  - RESUME first, then switches for Sound, Music and Haptics, and the theme.
  - A short Controls list (the keyboard keys are hidden on touch-only devices).
  - MAIN MENU last, set apart, with the same confirmation as before. NO returns to the paused match.
  - The subtitle shows the turn and both life totals.
- **Messages never cover cards.** During a match they appear on the turn banner instead of over the middle of
  the board.
- **Easier to read at a glance.**
  - Attackers (solid outline, ⚔️), creatures that could attack (dashed) and predicted blockers (dotted, 🛡)
    now differ in shape, not only colour. Before, attackers and blockers were both red.
  - The predicted ✓/☠ sits low on the card instead of over its art.
  - Cards the AI put down since its turn began say **NEW**. During its attack, its attackers show ⚔️ and your
    automatic blockers 🛡.
  - A bar on the inner edge marks the side whose turn it is. Your side is only lightly dimmed during the
    enemy's turn (it was 60 % opacity at 70 % brightness), so you can still read your cards.
  - Life is the largest number on each side. Deck size is smaller and quieter, the enemy's hand size is new,
    and all of them have labels for screen readers.
  - Damage chips have a red rim, and in short landscape a reason like "Next turn" wraps instead of being cut.
- **Theme picker on short landscape screens:** compact options, and the current theme is scrolled into view.
- **Haptics** (phones that support vibration): a short buzz on long-press and when you take damage. It can be
  switched off.

Under the hood:
- **Pausable timers:** `matchDelay` / `clearMatchDelay` / `freezeMatchTimers` / `thawMatchTimers` in
  `index.js`. The AI turn, the action-lock failsafes and the toasts use them.
- **Leaving a match** clears its paused state, timers and pending toasts. Before, a combat report's hold kept
  menu messages queued.
- **Settings keys:** `emojiElementsMusicOff`, `emojiElementsHaptics` (beside `emojiElementsMuted`). None of
  them touch the profile.
- **New suite:** `tests/battle.test.mjs` (`npm run battle`, 14 tests, in CI). The theme audit also checks the
  docked toast, the pause panel and the counters.

## Unreleased: Visual themes and logo

For players:
- **Three themes.** Pick one from **Theme: …** on the main menu or 🎨 THEME in the pause menu.
  - **Arcane Fantasy** (default): violet ink, gold leaf, Uncial and Cinzel lettering.
  - **Deep Space**: midnight navy, a sparse still starfield, ice-blue accents, Exo 2 lettering.
  - **Neon Sci-Fi**: black glass, a faint grid with a magenta horizon, cyan accents, Orbitron and Chakra Petch.
  - Themes change colours, type and backgrounds only. Card rarity colours and the body text are the same in
    all three. The choice is saved on its own: it never touches your profile, and RESET PROGRESS keeps it.
- **A new logo.** A sigil of the five elements and an "EMOJI / Elements" wordmark, as live text and a local SVG.
  It is large on the start screen, beside the title in the menu and one compact line in the match header.
- **Start screen:** one clear "▶ Click to start" button with the hint "Sound on · tap or click anywhere". It no
  longer pulses.
- **Main menu:** the theme chip sits beside V2 BETA. After your first battle, NEW GAME names the deck it will
  start from ("Last deck: 🔥 Fire + 💧 Water"). The menu sits on the theme's own background.
- **Calmer matches.** Nothing loops or pulses during a match any more: not the phase label, not ATTACK, not the
  enemy turn, not the result banner. MULLIGAN and GRAVEYARD are quiet buttons, END TURN is the accent, ATTACK a
  steady red. The victory and defeat banners are a dark scrim with a glow instead of a full-screen wash.
- **Readability fixes:**
  - MAIN MENU on the victory and defeat banners was white on light blue (3.3:1). It now passes AA in every theme.
  - MULLIGAN no longer puts light text on bright blue.

Under the hood:
- **Semantic tokens:** each theme is one token set on `<html data-theme>`. 322 colour and font literals in older
  rules now read tokens. Before any visual change, a computed-style fingerprint of 24 screen states was
  identical.
- **Picker:** `VISUAL_THEMES`, `applyVisualTheme`, `showThemePicker` in `index.js`. It is a radio group in the
  shared dialog handling (Esc, focus trap, focus return); the theme is applied before the first paint from
  `localStorage.emoji_elements_theme`.
- **New suite:** `tests/theme-audit.mjs` (`npm run themes`). It runs axe and measured text contrast, overflow,
  clipping and looping-animation checks for each theme at three sizes, plus the storage and keyboard checks.
  `menu-audit`, `ui-audit` and `card-faces` take `--theme=`.

## Unreleased: Cleanup and final regression

For players:
- In the Deck Builder, + and − keep keyboard focus on the card you pressed. Before, focus jumped to the top
  of the page.
- Menus no longer redraw an invisible effects layer 60 times a second (less battery use).
- Leaving a match lets go of its cards straight away.
- "What's inside" shows power/toughness as the same chip as the Collection.

Under the hood:
- **CSS:** removed CSS nothing uses or that later passes had overridden (`styles.css` −178 lines). A
  computed-style fingerprint of 24 screen states is unchanged.
- **List-row styles:** one shared set for the Collection, Deck Builder and Pack Shop.
- **New suites:**
  - `tests/regression.test.mjs` (11 tests, in CI);
  - `tests/cross-browser.mjs`, which reports engines that aren't installed as NOT TESTED.
- **QA_REPORT:** brought up to date. `main` now holds everything: the release pass came in through PR #117,
  the five newer passes and this one through PR #118.
- **CI:**
  - the shared `act()` test helper waits out short action locks on slow runners (this fixed an intermittent
    combat-test failure);
  - the workflows use the Node 24 majors of checkout, setup-node and upload-artifact.

## Unreleased: Pack Shop and pack opening

For players:
- **Packs contain what their names say.**
  - Alien packs hold aliens, UFOs and space cards; Robot packs hold robots, drones, mechs and machine minds.
    Before, both were 100% unrelated Nature and City cards.
  - Lands packs hold only lands; Badlands Boar is gone.
  - Every card is in at least one pack. Some are in several (Satellite Drone is in four).
- **The odds changed on purpose.** CARD_AUDIT.md §7 has the full before/after table.
  - Fantasy now also holds the elemental wildlife, so each Fantasy card is about half as likely per pack.
  - The small Alien, Robot and Tech pools make their rarer cards come round much more often.
  - The Robot pack has only one Epic (Battle Mech), so its fifth card is Epic or Rare. Battle Mech is in a third
    of Robot packs instead of every one.
- **A clearer shop.**
  - Each pack has its own art, a price chip, its slots and how many of its cards you own.
  - Short of credits, the button says "NEED 20 MORE"; pressing it explains and charges nothing.
  - **What's inside** lists every card a pack can contain, with what you own and the exact chance of each card.
- **Better reveals.**
  - **OPEN PACK** opens a pack without the rip gesture.
  - Each card shows its keywords, rules or mana, and **✨ NEW** (only if you had none before this pack) or "You
    own 3 (had 2)".
  - **ALL 5 CARDS** gives a summary of the pack, and **DONE** closes it.
  - Win packs show their theme ("🎁 Victory Pack · Robot").

Unchanged: prices (60, Lands 40), 5 different cards per pack, a pack and +25 credits on every win, win-pack
theme weights, every card's rarity, and the save format.

Under the hood:
- `PACK_MEMBERSHIP` (reviewed per card id) replaces `inferTheme` and its keyword lists.
- `getPackSlotPlan`, `generatePack` and `getPackOdds` share one slot plan, with the documented fallbacks: a tiny
  tier is merged with the next one, and a small pool is completed from the catalog.
- `addPackToCollection` keeps the before-pack counts in memory for NEW.
- `purchasePack` refuses while a pack is open.
- The card audit checks membership and reachability and simulates seeded packs. The manifest is now
  `schemaVersion` 2: `packTheme` is replaced by the explicit `availability.packThemes`.
- New `tests/packs.test.mjs` (16 tests, in CI) and `tests/pack-shots.mjs` (screenshots and axe). See UI.md §11.

## Unreleased: Gameplay feedback

For players:
- **Always know whose turn it is.** A banner above the battlefield shows the turn number, whose turn it is and
  the phase. On the enemy turn it says what the AI is doing: drawing, playing a land, tapping mana, playing a
  card, attacking with N or not attacking. It never shows the AI's hand.
- **Clear attack buttons.** ATTACK becomes **✓ CONFIRM n** (how many you picked) and END TURN becomes
  **✕ CANCEL**, which leaves without attacking. You can still attack later this turn.
- **Reasons, not guesses.**
  - While you choose attackers, creatures that can't attack say why: Tapped, Defender, or Next turn.
  - Hand cards you can't play say why: "Land used", or how much mana they still need ("🔒🔥2"). The full sentence
    is in the tooltip and card details.
- **Attack preview.** While you choose attackers, a Preview shows the automatic blocks and the expected result:
  life totals, who dies (✓ / ☠ on the cards) and whether it wins the match. It uses the same combat rules as the
  real attack and changes nothing. It updates whenever the board changes.
- **Match history (📜, or `H`).** The last 80 events of the match, grouped by turn: plays and what they did,
  attacks, blocks, damage, deaths and life changes. It stays after the messages fade.
- Turn-change motion is one short pulse, and none with reduced motion turned on.

Unchanged: combat rules, automatic blocking, random targeting, mana, rewards and saves.

Under the hood:
- `previewCombat` runs the live `assignAutoBlockers`, `applyDamage` and `dealUnblockedDamage` on copies, with
  its own life ledger.
- `recordHistory` is called once from the engine, separate from rendering.
- `getPlayRestriction` makes the same checks as `playCard`; `getAttackRestriction` (already there) gives the
  attack reasons.
- New `tests/feedback.test.mjs` (55 tests, in CI): preview = result for first strike, double strike, trample,
  deathtouch, menace and lifelink with both sides attacking.
- `tests/feedback-shots.mjs` takes the screenshots and runs axe. See UI.md §10.

## Unreleased: Collection and Deck Builder

For players:
- **The Collection shows every card.**
  - All 268 cards are listed. The ones you don't own yet are marked "Not owned".
  - Switch to "Owned" to see just your collection.
  - The summary reads "153 of 268 unique cards • 300 total cards".
- **Search, filter and sort**, in the Collection and in the Deck Builder:
  - search by name, card text or keyword;
  - filter by element (including "two or more colours" and colorless), card type, mana value, rarity and
    ownership;
  - sort by name, mana value, rarity, type or copies owned.
  - On phones, the filters fold away under "Filters & sort".
- **Readable Deck Builder rows.**
  - Each card shows its art tile, cost, type, power/toughness, keywords and rarity, plus how many are in the deck
    and how many you own.
  - The ⓘ button opens the card's full rules.
  - The deck list is grouped into creatures, spells, artifacts and lands.
- **Add buttons explain themselves.** A greyed + says why: not owned yet, all your copies are already in, copy
  limit (2, or 1 for legendaries), or the deck is full.
- **Deck summary:** cards out of 60, lands (with the cap), creatures, spells, artifacts, and a mana-curve chart of
  the deck you're editing.
- **Problems come with fixes.** If something would stop the deck saving, it's listed in plain words with a button
  that fixes it where it can ("Too many lands: 21 (at most 20). Remove 1 land").
- **No lost edits.**
  - Changing filters never touches your deck.
  - "● Unsaved changes" shows while you edit.
  - Leaving, pressing Esc or switching decks with unsaved changes asks first.
- **The deck picker** shows names ("🔥 Fire + 💧 Water") instead of keys.

Unchanged: deck rules (`validateDeckBuild`), copy limits, land caps, collection counts, all 15 decks, card ids
and the save format.

Under the hood:
- Shared helpers in `index.js`: `cardMatchesFilters`, `sortCardsForList`, `buildCardFilterBar`,
  `renderCardRowMeta`, `getAddBlockReason`, `getDeckIssues`, `isDeckBuilderDirty` and
  `confirmDiscardDeckEdits`.
- A "COLLECTION AND DECK BUILDER" block in `styles.css`.
- New `tests/collection.test.mjs` (`npm run collection`, in CI) and `tests/collection-shots.mjs`.
- The progression test's Binder check now uses the "Owned" view and the new summary format. See [UI.md](UI.md) §9.

## Unreleased: card presentation

For players:
- **Cards look like their element.**
  - Every card frames its emoji in its element's colour.
  - Two-colour cards are split between both colours, and Rainbow shows all five.
  - Colorless artifacts and Crystal Wasteland are steel grey.
- **Clear costs.**
  - One pip per colour with its number. Colorless costs read ◇N, and free artifacts read 0.
  - Instants, artifacts and lands carry a type icon (✨ ⚙️ ⛰️).
  - Power/toughness sits on a dark chip that's easy to read.
- **Calmer rarity.** Common, rare, epic and legendary borders are bronze, blue, purple and gold. Nothing pulses or
  spins any more.
- **States you can see without relying on colour:**
  - Tapped cards turn sideways.
  - Summoning-sick creatures (now enemy ones too) have a dashed border and 💤.
  - Damage reads 💔N.
  - Attackers lift with an outline and ⚔️.
  - Cards you can play lift in your hand; the rest sit flat and dimmed.
- **Richer card details.**
  - Type, rarity and element tags.
  - Cost as pips and words.
  - Current power/toughness (with the printed values if changed).
  - What the card is doing on the battlefield (tapped, damage, summoning sick, attacking).
  - Each keyword with its icon and exact rule.
  - Flash is clearly marked "No effect": it is greyed out on cards and labelled in details.
- **Pack reveals** show rarity, cost and power/toughness in the card's colours.
- **Fixed:** on phones, long-pressing a card sometimes opened its details and closed them again at once.

Under the hood:
- Shared helpers in `index.js`: `getCardRarity`, `getCardIdentity`, `applyCardIdentity`, `renderCostPips`,
  `describeCost`, `createKeywordBadge` and `renderKeywordDetail`.
- A "CARD FACES" block in `styles.css`.
- Card data, ids, rarity, rules, saves and `bindCardPress` are unchanged.
- New `tests/card-faces.mjs` (`npm run cards:ui`, in CI). See [UI.md](UI.md) §8.

## Unreleased: menu and battle setup refresh

For players:
- **A clearer main menu.**
  - NEW GAME is the one large gold button.
  - Deck Builder, Collection, Pack Shop, How to Play and Stats each have a readable label and a short line saying
    what they do.
  - The menu shows your credits, how many of the 268 cards you have collected, and your win/loss record.
- **Battle setup in four steps:** deck type, elements, AI difficulty, and your deck.
  - Element buttons show their names (Fire, Water, Earth, Swamp, Light) in their own colours. A ✓ marks each
    pick, and a hint says how many are left.
  - Each difficulty explains what the AI does (it matches the AI's actual settings).
  - Before you start, a summary shows the saved deck you're about to play: card counts by type, average cost,
    its rarest cards, and whether it is still the starter list.
  - NEW GAME starts with the deck you last played already picked, also after a reload. In a single-colour deck,
    tapping another element switches to it.
- **Fits every screen:** two columns on wide screens, one column on narrow phones, and a compact layout for
  phones on their side, where NEW GAME and START BATTLE fit without scrolling.
- **Keyboard:**
  - Esc returns to the menu from every menu screen.
  - Focus goes back to the button that opened the screen, and each screen's heading is focused when it opens.

Under the hood:
- `index.html`, `styles.css` (a scoped "MENU REFRESH" block) and `index.js` (`updateMenuStatus`,
  `syncElementSelectionUI`, `renderDeckSummary`, `restoreSavedDeckSelection`, `syncDifficultyUI`).
- Two small local SVGs for decoration: `menu-sigil.svg` and `menu-divider.svg`.
- Every existing id, `data-*` attribute, route and handler is kept. The rules and the match screen are unchanged.
- New `tests/menu-audit.mjs` (`npm run menu`, also run in CI). Smoke and release tests now use the new labels
  (Collection, Stats). See [UI.md](UI.md) §7.

## Unreleased: release candidate (player summary)

What's new for players since the last public build:
- **Wins work again:** the OPEN BOOSTER button after a win can be clicked and tapped (wins used to get stuck
  there). Every win gives +25 credits and a booster pack; a loss gives +10.
- **Your progress is safe:** older or damaged saves are repaired instead of wiped, and a backup is kept. RESET
  PROGRESS also keeps a backup.
- **Fairer, clearer rules:**
  - Mana can't be reused by untapping lands.
  - Attackers stay tapped through the enemy turn.
  - Drawing from an empty deck loses.
  - Double Strike, Unblockable and granted Haste now work.
  - Every spell and artifact does what its card says, and card details show a Rules line.
- **A smarter, honest AI:** Easy, Medium and Hard now feel different. All three follow your rules and deck
  limits, and the AI's turns are quicker.
- **Phone, tablet and desktop:**
  - Landscape phones are playable.
  - A long-press shows a card without playing it.
  - After combat you see who blocked whom.
  - Bigger touch targets.
  - Full keyboard play.
  - Reduced-motion support.
- **Deck Builder** saves real decks, and all 15 starter decks are legal.

Release QA fixes (this pass, `QA_REPORT.md`):
- QA mode is off for players: no `[QA]` console output and no `window.__qa*` helpers unless the URL has `?qa=1`.
- An AI turn that ended the match no longer leaves its 12 s failsafe timer running.
- Skipping the intro no longer restarts the video silently in the background.
- Added a favicon link, so browsers stop requesting a missing `/favicon.ico`.
- README, QUICK-START and QA_REPORT now describe the shipped game. For example, QUICK-START used to say "no intro
  video", "no audio files needed" and "150+ cards".

## Unreleased: AI audit

The AI is checked by `tests/ai.test.mjs` and measured by `tests/ai-sim.mjs` (360 seeded matches: every starter
deck × every difficulty against a fixed reference bot). See `AI.md`.
- **Rule parity:** no illegal land, mana, timing, tapping, attack or block was found before or after, and no
  crash, stall or loop. One gap is fixed: **AI decks now follow the deck-building copy limits** (2 copies, 1
  legendary). Before, 315 of 360 sampled AI decks broke them.
- **Difficulty ladder** (`AI_PROFILES`), all on the same rules:
  - **Easy:** 1 card a turn, no instants, random attacks.
  - **Medium:** 2 cards a turn, instants, sees lethal, careful attacks.
  - **Hard:** as many cards as its mana allows, and also keeps blockers home when your board could kill it.
  - Against the reference bot this is now 50% / 62% / 70%. It was 46% / 45% / 58%, with easy and medium
    indistinguishable.
- **Better decisions:**
  - Lands are chosen for the colours the hand needs, and multi-colour lands are tapped for the colour that
    casts a card.
  - No wasted cards: buffs with no creature, removal with no target, draws that would empty its deck.
  - Medium and hard:
    - cast lethal burn;
    - go all-in when the attack is lethal, ordering attackers to beat the automatic blocks;
    - stop throwing creatures into losing blocks.
  - Medium and hard missed lethal attacks went from 29 to 0, and lethal burn left in hand from 19 to 0.
- **Pacing:** steps where the AI does nothing no longer wait 1.5 s each. The average AI turn is 5.4 s (was
  7.05 s); an idle one takes ~3.9 s (was 8.5 s).

## Unreleased: phone, tablet and desktop interaction

Checked by `tests/ui-audit.mjs` on Android portrait, phone landscape, tablet and desktop sizes, with
before/after screenshots in `docs/ui-evidence/` (see `UI.md`). Game rules are unchanged.
- **Phone landscape is playable.** Your battlefield and life total used to be hidden under the hand. The
  controls now sit in a side column, and card details and the pack screen fit the short screen.
- **Long-press inspects without playing.** A long-press used to also play the card, or select it as an
  attacker. Every card now has one press handler for tap, long-press, right-click and keyboard, so a touch
  never acts twice.
- **Blocks are shown.** After combat a message lists who blocked whom and what died. 💔 shows damage taken
  this turn, and a dashed border marks a creature that can't attack yet.
- **Tapping a card that has no action shows its details**, including enemy cards. The details used to be
  hover-only on desktop.
- **Phone layout:**
  - The header phase label no longer clips.
  - END TURN sits with MULLIGAN and GRAVEYARD, with ATTACK full width below (END TURN used to sit alone on a
    third row).
  - Tablets get bigger cards.
  - Tapped cards no longer cover their neighbours.
  - Menu and start titles no longer clip.
- **Touch targets:** close buttons, tabs, the pause and mute buttons, difficulty buttons and the deck picker
  are now at least 44 px.
- **Text size:** keyword badges went from 9 px to 11 px.
- **Keyboard:**
  - Esc closes the top window (card details, graveyard, confirmations, pack) or resumes from pause.
  - Focus moves into dialogs, stays there, and comes back when they close.
  - Cards are reachable with Tab: Enter plays or uses a card, and I shows its details.
  - Space on a button you reached with Tab presses that button. After a mouse click, Space still ends the
    turn.
  - Ctrl+A no longer starts an attack.
  - Esc no longer strands the victory screen.
- **Accessibility:**
  - Dialogs are announced as dialogs.
  - Icon buttons have names.
  - Selected and mute states are announced.
  - The game log is read out.
  - Pinch-zoom is allowed (double-tap zoom is still off).
  - axe-core finds no violations on any screen (it found 116 before).
- **Reduced motion:** the intro animation, screen shake, particles, sparkles and looping glows (the legendary
  halo kept spinning) are now off.
- **Autoplay:** if the intro video can't play, the menu now appears after 3 s instead of 15 s. Nothing plays
  before the first tap.

## Unreleased: spell and artifact effects

Every instant and artifact effect is written down in `EFFECTS.md` and covered by `tests/effects.test.mjs`:
each of the 70 cards is cast by the player and by the AI and its exact result checked.
- Earthquake and Avalanche hit every creature, yours too, as their text says (they used to hit only enemy
  creatures). The AI holds them when they would kill more of its own creatures than yours.
- Anger's +3/+0 now ends at end of turn (it used to be permanent).
- Deep Freeze now stops the creature untapping on its controller's next turn, and can freeze an already
  tapped creature (it used to be a plain Freeze).
- Thought Steal always draws, even if the opponent has no cards to discard.
- A lethal Drain Life still gives you the 2 life.
- A creature that dies, is destroyed or is bounced goes back to its printed card: buffs and granted keywords
  no longer come back with it.
- The AI now taps its mana artifacts.
- The AI stops playing cards once the match is over.
- Card details show a **Rules** line for every instant and artifact, saying exactly what it does (targets,
  timing, whether an artifact is used up). How To Play explains random targets and the kinds of artifact.
- Card text corrected to match the engine: Fireball, Explosion, Inferno, Comet Strike ("to the enemy"),
  Wrestle, Magic Wand ("each turn"), Bomb, War Horn, Protective Amulet, Footsteps ("your creatures") and Dark
  Scroll. Rarity, pack themes and deck legality are unchanged.

## Unreleased: progression and saved data

Progression rules are written down in `PROGRESSION.md` and covered by `tests/progression.test.mjs`, which
loads real saves from the previous build.
- **No more lost progress.** A save with a missing or different `version`, or one that was only partly
  readable, used to be replaced by a brand-new profile, losing the collection and credits. It is now
  repaired: everything valid is kept. Corrupt saves, repairs and RESET PROGRESS first copy the old save
  into `emoji_elements_meta_backups` (last 3 kept).
- Starter decks are built only from cards you own, so all 15 are legal. FIRE_SWAMP used to include Web
  Trap, which nobody owns, and shrank to 59 cards after a reload; untouched saved FIRE_SWAMP decks are
  updated, edited decks are left alone.
- Saves from before dual decks existed now get the ten dual decks, built from cards you own. No cards are
  granted.
- Stats from the old single-file build are carried over when a profile is first created.
- The OPEN BOOSTER button after a win can be clicked and tapped again (every win used to get stuck there).
- Shop packs count toward "packs opened" and are titled "<Theme> Pack" instead of "Victory Pack".
- The defeat screen shows the +10 credits earned.
- RESET PROGRESS also clears the win/loss stats; the old numbers used to come back after the next match.
- One swipe in the pack reveal shows one card (it used to skip cards).
- QA debug text no longer shows in the pack overlay or Deck Builder.
- A warning appears when progress can't be saved (storage full or blocked).
- Deck size stays 60 even if a save lost its starter list (it used to drop to 30).

## Unreleased: combat rules

Combat house rules are written down in `RULES.md` §8 and covered by `tests/combat.test.mjs`. Every
scenario runs with both the player and the AI attacking.
- Double Strike now hits twice when unblocked too, and its lifelink counts both hits.
- Unblockable (Otter Scout, Surf) now works.
- Haste granted after a creature arrives (Footsteps, Gravity Boots) now lets it attack that turn.
- Keywords granted by spells and equipment (Feather, Surf, Halo, …) stay on that one creature. They used to
  spread to every copy of the card on both sides for the rest of the session.
- Revive spells return the most recent creature, never an instant or artifact.
- Every keyword is explained, from one shared rules table: card details, distinct board badges with
  tooltips, and the How To Play list. Badges used to be first letters, so F could mean Flying, First Strike
  or Flash.
- Clicking a creature that can't attack now says why (tapped, summoning sickness, Defender).
- Flash is labelled as having no effect yet.

## Unreleased: turn and resource rules

Rules are now written down in `RULES.md` and covered by `tests/rules.test.mjs`.
- Mulligan: once, only before your first action (no land played or tapped, no card cast).
- A tapped land can be untapped only while its mana is unspent, so one land can no longer give unlimited mana.
- Permanents untap at the start of their controller's turn: your attackers stay tapped (and can't block)
  through the AI's turn, just like the AI's attackers on yours. Vigilance now matters.
- Drawing from an empty deck loses the match.
- No game actions after a match ends (artifact mana and mulligan were still possible).
- Leaving a match mid-AI-turn no longer lets that AI turn act on your next match.
- The AI no longer gets "colorless" decks full of blank cards.
- Dual-land colour choices made after the turn ends are ignored; quickly tapping a second dual land no
  longer hides its colour dialog.

## Version 2.0 - Major Update

### Features Added

#### 1. Intro Video System
- Added `inspiresoftwareintro.mp4` as opening credit sequence
- Video plays automatically on page load
- Click/tap to skip functionality
- Smooth fade transition to main menu

#### 2. Audio System
- **Start Menu Music**: `startmenu.mp3` loops in background
- **Gameplay Music**: `gameplaybackgroundmusic.mp3` (ready to integrate)
- **Sound Effects System** created for:
  - Land tapping: `tapland.mp3`
  - Land untapping: `untap.mp3`
  - Fantasy creature summon: `summoncreaturefantasy.mp3`
  - Sci-fi creature summon: `scifisummon.mp3`
  - Instant/artifact summon: `summoninstant.mp3`
  - Card destroyed: `carddestroyed.mp3`
  - Attack action: `attack.mp3`
  - Block action: `block.mp3`
  - Player heal: `playerheal.mp3`
  - Player damage: `playertakedamage.mp3`
  - Opponent heal: `opponentheals.mp3`
  - Opponent damage: `opponenttakedamage.mp3`
  - Menu open: `menuopen.mp3`
  - Menu close: `menuclose.mp3`
  - Select option: `select.mp3`
  - Victory: `gamevictorysfx.mp3`
  - Defeat: `gamelosesfx.mp3`

#### 3. UI Enhancements
- Start menu fade-in animation (1.5s dramatic effect)
- Victory/Lose overlay screens with animations
- Life counter animation effects (increase/decrease)
- Mobile-optimized touch controls

#### 4. Card Database - MASSIVELY EXPANDED

**Card Type System**:
- All cards now have `cardType` field: "Creature", "Instant/Spell", "Land", "Artifact"
- All cards now have `theme` field: "Science Fiction", "Fantasy", "Nature", "City"

**Expanded MTG Keyword Abilities**:
- **Flying**: Can only be blocked by flying/reach creatures
- **Trample**: Excess damage goes through to player
- **Lifelink**: Damage dealt heals you
- **Haste**: Can attack immediately (no summoning sickness)
- **Vigilance**: Doesn't tap when attacking
- **Defender**: Cannot attack
- **Reach**: Can block flying creatures
- **Deathtouch**: Any damage destroys the creature
- **First Strike**: Deals combat damage first
- **Double Strike**: Deals damage twice in combat
- **Hexproof**: Cannot be targeted by opponent spells
- **Menace**: Must be blocked by 2+ creatures
- **Flash**: Can be played at instant speed

**Creatures** (85+ total):
- **Fire** (17): Dragon, Phoenix, Demon, Tiger, Fox, Lion, Salamander, etc.
- **Water** (17): Whale, Shark, Octopus, Dolphin, Crocodile, Turtle, etc.
- **Earth** (17): Elephant, Gorilla, Bear, Wolf, Rhino, Panda, etc.
- **Swamp/Death** (17): Vampire, Zombie, Ghost, Werewolf, Spider, Skeleton, etc.
- **Light** (17): Unicorn, Angel, Pegasus, Eagle, Fairy, etc.
- **Sci-Fi** (30+): Robot, Alien, UFO, Mech, Cyborg, Drone, etc.

**Spells** (25+):
- Fire: Fireball, Explosion, Inferno, Meteor Strike
- Water: Freeze, Tsunami, Bubble Shield, Healing Rain
- Earth: Earthquake, Growth, Avalanche, Harvest
- Swamp: Curse, Drain Life, Poison, Necromancy
- Light: Heal, Divine Smite, Blessing, Resurrection

**Artifacts** (15+):
- Weapons: Flaming Sword, Battle Axe, Elven Bow
- Armor: Earth Shield, Heavy Armor
- Magical Items: Crown of Power, Mana Gem, Magic Ring
- Special: Holy Chalice, Cursed Orb, Protective Amulet

#### 5. Balanced Gameplay
- Adjusted mana costs across all cards
- Rebalanced power/toughness values
- Enhanced spell effects
- Strategic ability combinations

#### 6. Game Stats Tracking
- Wins/Losses/Total games tracked
- Win rate calculation
- Victory/Lose effects with stat updates
- Local storage persistence

#### 7. Mobile Compatibility
- Responsive design for all screen sizes
- Touch-optimized controls
- Long-press for card details
- Viewport meta tags for proper scaling

### Technical Improvements
- Modular audio system with helper functions
- Efficient card database structure
- Theme-based card classification
- Enhanced particle effects
- Smooth animations and transitions

### Files Modified
1. `index.html` - Added intro video, victory/lose overlays
2. `index.js` - Audio system, expanded card database, enhanced game logic
3. `styles.css` - New animations, mobile optimizations, victory/lose effects

### Next Steps (Future Updates)
- Full sound effect integration throughout gameplay
- Extended combat mechanics for new abilities
- Additional card effects and interactions
- Tournament mode
- Deck building system
- Multiplayer support

---

## Compatibility
- ✅ Desktop Browsers (Chrome, Firefox, Safari, Edge)
- ✅ Android (Chrome)
- ✅ iOS (Safari)
- ✅ Touch and Mouse Controls
- ✅ Landscape and Portrait Modes

## Credits
- Game Design: EMOJI ELEMENTS Team
- Intro Video: Inspire Software
- Sound Effects: Professional SFX Library
- Music: Custom Compositions
