# Achievements

EMOJI ELEMENTS has 150 achievements in 13 categories. The catalog and the unlock logic are in `achievements.js` (`window.Achievements`). The game reports confirmed outcomes to it from `index.js`. The Achievements screen and the unlock notices are in `index.js` (`renderAchievements`, `queueAchievementNotice`), with styles under "Achievements" in `styles.css`.

The full catalog, with every trigger, is in [§8](#8-the-catalog). That table is generated from the code by `npm run achievements:doc`. The test suite fails if the table no longer matches the code.

## 1. What the game can observe

Every trigger reads only things the engine really tracks:

- the player's own plays;
- the public board (both sides);
- life totals;
- combat results;
- the saved profile (wins, losses, packs opened, collection, credits).

Nothing reads the enemy's hand contents (only its size, which the board shows), the order of either deck, or the AI's plans.

| Event (`reportAchievement`) | Reported from | Payload |
|---|---|---|
| `match:start` | end of `startGame` | `deckKey` (e.g. `FIRE_WATER`), `elements`, `difficulty` |
| `turn:start` | `startPlayerTurn` | `side: 'player'`, `round` |
| `card:played` | `playCard`, after the card resolved | `side`, `card`, `manaBefore`, `manaAfter` (pool totals around paying the cost) |
| `land:tapped` | `tapLand` (also the dual-land choice) and `tapAllLandsOfType` | `cards`: the lands that were tapped |
| `mana:artifact` | `activateArtifact` | `card` |
| `spell:resolved` | `castInstant` and `resolveArtifactOnPlay` (both sides) | `describeOutcome`: `enemyLifeChange`, `bounced`, `destroyed`, `deaths[{card, owner}]`, `tokens`, `revived`, `discarded`, `enemyHandAfter`, `frozeTapped`, `buffed`, `drawn` |
| `upkeep` | `processUpkeepEffects` | `side`, `drawn`, `enemyLifeChange` |
| `combat` | `resolveAttackersWithHistory` (both sides) | `side` (the attacker), `untappedDefenders`, `pairs[{attacker, blockers, attackerDies, blockersDie, lifeChange}]` |
| `life:changed` | `changePlayerLife`, `changeEnemyLife` | `side`, `amount`, `change`, `before`, `after`, `source` (`instant`, `drain`, `artifact`, `upkeep`, `combat` or null) |
| `match:end` | `finalizeMatch` (once per match) | `result` (`win`/`loss`), `reason` (`life`/`decked`) |
| `pack:opened` | `reportPackOpened`: when the pack is torn open, or when its screen is closed unopened (once per pack) | `themeKey`, `cards[{id, rarity, isNew}]` |
| `pack:purchased` | `purchasePack` | `themeKey`, `price` |
| `collection`, `wallet` | after a pack is opened; `metaSave` | (none: the saved profile is read) |
| `deck:saved`, `mulligan`, `card:details`, `theme`, `match:quit` | deck builder save, `performMulligan`, `showCardDetail` during trusted card input, theme change, QUIT confirmed | small payloads |

After `card:played`, `spell:resolved`, `combat`, `turn:start` and `match:start`, the "control … at once" achievements are also checked against the board (internal event `board`).

A lethal hit ends the match inside `changeEnemyLife`, before the spell or combat that dealt it is reported. That is why each life change carries its `source`: "Win with an instant / Drain Life / combat damage" read the source of the enemy's last loss, which is known before `match:end`. The match context also stays until the next match starts, so the report that follows `match:end` still has it.

`reportAchievement` catches everything, so an achievement problem can never stop the game.

## 2. Design rules for the catalog

- **150 distinct goals.** No two achievements restate the same count. Win counts appear only at 1, 10 and 50, and finished matches at 1 and 100. The rest are about how a match was played.
- **Every one is earnable** with cards in the game and decks the game allows:
  - Each "control these at once" set fits one deck's colours:
    - Spooky Season and Clown Car are Swamp.
    - Fairy Tale is Light.
    - Big Cat Energy and Some Assembly Required are Fire + Earth.
  - Collection thresholds start above the starter collection (153 different cards), so none is free.
- **Nothing hidden.** No trigger depends on information the engine doesn't track.
- **Hidden achievements** (Overdrawn, Poop Happens, Rage Quit, Clown Car) show as "Hidden achievement" until unlocked. They are jokes, not requirements.
- **Humour is specific to the game:**
  - Flash doing nothing (Flash Mob);
  - the Werewolf being the only double striker (Once in a Blue Moon);
  - the Poop having Menace;
  - Deep Freeze on a creature that was already tapped (Chill Out).

## 3. Storage and migration

Achievements live in their own key, `emoji_elements_achievements_v1`. The profile (`emoji_elements_meta_v1`: credits, cards, decks, stats) is only read, never written.

```json
{ "version": 1,
  "unlocked": { "first-win": { "at": "2026-10-22T10:00:00.000Z" }, "wins-10": { "at": "…", "backfilled": true } },
  "counters": { "landTaps": 312, "played.creature": 41, "plays.fire": 18, "streak": 2, "themes": ["arcane"], "previousResult": "win" },
  "prefs": { "notify": true } }
```

**Unlock once.** `unlock()` returns early when the id is already in `unlocked`. Each new unlock is saved at once.

**Counters.** These change on every land tap. They are written at most every 500 ms (`saveSoon`).

**Migration** (`migrate`):

- Unknown fields are dropped.
- Counters that are not numbers, strings or string lists are dropped.
- An unlocked entry without a date keeps the unlock, dated 1970. The screen then shows it without a date.
- Ids this build does not know are kept, so a later catalog keeps them, but they don't count toward the 150.

**Corrupt data** is copied to `emoji_elements_achievements_backup`, and the store starts again. Backfill (§4) then recognises what the profile proves.

**A newer version** (`version > 1`) is used read-only for the visit. It is never overwritten with less.

## 4. Backfill: only what the saved profile proves

On load, `init` checks the 19 achievements that have a `backfill` rule. These can be proven from the saved profile alone:

- wins and losses;
- finished matches;
- packs opened;
- different cards owned;
- Legendary, Epic and Sci-Fi ownership;
- three copies of a Legendary;
- 500 credits.

They are stored with `backfilled: true`. The player sees one quiet notice ("Recognised from your saved progress · N achievements", no sound). The list says "From your saved progress" instead of a date.

Nothing about past plays, combos or match conditions is ever backfilled. Streaks, difficulties and pack types also start counting from the first match after the update.

## 5. QA isolation

With `?qa=1` (or `localStorage.emojiElementsQA = '1'`), achievement events and backfill are disabled and nothing is saved. The runtime `__QA_FORCE_META_OFF` fixture switch also suppresses events. QA actions cannot create even temporary unlocks. QA profiles, legacy stats and backups use separate storage keys, so a later normal reload cannot backfill QA payouts into real achievements.

QA tools (`__qaResetMeta`, fixtures, forced outcomes) therefore can't award a real profile anything. The tests check this, including across the QA reset's reload.

The test suites run in fresh browser contexts, so their storage never touches a real browser profile.

**RESET STATS / RESET PROGRESS** on the Stats screen reset the profile, not achievements. Achievements already earned stay earned. Later backfills can only add, never remove.

## 6. Screen and notices

**Where to find it.**

- **Main menu:** the 🏆 Achievements tile shows "N of 150 unlocked".
- **Pause panel:** an Achievements row opens the same list as a dialog. Esc closes it back to the pause panel; the match stays frozen.

**The list.**

- A summary shows the count and a progress bar.
- An "Unlock sound & buzz" switch controls notice feedback.
- Filter chips: All, Unlocked, and the 13 categories, each with its count.
- The list scrolls and can be focused by keyboard.
- **Unlocked** entries have a gold edge and show their date.
- **Locked** entries are dimmed.
- **Counted** achievements show a bar (e.g. "121 / 500").
- **Hidden** ones show ❔ "Hidden achievement" until unlocked.

**Notices.**

- Notices are queued and shown one at a time for 3.2 s.
- They appear as a small pill at the top centre. In a match it sits over the header, never over the hand, the turn buttons or the life totals, and it lets clicks through.
- When several unlock together (a win often brings a few), the notice counts the rest ("· 3 more").
- Opening PAUSE, the Achievements dialog or a pack reveal takes down the notice on screen at once (on phones it would cover their headings). It comes back afterwards, without its sound again.
- Notices wait while:
  - the game is paused;
  - the Achievements dialog is open;
  - a pack is being revealed (a notice could spoil the cards);
  - the title screen is up;
  - the page is hidden.
- Each notice plays the `achievement` cue and the `achievement` haptic ([10, 40, 10]). Both go through the existing Effects and Haptics settings, and the haptic uses the guarded helper. The switch on the screen turns both off for notices only.

## 7. Tests

`npm run achievements` (`tests/achievements.test.mjs`):

- **Catalog.**
  - Exactly 150 entries, with unique ids, names and icons.
  - Known categories and tiers.
  - Every event a trigger listens for is reported by `index.js`.
  - This document is current.
- **Coverage.** About 100 scenarios drive the real game:
  - `playCard`, `tapLand`, `tapAllLandsOfType`, `activateArtifact`;
  - the attack phase (`enterAttackPhase` → `selectAttacker` → `confirmAttackers`, with the AI's automatic blocks);
  - the AI's own turn (the player's automatic blocks);
  - `purchasePack` with the tear or close;
  - `finalizeMatch` through life loss or decking;
  - the deck builder, mulligan, theme and quit flows.

  Each scenario asserts its achievements were locked before, and unlocked by an event (not backfill) after. A final check confirms the scenarios covered all 150.

  To keep the run short and repeatable:
  - **Long counts start one short.** They are seeded through a saved counter or the saved profile, and the last step is a real event:
    - 500 land taps, 100 creatures, 50 instants, 25 artifacts, 100 lands;
    - 30 plays per element;
    - 10/50 wins, 100 matches;
    - a 10-win streak, 5 Hard wins;
    - 50 card details, 1,000 credits spent, 50 packs.
  - **Pack contents are fixed** for the collection scenarios (`generatePack` is replaced). This is the only stand-in; buying, adding to the collection and revealing are the game's own.
  - **The AI attacks with everything** in the blocking scenarios (as in `combat.test.mjs`).
- **Behaviour.**
  - Unlock once across repeats, re-renders and a reload, with the date kept.
  - Counters saved in batches, and continued after a reload.
  - Migration: a corrupt store, odd fields and unknown ids, and a newer version kept read-only.
  - Backfill recognises exactly the provable set, quietly, without touching the profile.
  - QA mode saves nothing, including after the QA reset.
  - The screen: filters, progress, hidden entries, and the pause dialog with Esc.
  - Notices:
    - queue, count the rest, and wait while paused;
    - never overlap the match controls;
    - respect the notice switch;
    - stay silent without vibration support.
- **Long match.** 60 turns of land taps, plays and turn starts (over 900 events). Each event takes under 1 ms on average, and the store is written fewer than 40 times.

**Not checked on a real device:** the notice sound and buzz on a phone. The notice cue is the one reviewed in AUDIO.md, and the haptic pattern is new. Everything above was checked automatically in headless Chromium.

## 8. The catalog

How to read the trigger column:

| Symbol | Meaning |
|---|---|
| `e` | The event's payload (§1) |
| `x.m` | This match: `minLife`, `lifeLost`, `lifeGained`, `creatures`, `instants`, `lands`, `attacks`, `instantDamage`, `instantsThisTurn`, `extraDrawsThisTurn`, `angerThisTurn`, `playedThisTurn`, `vigilanceAttackers`, `lastEnemyLoss`, `difficulty`, `elements`, `deckKey` |
| `x.c` | Lifetime counters |
| `x.game` | The live, public game state |
| `x.wins`, `x.losses`, `x.packsOpened`, `x.credits`, `x.owned`, `ownedBy(rarity)`, `ownedTheme(theme)`, `maxCopiesOf(rarity)` | Read from the saved profile |

Helpers used in the triggers:

| Helper | What it checks |
|---|---|
| `won(e)` | `e.result === 'win'` |
| `has(card, keyword)` | The card has that keyword |
| `named(id)` | Matches a card by its catalog id |
| `onBoard(board, ...ids)` | All of those cards are on the board |
| `creaturesOf(board)` | The creatures on a board |
| `pool(mana)` | The total mana in a pool |
| `isToken(card)` | The card is a creature token |

<!-- catalog:start (generated by tests/achievements-doc.mjs) -->

### 👣 First steps (10)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 1 | `first-match` | 🃏 Shuffle Up | common | Finish your first match, win or lose. | `match:end` | `true` | yes |
| 2 | `first-win` | 🍀 Beginner's Luck | common | Win a match. | `match:end` | `e.result === 'win'` | yes |
| 3 | `first-land` | 🌱 Plot of Land | common | Play a land. | `card:played` | `e.card.type === 'land'` |  |
| 4 | `first-creature` | 🐣 It's Alive! | common | Summon a creature. | `card:played` | `e.card.type === 'creature'` |  |
| 5 | `first-instant` | ✨ Abracadabra | common | Cast an instant. | `card:played` | `e.card.type === 'instant'` |  |
| 6 | `first-artifact` | 💎 Shiny Object | common | Play an artifact. | `card:played` | `e.card.type === 'artifact'` |  |
| 7 | `first-attack` | ⚔️ Charge! | common | Attack with a creature. | `combat` | `e.side === 'player'` |  |
| 8 | `first-pack` | 📦 Rip It Open | common | Open a booster pack. | `pack:opened` | `true` | yes |
| 9 | `first-deck` | 🛠️ Deckwright | common | Save a deck in the Deck Builder. | `deck:saved` | `true` |  |
| 10 | `first-mulligan` | 🔄 Take-Backsies | common | Take a mulligan. | `mulligan` | `true` |  |

### 🏁 Wins & losses (12)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 11 | `wins-10` | 🔟 Double Digits | rare | Win 10 matches. | `match:end` | `x.wins ≥ 10` | yes |
| 12 | `wins-50` | 🎖️ Seasoned Summoner | epic | Win 50 matches. | `match:end` | `x.wins ≥ 50` | yes |
| 13 | `first-loss` | 🩹 Character Building | common | Lose a match. It happens to the best of us. | `match:end` | `e.result === 'loss'` | yes |
| 14 | `matches-100` | 🗓️ Regular | epic | Finish 100 matches. | `match:end` | `x.wins + x.losses ≥ 100` | yes |
| 15 | `streak-3` | 🎩 Hat Trick | rare | Win 3 matches in a row. | `match:end` | `x.c.streak \|\| 0 ≥ 3` |  |
| 16 | `streak-10` | 🚂 Unstoppable | legendary | Win 10 matches in a row. | `match:end` | `x.c.streak \|\| 0 ≥ 10` |  |
| 17 | `comeback` | 🔁 Comeback Kid | rare | Win a match in which your life fell to 3 or less. | `match:end` | `won(e) && x.m.minLife <= 3` |  |
| 18 | `flawless` | 🫥 Untouchable | epic | Win without losing any life. | `match:end` | `won(e) && x.m.lifeLost === 0` |  |
| 19 | `speedrun` | ⏱️ Speedrun | epic | Win on your turn 7 or earlier. | `match:end` | `won(e) && x.game.round <= 7` |  |
| 20 | `marathon` | 🐢 War of Attrition | rare | Win a match that reached turn 20. | `match:end` | `won(e) && x.game.round >= 20` |  |
| 21 | `so-close` | 🤏 So Close | common | Lose while the enemy had 3 life or less. | `match:end` | `e.result === 'loss' && x.game.enemyLife <= 3` |  |
| 22 | `rematch` | 🥊 Rematch Royale | common | Win the match right after a loss. | `match:end` | `won(e) && x.c.previousResult === 'loss'` |  |

### 🎚️ Difficulty (9)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 23 | `win-easy` | 🚲 Training Wheels | common | Win on Easy. | `match:end` | `won(e) && x.m.difficulty === 'easy'` |  |
| 24 | `win-medium` | ⚖️ Fair Fight | common | Win on Medium. | `match:end` | `won(e) && x.m.difficulty === 'medium'` |  |
| 25 | `win-hard` | 🧠 Big Brain | rare | Win on Hard. | `match:end` | `won(e) && x.m.difficulty === 'hard'` |  |
| 26 | `hard-5` | 🏋️ Hard Mode Regular | epic | Win 5 matches on Hard. | `match:end` | `x.c.hardWins \|\| 0 ≥ 5` |  |
| 27 | `hard-dominant` | 💅 Not Even Close | epic | Win on Hard with 15 or more life left. | `match:end` | `won(e) && x.m.difficulty === 'hard' && x.game.playerLife >= 15` |  |
| 28 | `hard-mono` | 💠 Purist | rare | Win on Hard with a single-element deck. | `match:end` | `won(e) && x.m.difficulty === 'hard' && x.m.elements.length === 1` |  |
| 29 | `hard-clutch` | 🫀 Clutch | epic | Win on Hard after your life fell to 5 or less. | `match:end` | `won(e) && x.m.difficulty === 'hard' && x.m.minLife <= 5` |  |
| 30 | `all-difficulties` | 🎚️ Full Spectrum | rare | Win on Easy, Medium and Hard. | `match:end` | `(x.c.difficultiesWon \|\| []).length ≥ 3` |  |
| 31 | `hard-underdog` | 🐕 Underdog | epic | Win on Hard while the enemy has more creatures on the battlefield than you. | `match:end` | `won(e) && x.m.difficulty === 'hard' && creaturesOf(x.game.enemyBoard).length > creaturesOf(x.game.playerBoard).length` |  |

### 🃏 Decks (15)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 32 | `deck-fire` | 🔥 Pyromaniac | common | Win a match with the Fire deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 33 | `deck-water` | 💧 Making Waves | common | Win a match with the Water deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 34 | `deck-earth` | 🌍 Down to Earth | common | Win a match with the Earth deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 35 | `deck-swamp` | 💀 Swamp Thing | common | Win a match with the Swamp deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 36 | `deck-light` | ☀️ Enlightened | common | Win a match with the Light deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 37 | `deck-fire-water` | ♨️ Steam Engine | rare | Win a match with the Fire + Water deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 38 | `deck-fire-earth` | 🌋 Magma Flow | rare | Win a match with the Fire + Earth deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 39 | `deck-fire-swamp` | 😈 Hellfire | rare | Win a match with the Fire + Swamp deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 40 | `deck-fire-light` | 🌞 Solar Flare | rare | Win a match with the Fire + Light deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 41 | `deck-water-earth` | 🟫 Mudslide | rare | Win a match with the Water + Earth deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 42 | `deck-water-swamp` | 🐸 Bog Standard | rare | Win a match with the Water + Swamp deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 43 | `deck-water-light` | 🌦️ Rainbow Maker | rare | Win a match with the Water + Light deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 44 | `deck-earth-swamp` | 🍂 Compost Heap | rare | Win a match with the Earth + Swamp deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 45 | `deck-earth-light` | 🌻 Photosynthesis | rare | Win a match with the Earth + Light deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |
| 46 | `deck-swamp-light` | 🌗 Twilight | rare | Win a match with the Swamp + Light deck. | `match:end` | `won(e) && x.m.deckKey === key` |  |

### 🔥 Elements (10)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 47 | `fire-30` | 🪵 Kindling Collector | common | Play 30 Fire cards (not lands). | `card:played` | `x.c[`plays.${element}`] \|\| 0 ≥ 30` |  |
| 48 | `water-30` | 🚰 Hydrated | common | Play 30 Water cards (not lands). | `card:played` | `x.c[`plays.${element}`] \|\| 0 ≥ 30` |  |
| 49 | `earth-30` | 🌳 Rooted | common | Play 30 Earth cards (not lands). | `card:played` | `x.c[`plays.${element}`] \|\| 0 ≥ 30` |  |
| 50 | `swamp-30` | 🫧 Swamp Gas | common | Play 30 Swamp cards (not lands). | `card:played` | `x.c[`plays.${element}`] \|\| 0 ≥ 30` |  |
| 51 | `light-30` | 😎 Sunbather | common | Play 30 Light cards (not lands). | `card:played` | `x.c[`plays.${element}`] \|\| 0 ≥ 30` |  |
| 52 | `fire-meteor` | ☄️ Spontaneous Combustion | rare | Deal 6 or more damage to the enemy with one instant. | `spell:resolved` | `e.side === 'player' && e.card.type === 'instant' && e.enemyLifeChange <= -6` |  |
| 53 | `water-tsunami` | 🌊 Tidal Wave | rare | Send 2 enemy creatures back to the hand with one Tsunami. | `spell:resolved` | `e.side === 'player' && e.card.effect === 'bounce' && e.bounced.length >= 2` |  |
| 54 | `earth-heavy` | 🦣 Heavyweight | rare | Control an Earth creature with 7 or more power. | `board` | `creaturesOf(x.game.playerBoard).some(c => x.el(c).includes('earth') && c.power >= 7)` |  |
| 55 | `swamp-necro` | ⚰️ Grave Robber | common | Bring a creature back with Necromancy. | `spell:resolved` | `e.side === 'player' && e.card.__id === 'spells-necromancy' && !!e.revived` |  |
| 56 | `light-heal` | 😇 Holy Glow | rare | Gain 10 or more life in one match. | `life:changed` | `x.m.lifeGained >= 10` |  |

### 🗂️ Card types (8)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 57 | `creatures-100` | 🦁 Zookeeper | rare | Summon 100 creatures. | `card:played` | `x.c['played.creature'] \|\| 0 ≥ 100` |  |
| 58 | `instants-50` | 🪄 Spell Slinger | rare | Cast 50 instants. | `card:played` | `x.c['played.instant'] \|\| 0 ≥ 50` |  |
| 59 | `artifacts-25` | 🔧 Gadgeteer | rare | Play 25 artifacts. | `card:played` | `x.c['played.artifact'] \|\| 0 ≥ 25` |  |
| 60 | `lands-100` | 🏘️ Real Estate Mogul | rare | Play 100 lands. | `card:played` | `x.c['played.land'] \|\| 0 ≥ 100` |  |
| 61 | `creatures-match-8` | 🏠 Full House | rare | Summon 8 creatures in one match. | `card:played` | `x.m.creatures >= 8` |  |
| 62 | `instants-turn-3` | 🎇 Combo Caster | epic | Cast 3 instants in one turn. | `card:played` | `x.m.instantsThisTurn >= 3` |  |
| 63 | `tokens-10` | 🎟️ Token Gesture | common | Create 10 tokens. | `spell:resolved` | `x.c.tokens \|\| 0 ≥ 10` |  |
| 64 | `legendary-play` | 🌟 Legend Has It | rare | Play a Legendary card. | `card:played` | `x.rarity(e.card) === 'legendary'` |  |

### ⚡ Mana & lands (10)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 65 | `taps-500` | 🩰 Tap Dancer | rare | Tap lands for mana 500 times. | `land:tapped` | `x.c.landTaps \|\| 0 ≥ 500` |  |
| 66 | `mana-7` | 🫗 Overflowing | common | Have 7 or more mana in your pool. | `land:tapped`, `mana:artifact` | `pool(x.game.playerMana) >= 7` |  |
| 67 | `mana-10` | ⛲ Mana Geyser | epic | Have 10 or more mana in your pool. | `land:tapped`, `mana:artifact` | `pool(x.game.playerMana) >= 10` |  |
| 68 | `exact-change` | 🪙 Exact Change | rare | Play a card that spends every mana in a pool of 5 or more. | `card:played` | `e.manaBefore >= 5 && e.manaAfter === 0 && e.card.type !== 'land'` |  |
| 69 | `lands-8` | 🏞️ Landowner | common | Have 8 lands on your battlefield. | `board` | `(x.game.playerBoard \|\| []).filter(c => c.type === 'land').length >= 8` |  |
| 70 | `rainbow` | 🌈 Taste the Rainbow | rare | Tap the Rainbow land for mana. | `land:tapped` | `e.cards.some(named('lands-rainbow'))` |  |
| 71 | `distant-planet` | 🪐 Off-World Property | rare | Play the Distant Planet. | `card:played` | `e.card.__id === 'lands-distant-planet'` |  |
| 72 | `mana-artifact` | 🔋 Batteries Included | common | Tap an artifact for mana. | `mana:artifact` | `true` |  |
| 73 | `tap-all` | 🧺 Bulk Discount | common | Tap 3 or more lands at once (long-press a land stack). | `land:tapped` | `e.cards.length >= 3` |  |
| 74 | `prism` | 🔺 Prism | rare | Have 3 different kinds of mana in your pool at once. | `land:tapped`, `mana:artifact` | `Object.values(x.game.playerMana \|\| {}).filter(n => n > 0).length >= 3` |  |

### ⚔️ Combat (20)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 75 | `air-mail` | ✉️ Air Mail | common | An unblocked flyer of yours hits the enemy. | `combat` | `e.side === 'player' && e.pairs.some(p => has(p.attacker, 'flying') && !p.blockers.length && p.lifeChange.enemy < 0)` |  |
| 76 | `swat-team` | 🪰 Swat Team | rare | Your Reach creature blocks a flying attacker. | `combat` | `e.side === 'enemy' && e.pairs.some(p => has(p.attacker, 'flying') && p.blockers.some(b => has(b, 'reach')))` |  |
| 77 | `steamroller` | 🛞 Steamroller | rare | Trample 3 or more damage past a blocker. | `combat` | `e.side === 'player' && e.pairs.some(p => has(p.attacker, 'trample') && p.blockers.length && p.lifeChange.enemy <= -3)` |  |
| 78 | `vampiric` | 🧛 Vampiric Tendencies | rare | Gain 4 or more life from lifelink in one attack. | `combat` | `e.side === 'player' && e.pairs.reduce((sum, p) => sum + Math.max(0, p.lifeChange.player), 0) >= 4` |  |
| 79 | `tiny-deadly` | 🦂 Tiny but Deadly | rare | A deathtouch creature of yours with 2 power or less destroys a creature with 4 or more toughness. | `combat` | `e.pairs.some(p => { const mine = e.side === 'player' ? [p.attacker] : p.blockers; const theirs = e.side === 'player' ? p.blockers.filter(b => p.blockersDie.includes(b.id)) : (p.attackerDies ? [p.attacker] : []); return mine.some(c => has(c, 'deathtouch') && c.power <= 2) && theirs.some(c => c.toughness >= 4); })` |  |
| 80 | `quick-draw` | 🤠 Quick Draw | rare | Your first striker kills a blocker that would otherwise have killed it. | `combat` | `e.side === 'player' && e.pairs.some(p => has(p.attacker, 'first_strike') && !p.attackerDies && p.blockers.length === 1 && p.blockersDie.includes(p.blockers[0].id) && p.blockers[0].power >= p.attacker.toughness)` |  |
| 81 | `double-strike` | 🌕 Once in a Blue Moon | rare | A double strike creature of yours (hello, Werewolf) hits the enemy. | `combat` | `e.side === 'player' && e.pairs.some(p => has(p.attacker, 'double_strike') && p.lifeChange.enemy < 0)` |  |
| 82 | `scary-face` | 😱 Scary Face | common | Your Menace creature goes unblocked while the enemy has an untapped creature. | `combat` | `e.side === 'player' && e.untappedDefenders >= 1 && e.pairs.some(p => has(p.attacker, 'menace') && !p.blockers.length)` |  |
| 83 | `night-watch` | 🔦 Night Watch | rare | Attack with a Vigilance creature, then block with it on the enemy's next turn. | `combat` | `e.side === 'enemy' && e.pairs.some(p => p.blockers.some(b => x.m.vigilanceAttackers.includes(b.id)))` |  |
| 84 | `no-time` | ⚡ No Time to Waste | common | Attack with a creature on the turn you played it. | `combat` | `e.side === 'player' && e.pairs.some(p => x.m.playedThisTurn.includes(p.attacker.id))` |  |
| 85 | `brick-wall` | 🧱 Brick Wall | common | Your Defender blocks an attacker and survives. | `combat` | `e.side === 'enemy' && e.pairs.some(p => p.blockers.some(b => has(b, 'defender') && !p.blockersDie.includes(b.id)))` |  |
| 86 | `shell-game` | 🐚 Shell Game | rare | Control 3 hexproof creatures at once. | `board` | `creaturesOf(x.game.playerBoard).filter(c => has(c, 'hexproof')).length >= 3` |  |
| 87 | `slippery` | 🦦 Slippery Otter | rare | An unblockable creature of yours hits the enemy. | `combat` | `e.side === 'player' && e.pairs.some(p => has(p.attacker, 'unblockable') && p.lifeChange.enemy < 0)` |  |
| 88 | `bodyguard` | 🕴️ Bodyguard | common | One of your automatic blocks destroys the attacker. | `combat` | `e.side === 'enemy' && e.pairs.some(p => p.blockers.length && p.attackerDies)` |  |
| 89 | `double-team` | 👯 Double Team | rare | Block a Menace attacker with two of your creatures. | `combat` | `e.side === 'enemy' && e.pairs.some(p => has(p.attacker, 'menace') && p.blockers.length >= 2)` |  |
| 90 | `alpha-strike` | 💥 Alpha Strike | epic | Deal 10 or more combat damage to the enemy in one attack. | `combat` | `e.side === 'player' && -e.pairs.reduce((sum, p) => sum + Math.min(0, p.lifeChange.enemy), 0) >= 10` |  |
| 91 | `coup` | 🗡️ Coup de Grâce | common | Win with combat damage. | `match:end` | `won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'combat'` |  |
| 92 | `all-in` | 🎲 All In | rare | Attack with 5 or more creatures at once. | `combat` | `e.side === 'player' && e.pairs.length >= 5` |  |
| 93 | `fair-trade` | 🤝 Fair Trade | common | Your attacker and its blocker destroy each other. | `combat` | `e.side === 'player' && e.pairs.some(p => p.attackerDies && p.blockers.length && p.blockers.every(b => p.blockersDie.includes(b.id)))` |  |
| 94 | `clean-sweep` | 🧹 Clean Sweep | epic | Destroy 3 or more enemy creatures in one attack. | `combat` | `e.side === 'player' && e.pairs.reduce((sum, p) => sum + p.blockersDie.length, 0) >= 3` |  |

### 🪄 Spells & artifacts (16)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 95 | `hot-potato` | 🥔 Hot Potato | rare | Deal 15 damage to the enemy with instants in one match. | `spell:resolved` | `x.m.instantDamage >= 15` |  |
| 96 | `burned-out` | 🧯 Burned Out | rare | Win with damage from an instant. | `match:end` | `won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'instant'` |  |
| 97 | `avalanche` | 🏔️ Avalanche Warning | rare | Your Earthquake or Avalanche destroys 3 or more creatures at once. | `spell:resolved` | `e.side === 'player' && e.card.target === 'all' && e.deaths.length >= 3` |  |
| 98 | `kaboom` | 💣 Kaboom | rare | Your Bomb destroys 2 or more enemy creatures. | `spell:resolved` | `e.side === 'player' && e.card.effect === 'aoe' && e.deaths.filter(d => d.owner === 'enemy').length >= 2` |  |
| 99 | `giant-slayer` | 🪓 Giant Slayer | epic | Destroy an enemy Legendary creature with a spell. | `spell:resolved` | `e.side === 'player' && e.destroyed.some(c => x.rarity(c) === 'legendary')` |  |
| 100 | `chill-out` | 🥶 Chill Out | rare | Deep Freeze an enemy creature that was already tapped. | `spell:resolved` | `e.side === 'player' && e.frozeTapped` |  |
| 101 | `brink` | 🩺 Back from the Brink | epic | Climb from 5 life or less back to 15 or more in one match. | `life:changed` | `e.side === 'player' && x.m.minLife <= 5 && e.after >= 15` |  |
| 102 | `blood-bank` | 🩸 Blood Bank | epic | Win with Drain Life. | `match:end` | `won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'drain'` |  |
| 103 | `second-coming` | 👼 Second Coming | epic | Bring a Legendary creature back from your graveyard. | `spell:resolved` | `e.side === 'player' && !!e.revived && x.rarity(e.revived) === 'legendary'` |  |
| 104 | `token-horde` | 🧟 Token Horde | rare | Control 6 or more tokens at once. | `board` | `(x.game.playerBoard \|\| []).filter(isToken).length >= 6` |  |
| 105 | `pumped` | 💪 Pumped Up | common | Give a creature +3 or more power with one card. | `spell:resolved` | `e.side === 'player' && e.card.effect === 'buff' && e.card.value >= 3 && e.buffed > 0` |  |
| 106 | `road-rage` | 🤬 Road Rage | epic | Win on a turn you cast Anger. | `match:end` | `won(e) && x.m.angerThisTurn` |  |
| 107 | `mind-wipe` | 🌀 Mind Wipe | rare | Make the enemy discard their last card. | `spell:resolved` | `e.side === 'player' && e.discarded > 0 && e.enemyHandAfter === 0` |  |
| 108 | `return-sender` | 📮 Return to Sender | rare | Send an enemy creature that costs 5 or more back to the hand. | `spell:resolved` | `e.side === 'player' && e.bounced.some(c => pool(c.cost) >= 5)` |  |
| 109 | `bookworm` | 📚 Bookworm | rare | Draw 3 or more extra cards in one turn. | `spell:resolved`, `upkeep` | `x.m.extraDrawsThisTurn >= 3` |  |
| 110 | `upkeep-3` | ⏳ Slow and Steady | rare | Control 3 artifacts that act at the start of your turn. | `board` | `(x.game.playerBoard \|\| []).filter(c => c.type === 'artifact' && UPKEEP_EFFECTS.includes(c.effect)).length >= 3` |  |

### 📦 Collection & packs (18)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 111 | `own-175` | 📗 Growing Binder | common | Own 175 different cards. | `collection` | `x.owned ≥ 175` | yes |
| 112 | `own-200` | 📒 Binder Overflow | rare | Own 200 different cards. | `collection` | `x.owned ≥ 200` | yes |
| 113 | `own-250` | 🧩 Almost There | epic | Own 250 different cards. | `collection` | `x.owned ≥ 250` | yes |
| 114 | `own-all` | 🏆 Gotta Emoji 'Em All | legendary | Own every card: all 268. | `collection` | `x.owned ≥ 268` | yes |
| 115 | `own-legendary` | 🏅 Living Legend | rare | Own a Legendary card. | `collection` | `x.ownedBy('legendary') >= 1` | yes |
| 116 | `own-all-legendary` | 🏛️ Hall of Legends | legendary | Own all 9 Legendary cards. | `collection` | `x.ownedBy('legendary') ≥ 9` | yes |
| 117 | `own-all-epic` | 📜 Epic Saga | epic | Own all 14 Epic cards. | `collection` | `x.ownedBy('epic') ≥ 14` | yes |
| 118 | `own-scifi` | 🤓 Sci-Fi Nerd | epic | Own all 56 Science Fiction cards. | `collection` | `x.ownedTheme('Science Fiction') ≥ 56` | yes |
| 119 | `packs-10` | 🐀 Pack Rat | common | Open 10 booster packs. | `pack:opened` | `x.packsOpened ≥ 10` | yes |
| 120 | `packs-50` | ✂️ Shrink-Wrap Shredder | epic | Open 50 booster packs. | `pack:opened` | `x.packsOpened ≥ 50` | yes |
| 121 | `pack-sampler` | 🍱 Sampler Platter | rare | Open one of each of the 6 pack types. | `pack:opened` | `(x.c.packTypes \|\| []).length ≥ 6` |  |
| 122 | `golden-ticket` | 🎫 Golden Ticket | rare | Pull a Legendary card from a pack. | `pack:opened` | `e.cards.some(c => c.rarity === 'legendary')` |  |
| 123 | `fresh-stock` | 🆕 Fresh Stock | common | Open a pack in which all 5 cards are new to you. | `pack:opened` | `e.cards.length === 5 && e.cards.every(c => c.isNew)` |  |
| 124 | `deja-vu` | 🪞 Déjà Vu | common | Open a pack with no new cards in it. | `pack:opened` | `e.cards.length > 0 && e.cards.every(c => !c.isNew)` |  |
| 125 | `jackpot` | 🎰 Jackpot | epic | Pull a Rare and a Legendary from the same pack. | `pack:opened` | `e.cards.some(c => c.rarity === 'rare') && e.cards.some(c => c.rarity === 'legendary')` |  |
| 126 | `savings` | 🏦 Savings Account | rare | Have 500 credits. | `wallet` | `x.credits >= 500` | yes |
| 127 | `big-spender` | 💸 Big Spender | rare | Spend 1,000 credits on packs. | `pack:purchased` | `x.c.creditsSpent \|\| 0 ≥ 1000` |  |
| 128 | `triple-crown` | 👑 Triple Crown | legendary | Own 3 copies of the same Legendary card. | `collection` | `x.maxCopiesOf('legendary') >= 3` | yes |

### 💎 Rare feats (10)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 129 | `library` | 📭 Library Card Revoked | epic | Win because the enemy ran out of cards to draw. | `match:end` | `won(e) && e.reason === 'decked'` |  |
| 130 | `overdrawn` | 🫠 Overdrawn *(hidden)* | rare | Lose because you ran out of cards to draw. | `match:end` | `e.result === 'loss' && e.reason === 'decked'` |  |
| 131 | `overkill` | 🔨 Overkill | rare | Finish the enemy with a single hit that deals 5 or more damage beyond their last life point. | `life:changed` | `e.side === 'enemy' && e.after === 0 && -e.amount - e.before >= 5` |  |
| 132 | `by-a-thread` | 🧵 By a Thread | epic | Win with exactly 1 life. | `match:end` | `won(e) && x.game.playerLife === 1` |  |
| 133 | `healthy` | 💚 Healthier Than Ever | epic | Win with 30 or more life. | `match:end` | `won(e) && x.game.playerLife >= 30` |  |
| 134 | `spellbound` | 📖 Spellbound | epic | Win without summoning a creature. | `match:end` | `won(e) && x.m.creatures === 0` |  |
| 135 | `pacifist` | ☮️ Pacifist | epic | Win without attacking. | `match:end` | `won(e) && x.m.attacks === 0` |  |
| 136 | `lone-wolf` | 🐺 Lone Wolf | rare | Win while you control exactly one creature. | `match:end` | `won(e) && creaturesOf(x.game.playerBoard).length === 1` |  |
| 137 | `scorched-earth` | 🏜️ Scorched Earth | rare | Win while the enemy controls no creatures and you control 5 or more. | `match:end` | `won(e) && creaturesOf(x.game.enemyBoard).length === 0 && creaturesOf(x.game.playerBoard).length >= 5` |  |
| 138 | `shoestring` | 🥾 Shoestring Budget | rare | Win having played 3 lands or fewer. | `match:end` | `won(e) && x.m.lands <= 3` |  |

### 🧩 Combinations (6)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 139 | `spooky-season` | 🎃 Spooky Season | rare | Control Risen Zombie, Restless Ghost and Skeleton Warrior at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-risen-zombie', 'creatures-restless-ghost', 'creatures-skeleton-warrior')` |  |
| 140 | `phoenix-rising` | 🐦‍🔥 Phoenix Rising | epic | Control Phoenix and Phoenix Firebird at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-phoenix', 'creatures-phoenix-firebird')` |  |
| 141 | `shark-week` | 🦈 Shark Week | epic | Control Great Shark and Great White Shark at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-great-shark', 'creatures-great-white-shark')` |  |
| 142 | `fairy-tale` | 🦄 Fairy Tale | epic | Control Sacred Unicorn, Winged Pegasus and Forest Fairy at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-sacred-unicorn', 'creatures-winged-pegasus', 'creatures-forest-fairy')` |  |
| 143 | `big-cat-energy` | 🐈 Big Cat Energy | rare | Control Blazing Tiger, Bengal Tiger and Fire Lion at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-blazing-tiger', 'creatures-bengal-tiger', 'creatures-fire-lion')` |  |
| 144 | `some-assembly` | ⚙️ Some Assembly Required | epic | Control Battle Mech, Combat Robot and Mech Part at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-battle-mech', 'creatures-combat-robot', 'creatures-mech-part')` |  |

### 🎈 Just for fun (6)

| # | ID | Name | Tier | Description (shown in game) | Event | Exact trigger | Backfill |
|---|---|---|---|---|---|---|---|
| 145 | `flash-mob` | 📸 Flash Mob | rare | Control 3 creatures with Flash. Flash still does nothing; they are just very fast at standing still. | `board` | `creaturesOf(x.game.playerBoard).filter(c => has(c, 'flash')).length >= 3` |  |
| 146 | `poop-happens` | 💩 Poop Happens *(hidden)* | common | Play the Poop. With Menace, apparently. | `card:played` | `e.card.__id === 'creatures-poop'` |  |
| 147 | `rage-quit` | 🙃 Rage Quit *(hidden)* | common | Leave a match from the pause menu while 10 or more life behind. | `match:quit` | `x.game.enemyLife - x.game.playerLife >= 10` |  |
| 148 | `card-inspector` | 🔍 Card Inspector | common | Look at card details 50 times. | `card:details` | `x.c.cardDetails \|\| 0 ≥ 50` |  |
| 149 | `decorator` | 🎨 Interior Decorator | common | Try all three visual themes. | `theme` | `(x.c.themes \|\| []).length ≥ 3` |  |
| 150 | `clown-car` | 🤡 Clown Car *(hidden)* | rare | Control Demonic Clown and Dread Clown at once. | `board` | `onBoard(x.game.playerBoard, 'creatures-demonic-clown', 'creatures-dread-clown')` |  |

<!-- catalog:end -->


## Persistence hardening on the Codex stabilization branch

The existing 150-definition implementation was brought in from `c7ef846`, with upstream
fixes `dd66838` and `8c0ca46`; it was not recreated. Profile and achievement writes share
a browser Web Lock for the lifetime of the page. A second tab can inspect and play but
cannot save either store. Close the first tab and reload the second to continue saving.
The guard deliberately fails closed when Web Locks/HTTPS are unavailable. Preferences
outside the profile remain separate keys; changing a particular preference is last-write-wins.

Original achievement bytes are backed up before repair, including readable migrations.
A failed backup leaves the original untouched and disables achievement persistence until
a successful reload. Unknown versions are read-only. Known numeric counters are repaired
to finite nonnegative integers; set counters are deduplicated and filtered. Failed writes
keep session state and show **Retry saving**, which flushes a snapshot without replaying
an unlock, purchase or reward. Page hide/reload flushes batched counters synchronously.

Programmatic card detail rendering, previews, rerenders and fixture setup earn nothing.
The Card Inspector and Decorator definitions still exist: they require intentional card
input or a theme-picker action. Purchases report spending only after their profile commit.
Pack acquisitions have an independent persisted ID, so two packs acquired in the same
millisecond remain distinct; reopening one after a reload cannot repeat its event.

`tests/achievement-hardening.test.mjs` adds below/at-threshold checks, real AI attribution,
render/fixture purity, immediate reload, quota recovery, failed backups, unsupported
versions, two-tab writes and reset semantics. Stats/progress reset keeps earned achievements
and notification preferences, matching the imported feature's behavior.

The profile and achievement store remain two localStorage keys, not a server transaction.
A browser/OS crash between their writes can lose unflushed event-only counters; backfill
recovers only facts provable from the committed profile, never invented play history.
Normal reload is covered by the page-hide flush. Do not close a tab while a save failure
is displayed: blocked/quota-limited storage cannot provide durable progress until retry
succeeds. An older build or external tool that ignores Web Locks can still write; detected
snapshot conflicts are rejected and require reload. No cross-device synchronization exists.
