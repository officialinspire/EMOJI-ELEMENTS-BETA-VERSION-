# Achievements

EMOJI ELEMENTS has 400 achievements in 13 categories. The catalog and the unlock logic are in `achievements.js` (`window.Achievements`). The game reports confirmed outcomes to it from `index.js`. The Achievements screen and the unlock notices are in `index.js` (`renderAchievements`, `queueAchievementNotice`), with styles under "Achievements" in `styles.css`.

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

### 🏁 Wins & losses (22)

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
| 391 | `mastery-career-3` | 🏆 Duelist career 1 | epic | Win 3 matches in total. | `match:end` | `x.wins ≥ 3` | yes |
| 392 | `mastery-career-5` | 🏆 Duelist career 2 | epic | Win 5 matches in total. | `match:end` | `x.wins ≥ 5` | yes |
| 393 | `mastery-career-15` | 🏆 Duelist career 3 | epic | Win 15 matches in total. | `match:end` | `x.wins ≥ 15` | yes |
| 394 | `mastery-career-30` | 🏆 Duelist career 4 | epic | Win 30 matches in total. | `match:end` | `x.wins ≥ 30` | yes |
| 395 | `mastery-career-75` | 🏆 Duelist career 5 | epic | Win 75 matches in total. | `match:end` | `x.wins ≥ 75` | yes |
| 396 | `mastery-career-150` | 🏆 Duelist career 6 | legendary | Win 150 matches in total. | `match:end` | `x.wins ≥ 150` | yes |
| 397 | `mastery-career-300` | 🏆 Duelist career 7 | legendary | Win 300 matches in total. | `match:end` | `x.wins ≥ 300` | yes |
| 398 | `mastery-career-600` | 🏆 Duelist career 8 | legendary | Win 600 matches in total. | `match:end` | `x.wins ≥ 600` | yes |
| 399 | `mastery-career-1200` | 🏆 Duelist career 9 | legendary | Win 1200 matches in total. | `match:end` | `x.wins ≥ 1200` | yes |
| 400 | `mastery-career-2500` | 🏆 Duelist career 10 | legendary | Win 2500 matches in total. | `match:end` | `x.wins ≥ 2500` | yes |

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

