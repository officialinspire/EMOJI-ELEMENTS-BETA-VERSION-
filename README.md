# ⚔️ EMOJI ELEMENTS v2 (Beta)

EMOJI ELEMENTS v2 is a fast, browser-based elemental card battler with a real progression loop: build decks from cards you own, earn credits from every match, crack themed booster packs, and tune mono/dual-color lists for your next run. It’s pure HTML/CSS/JS, runs on desktop and mobile, and saves your meta progress locally.

## Features

- 1v1 turn-based card battles with lands, creatures, instants, and artifacts.
- Match economy: credits on **win and loss**, plus a **free booster pack on every win**.
- Deck Builder backed by owned cards (collection-driven), with copy-limit + deck-size validation.
- Standardized starter deck keys for mono and dual identities.
- Pack Shop with six themed packs (Fantasy, Science Fiction, Tech, Alien, Robot, Lands). Each shows its art,
  price, whether you can afford it, and "What's inside": every card it can contain and the odds.
- Pack opening: drag to rip, or press OPEN PACK. Swipe or use PREV/NEXT to reveal cards with their full rules,
  NEW or how many you own. A summary shows all five.
- Emoji card art in element-coloured frames (split for two-colour cards, steel for colorless), with cost pips,
  rarity borders, and markers for tapped, summoning-sick, damaged and attacking creatures.
- Three visual themes: **Arcane Fantasy** (violet and gold), **Deep Space** (navy, starlight, ice blue) and
  **Neon Sci-Fi** (black glass, cyan, magenta). Pick one from the Theme chip on the main menu or 🎨 THEME in
  the pause menu. Themes change colours, type and backgrounds only, never cards, decks or progress.
- Desktop shortcuts + mobile touch support.
- localStorage persistence for stats, collection, decks, wallet, and last pack, with automatic repair and backups of damaged saves.

## Gameplay Overview

- Start at **20 life** vs AI at 20, with 7-card opening hands. You go first and skip your first draw.
- One mulligan (to 6 cards), only before you play or tap anything.
- Each turn: draw, untap, then play cards you can pay for. **One land per turn**; unused mana is lost at end of turn.
- Use **Attack** to select attackers and confirm, once per turn. New creatures need a turn before attacking unless they have haste.
- Attackers stay tapped until your next turn (so they can't block) unless they have vigilance. Blocking is automatic for both sides.
- Match ends when a player reaches 0 life **or must draw from an empty deck**; if both happen in the same check, it counts as a loss.
- Full, test-backed turn and mana rules: [RULES.md](RULES.md) (`npm run rules`).
- Every spell and artifact effect, with timing and target rules: [EFFECTS.md](EFFECTS.md) (`npm run effects`).
  Where a card says "target", the game picks a random legal creature (damage goes to your opponent); card
  details show each card's exact **Rules** line.
- AI difficulty levels (Easy, Medium, Hard). All three play by the same rules and deck limits as you; they differ
  in how many cards they play a turn, whether they cast instants and see lethal, and how carefully they attack:
  [AI.md](AI.md) (`npm run ai`, `npm run ai:sim`).

## Progression & Collection

Full, test-backed rules: [PROGRESSION.md](PROGRESSION.md) (`npm run progression`).

- A new profile starts with **100 credits** and the **starter collection**: the cards of the five mono starter
  decks (153 different cards, 300 copies).
- Opening a pack adds its cards to your collection; duplicates stack (`x3` in the Binder).
- **Collection** (main menu) lists all 268 cards. Owned ones show their count; the rest are marked "Not owned".
  - Search, and filters for element, type, mana value, rarity and ownership; sort by name, cost, rarity, type
    or copies owned.
  - The main menu shows your credits and how many of the 268 cards you have collected.
- Rarity is inferred from each card: `common`, `rare`, `epic`, `legendary`. No card is currently `uncommon`.

## Achievements

150 achievements in 13 categories: first steps, wins and losses, difficulty, the 15 decks, elements, card types,
mana and lands, combat keywords, spells and artifacts, collection and packs, rare feats, card combinations and a
few jokes (four are hidden until earned). Full catalog with every trigger: [ACHIEVEMENTS.md](ACHIEVEMENTS.md).

- **🏆 Achievements** on the main menu, or the Achievements row in the pause menu: filter by category or
  unlocked, see progress bars for counted ones.
- A small notice at the top of the screen announces each unlock (one at a time, never over your cards or turn
  buttons), with a short sound and buzz you can switch off on the Achievements screen.
- Each unlocks once. Progress you already had (wins, packs, cards owned, credits) is recognised on first load;
  nothing about past matches is guessed.

## Decks & Deck Builder

There are 15 standard decks, each starting as a 60-card starter list:

| | Keys | Basic lands | Non-lands |
|---|---|---|---|
| Mono | `FIRE`, `WATER`, `EARTH`, `SWAMP`, `LIGHT` | 20 | 40 |
| Dual | all ten pairs, `FIRE_WATER` … `SWAMP_LIGHT` | 11 + 11 | 38 |

- Starter lists only use cards the starter collection owns, so every starter deck is legal on a new profile.
- Starting a match with the chosen colour(s) plays that saved deck exactly, and it becomes the selected deck.
  The Deck Builder opens on the selected deck, and NEW GAME starts with it already picked.
- Battle setup shows a summary of the saved deck for the chosen colour(s) before you start: card-type counts,
  average cost, its rarest cards, and whether it is still the starter list.

Saving a deck requires all of these:

- **Exactly 60 cards.**
- **Owned cards only:** no more copies than you own. Owned copies are shared by all your decks.
- **Copy limits:** 2 per non-land card, 1 per legendary. **Basic lands have no copy limit**, only the land
  caps below; that is why a 60-card starter can hold 20–22 copies of one land. Special lands (Rainbow,
  Distant Planet) are limited to 2.
- **Colour identity:** every colour in a card's cost must be a deck colour (colourless is always allowed).
  A land must produce at least one deck colour.
- **Land caps:** mono decks at most 20 lands; dual decks at most 11 per colour (22 total).

In the Deck Builder:
- Every card row shows a preview (cost, type, stats, keywords, rarity), how many you own and how many are in
  the deck, and an ⓘ button for its full rules.
- A greyed Add button says why it can't add: not owned, no owned copies left, copy limit, or deck full.
- A summary shows cards out of 60, lands, creatures, spells and artifacts, and the mana curve of the deck
  you're editing.
- Anything that would stop a save is listed with a one-tap fix where there is one.
- Filters never touch your edits, and leaving with unsaved changes asks first.

## Booster Packs & Economy

| | Credits |
|---|---|
| Starting credits | 100 |
| Win | +25, **plus one free booster pack** every win |
| Loss | +10 |
| Fantasy, Science Fiction, Tech, Alien or Robot pack | 60 |
| Lands pack | 40 |

- A pack holds 5 different cards from its pool. Each card's packs are listed explicitly (`PACK_MEMBERSHIP`,
  [CARD_AUDIT.md](CARD_AUDIT.md) §7):
  - Alien and Robot packs hold aliens and robots;
  - Lands packs hold only lands;
  - every card is in at least one pack.
