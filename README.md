# ⚔️ EMOJI ELEMENTS v2 (Beta)

EMOJI ELEMENTS v2 is a fast, browser-based elemental card battler with a real progression loop: build decks from cards you own, earn credits from every match, crack themed booster packs, and tune mono/dual-color lists for your next run. It’s pure HTML/CSS/JS, runs on desktop and mobile, and saves your meta progress locally.

## Features

- 1v1 turn-based card battles with lands, creatures, instants, and artifacts.
- Match economy: credits on **win and loss**, plus a **free booster pack on every win**.
- Deck Builder backed by owned cards (collection-driven), with copy-limit + deck-size validation.
- Standardized starter deck keys for mono and dual identities.
- Pack Shop with themed packs: fantasy, sci-fi, tech, alien, robot, lands.
- Animated pack opening flow with drag-to-rip + swipe card reveal.
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
- AI difficulty levels (Easy, Medium, Hard). All three play by the same rules and deck limits as you; they differ
  in how many cards they play a turn, whether they cast instants and see lethal, and how carefully they attack:
  [AI.md](AI.md) (`npm run ai`, `npm run ai:sim`).
  Where a card says "target", the game picks a random legal creature (damage goes to your opponent); card
  details show each card's exact **Rules** line.

## Progression & Collection

Full, test-backed rules: [PROGRESSION.md](PROGRESSION.md) (`npm run progression`).

- A new profile starts with **100 credits** and the **starter collection**: the cards of the five mono starter
  decks (153 different cards, 300 copies).
- Opening a pack adds its cards to your collection; duplicates stack (`x3` in the Binder).
- **Binder / Collection** (main menu) lists every owned card with its count, sorted by name.
- Rarity is inferred from each card: `common`, `rare`, `epic`, `legendary`. No card is currently `uncommon`.

## Decks & Deck Builder

There are 15 standard decks, each starting as a 60-card starter list:

| | Keys | Basic lands | Non-lands |
|---|---|---|---|
| Mono | `FIRE`, `WATER`, `EARTH`, `SWAMP`, `LIGHT` | 20 | 40 |
| Dual | all ten pairs, `FIRE_WATER` … `SWAMP_LIGHT` | 11 + 11 | 38 |

- Starter lists only use cards the starter collection owns, so every starter deck is legal on a new profile.
- Starting a match with the chosen colour(s) plays that saved deck exactly, and it becomes the selected deck.
  The Deck Builder opens on the selected deck.

Saving a deck requires all of these:

- **Exactly 60 cards.**
- **Owned cards only:** no more copies than you own. Owned copies are shared by all your decks.
- **Copy limits:** 2 per non-land card, 1 per legendary. **Basic lands have no copy limit**, only the land
  caps below; that is why a 60-card starter can hold 20–22 copies of one land. Special lands (Rainbow,
  Distant Planet) are limited to 2.
- **Colour identity:** every colour in a card's cost must be a deck colour (colourless is always allowed).
  A land must produce at least one deck colour.
- **Land caps:** mono decks at most 20 lands; dual decks at most 11 per colour (22 total).

## Booster Packs & Economy

| | Credits |
|---|---|
| Starting credits | 100 |
| Win | +25, **plus one free booster pack** every win |
| Loss | +10 |
| Fantasy, Science Fiction, Tech, Alien or Robot pack | 60 |
| Lands pack | 40 |

- A pack holds 5 different cards from its theme pool. Slots 1–3 are commons, slot 4 a rare, and slot 5 an
  epic or legendary (falling back if a pool runs out). Lands packs favour lands ×3.
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
- After combat, a message lists who blocked whom and what died. 💔 shows damage taken this turn; a dashed
  border marks a creature that can't attack until next turn.

### Keyboard

- `Tab` to a card, `Enter` to play or use it, `I` for its details.
- During your turn: `Space` / `E` end turn, `A` attack / confirm, `M` mulligan (when available).
- `Esc` closes the open window (card details, graveyard, confirmations, pack), resumes from pause, or pauses.
- Dialogs keep keyboard focus inside them and return it when they close.

### Touch

- Pack opening: drag/swipe to rip the sealed pack, then swipe sideways (one card per swipe) to browse.
- Swiping across the hand or battlefield scrolls it without playing anything or scrolling the page.
- Pinch-zoom is allowed; double-tap zoom is not.

### Motion and sound

- With the system's **reduce motion** setting, the intro animation, screen shake, particles and looping glows
  are off.
- No sound plays before the first tap or click (browser autoplay rules). The mute choice is remembered.

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
| `emojiElementsMuted` | Sound on/off |

- On every load, a damaged or older profile is **repaired, not replaced**. A save that can't be read at all
  is kept in the backups before a new profile starts. Details and the migration plan: [PROGRESSION.md §7](PROGRESSION.md).
- If the browser refuses to save (storage full or blocked), the game shows a warning instead of failing silently.

Reset options:

- **Stats screen → 🔄 RESET STATS** clears wins and losses only.
- **Stats screen → 🧹 RESET PROGRESS** starts a new profile; the old one is kept in the backups.
- QA/dev helper: `window.__qaResetMeta()` (confirm, clear, reload).
- Manual hard reset in the console:

```js
localStorage.removeItem('emoji_elements_meta_v1');
localStorage.removeItem('emojiElementsStats'); // otherwise the old wins/losses are imported again
location.reload();
```

## Roadmap (Beta)

- Improve pack telemetry + duplicate-protection tuning.
- Add more dual deck templates across all color pairings.
- Continue mobile UX polish for battle + menus.

## Credits

Built by Inspire Software / EMOJI ELEMENTS team.

🌐 https://www.inspireclothing.art