### 🃏 Decks (165)

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
| 151 | `mastery-deck-fire-3` | 🔥 Pyromaniac: Mastery 1 | rare | Win 3 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 152 | `mastery-deck-fire-5` | 🔥 Pyromaniac: Mastery 2 | rare | Win 5 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 153 | `mastery-deck-fire-15` | 🔥 Pyromaniac: Mastery 3 | rare | Win 15 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 154 | `mastery-deck-fire-30` | 🔥 Pyromaniac: Mastery 4 | epic | Win 30 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 155 | `mastery-deck-fire-75` | 🔥 Pyromaniac: Mastery 5 | epic | Win 75 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 156 | `mastery-deck-fire-150` | 🔥 Pyromaniac: Mastery 6 | epic | Win 150 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 157 | `mastery-deck-fire-300` | 🔥 Pyromaniac: Mastery 7 | epic | Win 300 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 158 | `mastery-deck-fire-600` | 🔥 Pyromaniac: Mastery 8 | legendary | Win 600 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 159 | `mastery-deck-fire-1200` | 🔥 Pyromaniac: Mastery 9 | legendary | Win 1200 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 160 | `mastery-deck-fire-2500` | 🔥 Pyromaniac: Mastery 10 | legendary | Win 2500 matches with the FIRE deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 161 | `mastery-deck-water-3` | 💧 Making Waves: Mastery 1 | rare | Win 3 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 162 | `mastery-deck-water-5` | 💧 Making Waves: Mastery 2 | rare | Win 5 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 163 | `mastery-deck-water-15` | 💧 Making Waves: Mastery 3 | rare | Win 15 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 164 | `mastery-deck-water-30` | 💧 Making Waves: Mastery 4 | epic | Win 30 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 165 | `mastery-deck-water-75` | 💧 Making Waves: Mastery 5 | epic | Win 75 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 166 | `mastery-deck-water-150` | 💧 Making Waves: Mastery 6 | epic | Win 150 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 167 | `mastery-deck-water-300` | 💧 Making Waves: Mastery 7 | epic | Win 300 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 168 | `mastery-deck-water-600` | 💧 Making Waves: Mastery 8 | legendary | Win 600 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 169 | `mastery-deck-water-1200` | 💧 Making Waves: Mastery 9 | legendary | Win 1200 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 170 | `mastery-deck-water-2500` | 💧 Making Waves: Mastery 10 | legendary | Win 2500 matches with the WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 171 | `mastery-deck-earth-3` | 🌍 Down to Earth: Mastery 1 | rare | Win 3 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 172 | `mastery-deck-earth-5` | 🌍 Down to Earth: Mastery 2 | rare | Win 5 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 173 | `mastery-deck-earth-15` | 🌍 Down to Earth: Mastery 3 | rare | Win 15 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 174 | `mastery-deck-earth-30` | 🌍 Down to Earth: Mastery 4 | epic | Win 30 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 175 | `mastery-deck-earth-75` | 🌍 Down to Earth: Mastery 5 | epic | Win 75 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 176 | `mastery-deck-earth-150` | 🌍 Down to Earth: Mastery 6 | epic | Win 150 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 177 | `mastery-deck-earth-300` | 🌍 Down to Earth: Mastery 7 | epic | Win 300 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 178 | `mastery-deck-earth-600` | 🌍 Down to Earth: Mastery 8 | legendary | Win 600 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 179 | `mastery-deck-earth-1200` | 🌍 Down to Earth: Mastery 9 | legendary | Win 1200 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 180 | `mastery-deck-earth-2500` | 🌍 Down to Earth: Mastery 10 | legendary | Win 2500 matches with the EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 181 | `mastery-deck-swamp-3` | 💀 Swamp Thing: Mastery 1 | rare | Win 3 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 182 | `mastery-deck-swamp-5` | 💀 Swamp Thing: Mastery 2 | rare | Win 5 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 183 | `mastery-deck-swamp-15` | 💀 Swamp Thing: Mastery 3 | rare | Win 15 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 184 | `mastery-deck-swamp-30` | 💀 Swamp Thing: Mastery 4 | epic | Win 30 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 185 | `mastery-deck-swamp-75` | 💀 Swamp Thing: Mastery 5 | epic | Win 75 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 186 | `mastery-deck-swamp-150` | 💀 Swamp Thing: Mastery 6 | epic | Win 150 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 187 | `mastery-deck-swamp-300` | 💀 Swamp Thing: Mastery 7 | epic | Win 300 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 188 | `mastery-deck-swamp-600` | 💀 Swamp Thing: Mastery 8 | legendary | Win 600 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 189 | `mastery-deck-swamp-1200` | 💀 Swamp Thing: Mastery 9 | legendary | Win 1200 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 190 | `mastery-deck-swamp-2500` | 💀 Swamp Thing: Mastery 10 | legendary | Win 2500 matches with the SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 191 | `mastery-deck-light-3` | ☀️ Enlightened: Mastery 1 | rare | Win 3 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 192 | `mastery-deck-light-5` | ☀️ Enlightened: Mastery 2 | rare | Win 5 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 193 | `mastery-deck-light-15` | ☀️ Enlightened: Mastery 3 | rare | Win 15 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 194 | `mastery-deck-light-30` | ☀️ Enlightened: Mastery 4 | epic | Win 30 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 195 | `mastery-deck-light-75` | ☀️ Enlightened: Mastery 5 | epic | Win 75 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 196 | `mastery-deck-light-150` | ☀️ Enlightened: Mastery 6 | epic | Win 150 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 197 | `mastery-deck-light-300` | ☀️ Enlightened: Mastery 7 | epic | Win 300 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 198 | `mastery-deck-light-600` | ☀️ Enlightened: Mastery 8 | legendary | Win 600 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 199 | `mastery-deck-light-1200` | ☀️ Enlightened: Mastery 9 | legendary | Win 1200 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 200 | `mastery-deck-light-2500` | ☀️ Enlightened: Mastery 10 | legendary | Win 2500 matches with the LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 201 | `mastery-deck-fire-water-3` | ♨️ Steam Engine: Mastery 1 | rare | Win 3 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 202 | `mastery-deck-fire-water-5` | ♨️ Steam Engine: Mastery 2 | rare | Win 5 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 203 | `mastery-deck-fire-water-15` | ♨️ Steam Engine: Mastery 3 | rare | Win 15 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 204 | `mastery-deck-fire-water-30` | ♨️ Steam Engine: Mastery 4 | epic | Win 30 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 205 | `mastery-deck-fire-water-75` | ♨️ Steam Engine: Mastery 5 | epic | Win 75 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 206 | `mastery-deck-fire-water-150` | ♨️ Steam Engine: Mastery 6 | epic | Win 150 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 207 | `mastery-deck-fire-water-300` | ♨️ Steam Engine: Mastery 7 | epic | Win 300 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 208 | `mastery-deck-fire-water-600` | ♨️ Steam Engine: Mastery 8 | legendary | Win 600 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 209 | `mastery-deck-fire-water-1200` | ♨️ Steam Engine: Mastery 9 | legendary | Win 1200 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 210 | `mastery-deck-fire-water-2500` | ♨️ Steam Engine: Mastery 10 | legendary | Win 2500 matches with the FIRE + WATER deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 211 | `mastery-deck-fire-earth-3` | 🌋 Magma Flow: Mastery 1 | rare | Win 3 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 212 | `mastery-deck-fire-earth-5` | 🌋 Magma Flow: Mastery 2 | rare | Win 5 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 213 | `mastery-deck-fire-earth-15` | 🌋 Magma Flow: Mastery 3 | rare | Win 15 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 214 | `mastery-deck-fire-earth-30` | 🌋 Magma Flow: Mastery 4 | epic | Win 30 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 215 | `mastery-deck-fire-earth-75` | 🌋 Magma Flow: Mastery 5 | epic | Win 75 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 216 | `mastery-deck-fire-earth-150` | 🌋 Magma Flow: Mastery 6 | epic | Win 150 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 217 | `mastery-deck-fire-earth-300` | 🌋 Magma Flow: Mastery 7 | epic | Win 300 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 218 | `mastery-deck-fire-earth-600` | 🌋 Magma Flow: Mastery 8 | legendary | Win 600 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 219 | `mastery-deck-fire-earth-1200` | 🌋 Magma Flow: Mastery 9 | legendary | Win 1200 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 220 | `mastery-deck-fire-earth-2500` | 🌋 Magma Flow: Mastery 10 | legendary | Win 2500 matches with the FIRE + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 221 | `mastery-deck-fire-swamp-3` | 😈 Hellfire: Mastery 1 | rare | Win 3 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 222 | `mastery-deck-fire-swamp-5` | 😈 Hellfire: Mastery 2 | rare | Win 5 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 223 | `mastery-deck-fire-swamp-15` | 😈 Hellfire: Mastery 3 | rare | Win 15 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 224 | `mastery-deck-fire-swamp-30` | 😈 Hellfire: Mastery 4 | epic | Win 30 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 225 | `mastery-deck-fire-swamp-75` | 😈 Hellfire: Mastery 5 | epic | Win 75 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 226 | `mastery-deck-fire-swamp-150` | 😈 Hellfire: Mastery 6 | epic | Win 150 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 227 | `mastery-deck-fire-swamp-300` | 😈 Hellfire: Mastery 7 | epic | Win 300 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 228 | `mastery-deck-fire-swamp-600` | 😈 Hellfire: Mastery 8 | legendary | Win 600 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 229 | `mastery-deck-fire-swamp-1200` | 😈 Hellfire: Mastery 9 | legendary | Win 1200 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 230 | `mastery-deck-fire-swamp-2500` | 😈 Hellfire: Mastery 10 | legendary | Win 2500 matches with the FIRE + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 231 | `mastery-deck-fire-light-3` | 🌞 Solar Flare: Mastery 1 | rare | Win 3 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 232 | `mastery-deck-fire-light-5` | 🌞 Solar Flare: Mastery 2 | rare | Win 5 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 233 | `mastery-deck-fire-light-15` | 🌞 Solar Flare: Mastery 3 | rare | Win 15 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 234 | `mastery-deck-fire-light-30` | 🌞 Solar Flare: Mastery 4 | epic | Win 30 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 235 | `mastery-deck-fire-light-75` | 🌞 Solar Flare: Mastery 5 | epic | Win 75 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 236 | `mastery-deck-fire-light-150` | 🌞 Solar Flare: Mastery 6 | epic | Win 150 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 237 | `mastery-deck-fire-light-300` | 🌞 Solar Flare: Mastery 7 | epic | Win 300 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 238 | `mastery-deck-fire-light-600` | 🌞 Solar Flare: Mastery 8 | legendary | Win 600 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 239 | `mastery-deck-fire-light-1200` | 🌞 Solar Flare: Mastery 9 | legendary | Win 1200 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 240 | `mastery-deck-fire-light-2500` | 🌞 Solar Flare: Mastery 10 | legendary | Win 2500 matches with the FIRE + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 241 | `mastery-deck-water-earth-3` | 🟫 Mudslide: Mastery 1 | rare | Win 3 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 242 | `mastery-deck-water-earth-5` | 🟫 Mudslide: Mastery 2 | rare | Win 5 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 243 | `mastery-deck-water-earth-15` | 🟫 Mudslide: Mastery 3 | rare | Win 15 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 244 | `mastery-deck-water-earth-30` | 🟫 Mudslide: Mastery 4 | epic | Win 30 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 245 | `mastery-deck-water-earth-75` | 🟫 Mudslide: Mastery 5 | epic | Win 75 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 246 | `mastery-deck-water-earth-150` | 🟫 Mudslide: Mastery 6 | epic | Win 150 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 247 | `mastery-deck-water-earth-300` | 🟫 Mudslide: Mastery 7 | epic | Win 300 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 248 | `mastery-deck-water-earth-600` | 🟫 Mudslide: Mastery 8 | legendary | Win 600 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 249 | `mastery-deck-water-earth-1200` | 🟫 Mudslide: Mastery 9 | legendary | Win 1200 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 250 | `mastery-deck-water-earth-2500` | 🟫 Mudslide: Mastery 10 | legendary | Win 2500 matches with the WATER + EARTH deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 251 | `mastery-deck-water-swamp-3` | 🐸 Bog Standard: Mastery 1 | rare | Win 3 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 252 | `mastery-deck-water-swamp-5` | 🐸 Bog Standard: Mastery 2 | rare | Win 5 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 253 | `mastery-deck-water-swamp-15` | 🐸 Bog Standard: Mastery 3 | rare | Win 15 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 254 | `mastery-deck-water-swamp-30` | 🐸 Bog Standard: Mastery 4 | epic | Win 30 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 255 | `mastery-deck-water-swamp-75` | 🐸 Bog Standard: Mastery 5 | epic | Win 75 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 256 | `mastery-deck-water-swamp-150` | 🐸 Bog Standard: Mastery 6 | epic | Win 150 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 257 | `mastery-deck-water-swamp-300` | 🐸 Bog Standard: Mastery 7 | epic | Win 300 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 258 | `mastery-deck-water-swamp-600` | 🐸 Bog Standard: Mastery 8 | legendary | Win 600 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 259 | `mastery-deck-water-swamp-1200` | 🐸 Bog Standard: Mastery 9 | legendary | Win 1200 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 260 | `mastery-deck-water-swamp-2500` | 🐸 Bog Standard: Mastery 10 | legendary | Win 2500 matches with the WATER + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 261 | `mastery-deck-water-light-3` | 🌦️ Rainbow Maker: Mastery 1 | rare | Win 3 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 262 | `mastery-deck-water-light-5` | 🌦️ Rainbow Maker: Mastery 2 | rare | Win 5 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 263 | `mastery-deck-water-light-15` | 🌦️ Rainbow Maker: Mastery 3 | rare | Win 15 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 264 | `mastery-deck-water-light-30` | 🌦️ Rainbow Maker: Mastery 4 | epic | Win 30 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 265 | `mastery-deck-water-light-75` | 🌦️ Rainbow Maker: Mastery 5 | epic | Win 75 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 266 | `mastery-deck-water-light-150` | 🌦️ Rainbow Maker: Mastery 6 | epic | Win 150 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 267 | `mastery-deck-water-light-300` | 🌦️ Rainbow Maker: Mastery 7 | epic | Win 300 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 268 | `mastery-deck-water-light-600` | 🌦️ Rainbow Maker: Mastery 8 | legendary | Win 600 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 269 | `mastery-deck-water-light-1200` | 🌦️ Rainbow Maker: Mastery 9 | legendary | Win 1200 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 270 | `mastery-deck-water-light-2500` | 🌦️ Rainbow Maker: Mastery 10 | legendary | Win 2500 matches with the WATER + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 271 | `mastery-deck-earth-swamp-3` | 🍂 Compost Heap: Mastery 1 | rare | Win 3 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 272 | `mastery-deck-earth-swamp-5` | 🍂 Compost Heap: Mastery 2 | rare | Win 5 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 273 | `mastery-deck-earth-swamp-15` | 🍂 Compost Heap: Mastery 3 | rare | Win 15 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 274 | `mastery-deck-earth-swamp-30` | 🍂 Compost Heap: Mastery 4 | epic | Win 30 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 275 | `mastery-deck-earth-swamp-75` | 🍂 Compost Heap: Mastery 5 | epic | Win 75 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 276 | `mastery-deck-earth-swamp-150` | 🍂 Compost Heap: Mastery 6 | epic | Win 150 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 277 | `mastery-deck-earth-swamp-300` | 🍂 Compost Heap: Mastery 7 | epic | Win 300 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 278 | `mastery-deck-earth-swamp-600` | 🍂 Compost Heap: Mastery 8 | legendary | Win 600 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 279 | `mastery-deck-earth-swamp-1200` | 🍂 Compost Heap: Mastery 9 | legendary | Win 1200 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 280 | `mastery-deck-earth-swamp-2500` | 🍂 Compost Heap: Mastery 10 | legendary | Win 2500 matches with the EARTH + SWAMP deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 281 | `mastery-deck-earth-light-3` | 🌻 Photosynthesis: Mastery 1 | rare | Win 3 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 282 | `mastery-deck-earth-light-5` | 🌻 Photosynthesis: Mastery 2 | rare | Win 5 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 283 | `mastery-deck-earth-light-15` | 🌻 Photosynthesis: Mastery 3 | rare | Win 15 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 284 | `mastery-deck-earth-light-30` | 🌻 Photosynthesis: Mastery 4 | epic | Win 30 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 285 | `mastery-deck-earth-light-75` | 🌻 Photosynthesis: Mastery 5 | epic | Win 75 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 286 | `mastery-deck-earth-light-150` | 🌻 Photosynthesis: Mastery 6 | epic | Win 150 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 287 | `mastery-deck-earth-light-300` | 🌻 Photosynthesis: Mastery 7 | epic | Win 300 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 288 | `mastery-deck-earth-light-600` | 🌻 Photosynthesis: Mastery 8 | legendary | Win 600 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 289 | `mastery-deck-earth-light-1200` | 🌻 Photosynthesis: Mastery 9 | legendary | Win 1200 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 290 | `mastery-deck-earth-light-2500` | 🌻 Photosynthesis: Mastery 10 | legendary | Win 2500 matches with the EARTH + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |
| 291 | `mastery-deck-swamp-light-3` | 🌗 Twilight: Mastery 1 | rare | Win 3 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 3` |  |
| 292 | `mastery-deck-swamp-light-5` | 🌗 Twilight: Mastery 2 | rare | Win 5 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 5` |  |
| 293 | `mastery-deck-swamp-light-15` | 🌗 Twilight: Mastery 3 | rare | Win 15 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 15` |  |
| 294 | `mastery-deck-swamp-light-30` | 🌗 Twilight: Mastery 4 | epic | Win 30 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 30` |  |
| 295 | `mastery-deck-swamp-light-75` | 🌗 Twilight: Mastery 5 | epic | Win 75 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 75` |  |
| 296 | `mastery-deck-swamp-light-150` | 🌗 Twilight: Mastery 6 | epic | Win 150 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 150` |  |
| 297 | `mastery-deck-swamp-light-300` | 🌗 Twilight: Mastery 7 | epic | Win 300 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 300` |  |
| 298 | `mastery-deck-swamp-light-600` | 🌗 Twilight: Mastery 8 | legendary | Win 600 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 600` |  |
| 299 | `mastery-deck-swamp-light-1200` | 🌗 Twilight: Mastery 9 | legendary | Win 1200 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 1200` |  |
| 300 | `mastery-deck-swamp-light-2500` | 🌗 Twilight: Mastery 10 | legendary | Win 2500 matches with the SWAMP + LIGHT deck. Counted from this update. | `match:end` | `x.c[`played.deck.${key}`] \|\| 0 ≥ 2500` |  |

### 🔥 Elements (60)

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
| 301 | `mastery-element-fire-3` | 🪵 Kindling Collector: Practice 1 | rare | Play 3 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 3` |  |
| 302 | `mastery-element-fire-5` | 🪵 Kindling Collector: Practice 2 | rare | Play 5 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 5` |  |
| 303 | `mastery-element-fire-15` | 🪵 Kindling Collector: Practice 3 | rare | Play 15 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 15` |  |
| 304 | `mastery-element-fire-30` | 🪵 Kindling Collector: Practice 4 | rare | Play 30 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 30` |  |
| 305 | `mastery-element-fire-75` | 🪵 Kindling Collector: Practice 5 | rare | Play 75 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 75` |  |
| 306 | `mastery-element-fire-150` | 🪵 Kindling Collector: Practice 6 | epic | Play 150 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 150` |  |
| 307 | `mastery-element-fire-300` | 🪵 Kindling Collector: Practice 7 | epic | Play 300 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 300` |  |
| 308 | `mastery-element-fire-600` | 🪵 Kindling Collector: Practice 8 | epic | Play 600 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 600` |  |
| 309 | `mastery-element-fire-1200` | 🪵 Kindling Collector: Practice 9 | epic | Play 1200 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 1200` |  |
| 310 | `mastery-element-fire-2500` | 🪵 Kindling Collector: Practice 10 | epic | Play 2500 non-land Fire cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 2500` |  |
| 311 | `mastery-element-water-3` | 🚰 Hydrated: Practice 1 | rare | Play 3 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 3` |  |
| 312 | `mastery-element-water-5` | 🚰 Hydrated: Practice 2 | rare | Play 5 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 5` |  |
| 313 | `mastery-element-water-15` | 🚰 Hydrated: Practice 3 | rare | Play 15 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 15` |  |
| 314 | `mastery-element-water-30` | 🚰 Hydrated: Practice 4 | rare | Play 30 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 30` |  |
| 315 | `mastery-element-water-75` | 🚰 Hydrated: Practice 5 | rare | Play 75 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 75` |  |
| 316 | `mastery-element-water-150` | 🚰 Hydrated: Practice 6 | epic | Play 150 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 150` |  |
| 317 | `mastery-element-water-300` | 🚰 Hydrated: Practice 7 | epic | Play 300 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 300` |  |
| 318 | `mastery-element-water-600` | 🚰 Hydrated: Practice 8 | epic | Play 600 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 600` |  |
| 319 | `mastery-element-water-1200` | 🚰 Hydrated: Practice 9 | epic | Play 1200 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 1200` |  |
| 320 | `mastery-element-water-2500` | 🚰 Hydrated: Practice 10 | epic | Play 2500 non-land Water cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 2500` |  |
| 321 | `mastery-element-earth-3` | 🌳 Rooted: Practice 1 | rare | Play 3 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 3` |  |
| 322 | `mastery-element-earth-5` | 🌳 Rooted: Practice 2 | rare | Play 5 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 5` |  |
| 323 | `mastery-element-earth-15` | 🌳 Rooted: Practice 3 | rare | Play 15 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 15` |  |
| 324 | `mastery-element-earth-30` | 🌳 Rooted: Practice 4 | rare | Play 30 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 30` |  |
| 325 | `mastery-element-earth-75` | 🌳 Rooted: Practice 5 | rare | Play 75 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 75` |  |
| 326 | `mastery-element-earth-150` | 🌳 Rooted: Practice 6 | epic | Play 150 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 150` |  |
| 327 | `mastery-element-earth-300` | 🌳 Rooted: Practice 7 | epic | Play 300 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 300` |  |
| 328 | `mastery-element-earth-600` | 🌳 Rooted: Practice 8 | epic | Play 600 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 600` |  |
| 329 | `mastery-element-earth-1200` | 🌳 Rooted: Practice 9 | epic | Play 1200 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 1200` |  |
| 330 | `mastery-element-earth-2500` | 🌳 Rooted: Practice 10 | epic | Play 2500 non-land Earth cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 2500` |  |
| 331 | `mastery-element-swamp-3` | 🫧 Swamp Gas: Practice 1 | rare | Play 3 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 3` |  |
| 332 | `mastery-element-swamp-5` | 🫧 Swamp Gas: Practice 2 | rare | Play 5 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 5` |  |
| 333 | `mastery-element-swamp-15` | 🫧 Swamp Gas: Practice 3 | rare | Play 15 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 15` |  |
| 334 | `mastery-element-swamp-30` | 🫧 Swamp Gas: Practice 4 | rare | Play 30 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 30` |  |
| 335 | `mastery-element-swamp-75` | 🫧 Swamp Gas: Practice 5 | rare | Play 75 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 75` |  |
| 336 | `mastery-element-swamp-150` | 🫧 Swamp Gas: Practice 6 | epic | Play 150 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 150` |  |
| 337 | `mastery-element-swamp-300` | 🫧 Swamp Gas: Practice 7 | epic | Play 300 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 300` |  |
| 338 | `mastery-element-swamp-600` | 🫧 Swamp Gas: Practice 8 | epic | Play 600 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 600` |  |
| 339 | `mastery-element-swamp-1200` | 🫧 Swamp Gas: Practice 9 | epic | Play 1200 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 1200` |  |
| 340 | `mastery-element-swamp-2500` | 🫧 Swamp Gas: Practice 10 | epic | Play 2500 non-land Swamp cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 2500` |  |
| 341 | `mastery-element-light-3` | 😎 Sunbather: Practice 1 | rare | Play 3 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 3` |  |
| 342 | `mastery-element-light-5` | 😎 Sunbather: Practice 2 | rare | Play 5 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 5` |  |
| 343 | `mastery-element-light-15` | 😎 Sunbather: Practice 3 | rare | Play 15 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 15` |  |
| 344 | `mastery-element-light-30` | 😎 Sunbather: Practice 4 | rare | Play 30 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 30` |  |
| 345 | `mastery-element-light-75` | 😎 Sunbather: Practice 5 | rare | Play 75 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 75` |  |
| 346 | `mastery-element-light-150` | 😎 Sunbather: Practice 6 | epic | Play 150 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 150` |  |
| 347 | `mastery-element-light-300` | 😎 Sunbather: Practice 7 | epic | Play 300 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 300` |  |
| 348 | `mastery-element-light-600` | 😎 Sunbather: Practice 8 | epic | Play 600 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 600` |  |
| 349 | `mastery-element-light-1200` | 😎 Sunbather: Practice 9 | epic | Play 1200 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 1200` |  |
| 350 | `mastery-element-light-2500` | 😎 Sunbather: Practice 10 | epic | Play 2500 non-land Light cards. | `card:played` | `x.c[`plays.${key}`] \|\| 0 ≥ 2500` |  |