- Slots 1–3 are commons, slot 4 a rare, and slot 5 an epic or legendary. The Robot pack has only one Epic, so
  its slot 5 is Epic or Rare.
- "What's inside" in the shop shows each pack's cards, what you own and the chance of each card.
- Win packs use a random theme, weighted Fantasy 24, Science Fiction 18, and the others 14 each.
- With too few credits a purchase does nothing: no charge and no cards.
- Open economy questions are listed in [PROGRESSION.md §8](PROGRESSION.md).

## Controls & UX

Tested on narrow Android portrait, phone landscape, tablet and desktop sizes: see [UI.md](UI.md)
(`npm run ui`).

### Every device

- **Tap or click** a hand card to play it, a land stack to tap one land, an artifact to use it, and (after
  ATTACK) a creature to select it. Tapping any other card, or an enemy card, shows its details.
- **Long-press or right-click** a card for its details; on a land stack it taps all its untapped lands.
- The banner above the battlefield shows the turn number, whose turn it is and the phase. On the enemy turn it
  says what the AI is doing (drawing, playing a land, tapping mana, attacking); it never shows the AI's hand.
- **ATTACK** turns the buttons into **✓ CONFIRM n** and **✕ CANCEL**. While you choose, each creature says
  whether it can attack (and why not: tapped, Defender, arrived this turn), and the **Preview** shows the
  automatic blocks and the expected result: life totals, who dies, and whether it wins the match. It is only a
  preview; blocks are made from the board as it is when you confirm.
- A hand card you can't play right now shows why: land already played this turn, or how much mana it still needs.
- After combat, a message lists who blocked whom and what died. Messages appear on the turn banner, so they
  never cover cards. 💔 shows damage taken this turn; a dashed border marks a creature that can't attack until
  next turn.
- On the board: your chosen attackers have a solid red outline and ⚔️; creatures that could attack, a dashed
  outline; the enemy creatures predicted to block, a dotted outline and 🛡. The predicted outcome (✓ survives,
  ☠ dies) sits low on each card.
- The AI's turn is marked too: cards it put down since its turn began say **NEW** (until its next turn); while
  it attacks, its attackers have ⚔️ and your creatures that blocked automatically have 🛡.
