# ⚔️ EMOJI ELEMENTS v2 (Beta)

EMOJI ELEMENTS v2 is a fast, browser-based elemental card battler with a real progression loop: build decks from cards you own, earn credits from every match, crack themed booster packs, and tune mono/dual-color lists for your next run. It’s pure HTML/CSS/JS, runs on desktop and mobile, and saves your meta progress locally.

## Features

- 1v1 turn-based card battles with lands, creatures, instants, and artifacts.
- Match economy with credits on **win and loss**, plus a **free booster chance on win**.
- Deck Builder backed by owned cards (collection-driven), with copy-limit + deck-size validation.
- Standardized starter deck keys for mono and dual identities.
- Pack Shop with themed packs: fantasy, sci-fi, tech, alien, robot, lands.
- Animated pack opening flow with drag-to-rip + swipe card reveal.
- Desktop shortcuts + mobile touch support.
- localStorage persistence for stats, collection, decks, wallet, and last pack.

## Gameplay Overview

- Start at **20 life** vs AI at 20.
- Draw 7-card opening hands.
- On your turn, play cards from hand if you can pay mana costs.
- You can play **one land per turn**.
- Use **Attack** to enter combat and confirm attackers.
- End turn, let AI play, repeat until life reaches 0.
- Match ends when:
  - your life <= 0 → loss
  - enemy life <= 0 → win

## Progression & Collection

- Your long-term data is in a meta save (`emoji_elements_meta_v1`) containing:
  - `collection` (owned card copy counts)
  - `decks` (saved per deck key)
  - `wallet.credits`
  - `stats` (`wins`, `losses`, `packsOpened`)
  - `lastPack`
- Opening packs increments owned copies directly in `collection`.
- Rarity is inferred and used for pack reveal glow/flash tiers: `common`, `uncommon`, `rare`, `epic`, `legendary`.
- **Collection/Binder note:** this beta tracks ownership in meta + Deck Builder pool. A dedicated Binder screen is optional/variant and not guaranteed in this build.

## Decks & Deck Builder

Standardized starter keys created on fresh meta:

- **Mono:** `FIRE`, `WATER`, `EARTH`, `SWAMP`, `LIGHT`
- **Dual:** `FIRE_WATER`, `FIRE_EARTH`, `WATER_EARTH`, `EARTH_SWAMP`, `SWAMP_LIGHT`

How deck persistence works now:

- Each key has `starterCardIds` + editable `cardIds`.
- Saved deck lists are persistent and reused.
- Match load currently reads `gameMeta.selectedDeckKey` (default `FIRE`) for the player deck.

Rules enforced by validation:

- **Owned cards only** (cannot exceed owned copies).
- **Exact deck size required** (`getDeckTargetSize(deck)`, currently starter-size, default fallback `30`).
- **Copy limits:**
  - non-legendary: max `2`
  - legendary: max `1`
- Deck legality by color identity (card must be legal for that deck’s colors).

Starter composition baseline (`buildStarterDeckFromColors`):

- `LAND_COUNT = 25`
- `NON_LAND_COUNT = 35`
- `COLORLESS_LAND_COUNT = 3`
- Total starter deck size = **60 cards**.

## Booster Packs & Themes

Pack sources:

- **Win rewards:** free pack chance via `WIN_FREE_PACK_CHANCE`.
- **Shop:** buy themed packs with credits.

Pack themes (`PACK_THEMES`):

- `fantasy`
- `scifi`
- `tech`
- `alien`
- `robot`
- `lands`

Theme meaning:

- Cards are selected from inferred theme pools (explicit theme + keyword inference), with fallback behavior if a pool is shallow.
- Lands packs prioritize land pulls.

Pack contents (`generatePack`):

- 5 cards per pack, drawn across common/uncommon/rare+ tiers.

## Economy (Coins/Credits)

Currency label in UI: **Credits**.

Code constants:

- Win credits: `BASE_WIN_CREDITS = 25`
- Loss credits: `BASE_LOSS_CREDITS = 10`
- Free win pack chance: `WIN_FREE_PACK_CHANCE = 0.15` (15%)
- Starting credits: `STARTER_CREDITS = 100`

Shop costs (`PACK_SHOP_COSTS`):

- `fantasy`: 60
- `scifi`: 60
- `tech`: 60
- `alien`: 60
- `robot`: 60
- `lands`: 40

Credits display locations:

- Pack Shop badge: `💳 Credits: <value>` (`#shopCreditsBadge`)
- Match reward updates happen in `finalizeMatch()`.

## Controls & UX

### Desktop

- Mouse/touch click cards to play.
- Click lands to tap for mana.
- Keyboard shortcuts during active player turn:
  - `Space` / `E`: End Turn
  - `A`: Attack / Confirm
  - `M`: Mulligan (when available)
  - `Esc`: pause or close overlays/contextually

### Mobile

- Touch interactions supported across gameplay cards/board.
- Pack opening supports:
  - **drag/swipe to rip open sealed pack**
  - **horizontal swipe to browse revealed cards**
- Intro and menu interactions are touch-aware (`touchend` handlers).

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

Primary keys:

- `emoji_elements_meta_v1` → main progression/meta save
- `emojiElementsStats` → legacy/compat stats
- `emojiElementsMuted` → audio mute state

Reset options:

- In-game: **Stats screen → 🧹 RESET PROGRESS** (`resetMetaProgress()`) clears and reseeds progression.
- QA/dev helper: `window.__qaResetMeta()` (confirm + clear + reload).
- Manual console hard reset:

```js
localStorage.removeItem('emoji_elements_meta_v1');
location.reload();
```

## Roadmap (Beta)

- Add explicit deck-key selection wiring from battle setup to `selectedDeckKey`.
- Expand collection UX with a dedicated binder/album view.
- Improve pack telemetry + duplicate-protection tuning.
- Add more dual deck templates across all color pairings.
- Continue mobile UX polish for battle + menus.

## Credits

Built by Inspire Software / EMOJI ELEMENTS team.

🌐 https://www.inspireclothing.art