### 🗂️ Card types (48)

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
| 351 | `mastery-type-creature-3` | 🃏 Creature specialist 1 | rare | Play 3 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 3` |  |
| 352 | `mastery-type-creature-5` | 🃏 Creature specialist 2 | rare | Play 5 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 5` |  |
| 353 | `mastery-type-creature-15` | 🃏 Creature specialist 3 | rare | Play 15 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 15` |  |
| 354 | `mastery-type-creature-30` | 🃏 Creature specialist 4 | rare | Play 30 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 30` |  |
| 355 | `mastery-type-creature-75` | 🃏 Creature specialist 5 | rare | Play 75 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 75` |  |
| 356 | `mastery-type-creature-150` | 🃏 Creature specialist 6 | epic | Play 150 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 150` |  |
| 357 | `mastery-type-creature-300` | 🃏 Creature specialist 7 | epic | Play 300 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 300` |  |
| 358 | `mastery-type-creature-600` | 🃏 Creature specialist 8 | epic | Play 600 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 600` |  |
| 359 | `mastery-type-creature-1200` | 🃏 Creature specialist 9 | epic | Play 1200 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 1200` |  |
| 360 | `mastery-type-creature-2500` | 🃏 Creature specialist 10 | epic | Play 2500 creature cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 2500` |  |
| 361 | `mastery-type-instant-3` | 🃏 Instant specialist 1 | rare | Play 3 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 3` |  |
| 362 | `mastery-type-instant-5` | 🃏 Instant specialist 2 | rare | Play 5 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 5` |  |
| 363 | `mastery-type-instant-15` | 🃏 Instant specialist 3 | rare | Play 15 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 15` |  |
| 364 | `mastery-type-instant-30` | 🃏 Instant specialist 4 | rare | Play 30 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 30` |  |
| 365 | `mastery-type-instant-75` | 🃏 Instant specialist 5 | rare | Play 75 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 75` |  |
| 366 | `mastery-type-instant-150` | 🃏 Instant specialist 6 | epic | Play 150 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 150` |  |
| 367 | `mastery-type-instant-300` | 🃏 Instant specialist 7 | epic | Play 300 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 300` |  |
| 368 | `mastery-type-instant-600` | 🃏 Instant specialist 8 | epic | Play 600 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 600` |  |
| 369 | `mastery-type-instant-1200` | 🃏 Instant specialist 9 | epic | Play 1200 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 1200` |  |
| 370 | `mastery-type-instant-2500` | 🃏 Instant specialist 10 | epic | Play 2500 instant cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 2500` |  |
| 371 | `mastery-type-artifact-3` | 🃏 Artifact specialist 1 | rare | Play 3 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 3` |  |
| 372 | `mastery-type-artifact-5` | 🃏 Artifact specialist 2 | rare | Play 5 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 5` |  |
| 373 | `mastery-type-artifact-15` | 🃏 Artifact specialist 3 | rare | Play 15 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 15` |  |
| 374 | `mastery-type-artifact-30` | 🃏 Artifact specialist 4 | rare | Play 30 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 30` |  |
| 375 | `mastery-type-artifact-75` | 🃏 Artifact specialist 5 | rare | Play 75 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 75` |  |
| 376 | `mastery-type-artifact-150` | 🃏 Artifact specialist 6 | epic | Play 150 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 150` |  |
| 377 | `mastery-type-artifact-300` | 🃏 Artifact specialist 7 | epic | Play 300 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 300` |  |
| 378 | `mastery-type-artifact-600` | 🃏 Artifact specialist 8 | epic | Play 600 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 600` |  |
| 379 | `mastery-type-artifact-1200` | 🃏 Artifact specialist 9 | epic | Play 1200 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 1200` |  |
| 380 | `mastery-type-artifact-2500` | 🃏 Artifact specialist 10 | epic | Play 2500 artifact cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 2500` |  |
| 381 | `mastery-type-land-3` | 🃏 Land specialist 1 | rare | Play 3 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 3` |  |
| 382 | `mastery-type-land-5` | 🃏 Land specialist 2 | rare | Play 5 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 5` |  |
| 383 | `mastery-type-land-15` | 🃏 Land specialist 3 | rare | Play 15 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 15` |  |
| 384 | `mastery-type-land-30` | 🃏 Land specialist 4 | rare | Play 30 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 30` |  |
| 385 | `mastery-type-land-75` | 🃏 Land specialist 5 | rare | Play 75 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 75` |  |
| 386 | `mastery-type-land-150` | 🃏 Land specialist 6 | epic | Play 150 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 150` |  |
| 387 | `mastery-type-land-300` | 🃏 Land specialist 7 | epic | Play 300 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 300` |  |
| 388 | `mastery-type-land-600` | 🃏 Land specialist 8 | epic | Play 600 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 600` |  |
| 389 | `mastery-type-land-1200` | 🃏 Land specialist 9 | epic | Play 1200 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 1200` |  |
| 390 | `mastery-type-land-2500` | 🃏 Land specialist 10 | epic | Play 2500 land cards. | `card:played` | `x.c[`played.${type}`] \|\| 0 ≥ 2500` |  |

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
| 121 | `pack-sampler` | 🍱 Sampler Platter | rare | Open each of the 6 original pack types. | `pack:opened` | `(x.c.packTypes \|\| []).filter(key => ['fantasy','scifi','tech','alien','robot','lands'].includes(key)).length ≥ 6` |  |
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