- Each side shows its life (largest), deck size and, for the enemy, how many cards it holds.
- **📜 Match history** (header, or `H`) keeps the last 80 events of the match: plays and what they did,
  attacks, blocks, damage, deaths and life changes, grouped by turn. The badge counts new entries.

### Keyboard

- `Tab` to a card, `Enter` to play or use it, `I` for its details.
- During your turn: `Space` / `E` end turn, `A` attack / confirm, `M` mulligan (when available). While choosing
  attackers, the CANCEL button leaves without attacking (`Space` still means end turn, which waits until you
  confirm or cancel).
- `H` opens the match history at any time.
- `Esc` closes the open window (card details, graveyard, match history, confirmations, pack), resumes from pause, or pauses.
- **Pause** (☰ or `Esc`) really stops the match: the AI's turn, toasts and timers wait, and the board takes no
  input until you resume. The match also pauses itself if you switch tab or app. The pause menu has Resume,
  Sound, Music (with volume), Effects (with volume) and Haptics settings, the theme, a short controls list, and MAIN MENU (with the usual
  confirmation) set apart at the bottom.
- Dialogs keep keyboard focus inside them and return it when they close.

### Touch

- Pack opening: drag/swipe to rip the sealed pack (or press OPEN PACK), then swipe sideways (one card per swipe)
  or use PREV/NEXT to browse. ALL 5 CARDS shows the summary.
- Swiping across the hand or battlefield scrolls it without playing anything or scrolling the page.
- Pinch-zoom is allowed; double-tap zoom is not.

### Visual theme

- **Theme: …** on the main menu (or 🎨 THEME in the pause menu) opens the picker. Each option is drawn in its own
  theme. The choice applies at once and is remembered on this device.
- Keyboard: arrow keys, `Home` and `End` move between themes and pick them; `Esc` closes the picker.
- The theme is saved apart from your profile: switching it never touches the save, and RESET PROGRESS keeps it.

### Motion and sound

- Nothing loops or pulses during a match, in any theme. The start screen and the result banners animate once.
- With the system's **reduce motion** setting, the intro animation, screen shake, particles and those one-off
  entrances are off too.
- No sound plays before the first tap or click (browser autoplay rules).
- **Sound settings** are in the pause menu and behind **🔊 Sound** on the main menu: Sound (everything; also the
  header 🔊), Music and Effects, each with a volume, and Haptics. They are remembered on this device.
- Effects are short and quiet by design, and each one is synthesised in the browser (`feedback.js`). Damage and
  healing make one sound per change, not one per point. Opening packs has a rip and a reveal sound, with a rising
  arpeggio for rare cards. Details and measurements: [AUDIO.md](AUDIO.md).
- **Haptics** (phones that support vibration): short buzzes when you play a card, attack, take damage, reveal a
  rare card, win or lose. Never on the AI's own actions, never before your first touch, and only single short
  pulses with reduce motion.
- `docs/sound-board.html` plays every effect and vibration pattern, for checking them on a device.

## How To Run

Entry point: `index.html` (loads `styles.css` and `index.js`).

Recommended (local server):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Alternative:

```bash
npx http-server -p 8000
# then open http://localhost:8000
```

You can also open `index.html` directly in many browsers, but a local server is best for consistent media behavior.

## Data & Persistence

| Key | Contents |
|---|---|
| `emoji_elements_meta_v1` | Your profile: collection, decks, credits, stats, last pack (schema version 1) |
| `emoji_elements_meta_backups` | Up to 3 earlier copies of the profile, saved before the game ever rewrites or resets it |
| `emojiElementsStats` | Win/loss copy for the legacy build; imported once into a new profile |
| `emojiElementsMuted` | Sound on/off (music and effects) |
| `emojiElementsMusicOff` / `emojiElementsMusicVolume` | Music off; music volume (0–1, default 0.5) |
| `emojiElementsSfxOff` / `emojiElementsSfxVolume` | Effects off; effects volume (0–1, default 0.7) |
| `emojiElementsHaptics` | Vibration on supporting phones (default on) |
| `emoji_elements_theme` | Visual theme: `arcane`, `deep-space` or `neon` (kept apart from the profile; a reset keeps it) |
| `emoji_elements_achievements_v1` | Achievements: unlocked ids with dates, lifetime counters, the notice setting (version 1; a reset of the profile keeps them; never saved in QA mode). See [ACHIEVEMENTS.md §3](ACHIEVEMENTS.md) |

- On every load, a damaged or older profile is **repaired, not replaced**. A save that can't be read at all
  is kept in the backups before a new profile starts. Details and the migration plan: [PROGRESSION.md §7](PROGRESSION.md).
- If the browser refuses to save (storage full or blocked), the game shows a warning instead of failing silently.

Reset options:

- **Stats screen → 🔄 RESET STATS** clears wins and losses only.
- **Stats screen → 🧹 RESET PROGRESS** starts a new profile; the old one is kept in the backups.
- QA/dev helper: open the game with `?qa=1` (QA mode), then `window.__qaResetMeta()` (confirm, clear, reload).
- Manual hard reset in the console:

```js
localStorage.removeItem('emoji_elements_meta_v1');
localStorage.removeItem('emojiElementsStats'); // otherwise the old wins/losses are imported again
location.reload();
```

## Testing

Automated checks (Node 22+ and Playwright; `npm install` then `npx playwright install chromium`):

| Command | What it covers |
|---|---|
| `npm test` | Card catalog and manifest check (no browser) |
| `npm run rules` / `combat` / `effects` / `progression` / `ai` | Rules, combat, every card effect, saves and progression, AI |
| `npm run smoke` | Desktop and mobile smoke flows |
| `npm run ui` | Layout, touch, keyboard, accessibility at phone, tablet and desktop sizes ([UI.md](UI.md)) |
| `npm run menu` | Main menu and battle setup: hierarchy, labels, credits and collection, deck summary, saved deck, keyboard, axe ([UI.md](UI.md) §7) |
| `npm run collection` | Collection and Deck Builder: filter combinations, add/remove and Add reasons, summary and curve, invalid saves, unsaved-edit warnings, reloads, existing saves ([UI.md](UI.md) §9) |
| `npm run feedback` | Gameplay feedback: the attack preview matches real combat for both sides (first strike, double strike, trample, deathtouch, menace, lifelink, lethal), changes nothing, and refreshes; play and attack reasons; CONFIRM/CANCEL; turn banner and AI status; match history ([UI.md](UI.md) §10) |
| `npm run packs` | Pack pools (Alien, Robot, Lands, every card reachable), slots and exact odds vs generated packs, fallbacks, shop tiles and "What's inside", one charge per purchase, NEW vs ownership before the pack, win reward, saves across a reload ([UI.md](UI.md) §11) |
| `npm run regression` | Final regression: Deck Builder focus and scroll, combined filters, combat preview = result on 40 random boards, pack membership = manifest, nothing running after leaving a match, history bound, keyboard-only turn, reduced motion, portrait/landscape changes, fresh and existing profiles ([QA_REPORT.md](QA_REPORT.md) §2) |
| `npm run cross-browser` | The main flows in every installed engine (Chromium, Firefox, WebKit); engines that aren't installed are reported as NOT TESTED. This is browser emulation, not real devices. |
| `npm run achievements` | All 150 achievements unlocked from real game events, catalog and document checks, unlock once, reloads, migration, backfill, QA isolation, the screen and notices, long-match cost ([ACHIEVEMENTS.md](ACHIEVEMENTS.md)) |
| `npm run audio` | Sound effects and haptics: nothing before the first gesture, cue lengths and levels, independent settings kept across reloads, rapid input and voice limits, one sound per life change, a whole turn, pause, packs, win/loss, haptic guards, no vibration / no Web Audio / interrupted audio, the sound board ([AUDIO.md](AUDIO.md)) |
| `npm run battle` | Battle screen and pause: pause stops the AI turn and every match timer and resumes with the time left, no input while paused, focus returns, sound/music/haptics switches, MAIN MENU confirmation, auto-pause when hidden, toasts never cover cards, AI activity marks, attacker/blocker outlines, counters, a 15-turn session ([UI.md](UI.md) §13) |
| `npm run themes` | The three visual themes at desktop, phone and phone-landscape: axe and measured text contrast, overflow and clipped text, the logo, no looping animation; saving, reload, reset and keyboard use of the picker ([UI.md](UI.md) §12). `npm run menu`, `ui` and `cards:ui` also take `--theme=deep-space` or `--theme=neon`. |
| `npm run cards:ui` | Card faces, battlefield states, card details and pack reveals: every type, element and rarity, crowded boards, phone and desktop ([UI.md](UI.md) §8) |
| `npm run release` | Release playthroughs through the real UI, plus a long-match performance run ([QA_REPORT.md](QA_REPORT.md)) |
| `npm run ai:sim` | Measured AI sample: 15 decks × 3 difficulties ([AI.md](AI.md)) |

QA mode (debug logs and `window.__qa*` helpers) is off for players. Add `?qa=1` to the URL to turn it on.

## Roadmap (Beta)

- Improve pack telemetry + duplicate-protection tuning.
- Real targeting for spells, and choosing blockers (see the open choices in RULES.md, EFFECTS.md and AI.md).
- Continue mobile UX polish for battle screens.

## Credits

Built by Inspire Software / EMOJI ELEMENTS team.

🌐 https://www.inspireclothing.art
