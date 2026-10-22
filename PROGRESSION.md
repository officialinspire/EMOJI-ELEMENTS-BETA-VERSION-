# EMOJI ELEMENTS: Progression and Saved Data

The authoritative rules for collection, decks, credits, packs, rewards and saved data in the live game
(`index.js`). They are checked by `tests/progression.test.mjs` (`npm run progression`), using real saves
from the previous build (`tests/fixtures/saves/`). Turn and combat rules are in [RULES.md](RULES.md).

## 1. Starting out

- **P1.1** A new profile starts with **100 credits**, 0 wins / 0 losses / 0 packs opened, and the
  **starter collection**: the cards of the five mono starter decks. That is 153 different cards, 300 copies,
  and no legendaries.
- **P1.2** There are **15 standard decks**: five mono (`FIRE`, `WATER`, `EARTH`, `SWAMP`, `LIGHT`) and all ten
  two-colour pairs (`FIRE_WATER` … `SWAMP_LIGHT`). Each starter list is **60 cards**:

  | Deck | Basic lands | Non-lands |
  |---|---|---|
  | Mono | 20 of its colour | 40 (21 creatures, 9 instants, 10 artifacts) |
  | Dual | 11 + 11 | 38 (20 creatures, 9 instants, 9 artifacts) |

  - Starter lists are built from the cheapest legal cards, and **only from cards the starter collection
    owns**, so every starter deck is legal on a fresh profile.
  - **Changed:** FIRE_SWAMP used to include Web Trap, which no one owns. It became an illegal 59-card deck
    after the first reload.

### Why 60 cards and a 2-copy limit don't conflict

The README listed a 2-copy limit next to 60-card decks with 20–22 copies of a single land. That only works
because **basic lands are not limited by copy count**; they are limited by the land caps below. The other
38–40 cards use at most 2 copies each (1 for a legendary). The tests check this for all 15 starters.

## 2. Deck rules (Deck Builder and saving)

- **P2.1 Size:** exactly **60 cards**. If a save has lost its starter list, the size is still 60.
  **Changed:** it used to drop to 30.
- **P2.2 Colour identity:**
  - **Non-land cards:** every colour in the cost must be one of the deck's colours. Colourless costs are
    always allowed. So a two-colour card (e.g. Web Trap: Fire + Swamp) only fits that exact dual deck.
  - **Lands:** a land is legal if it produces at least one of the deck's colours. Rainbow fits every deck;
    Distant Planet fits Light or Swamp decks. Crystal Wasteland (colourless) fits no deck yet (card audit,
    decision H).
- **P2.3 Copies:**
  - A non-land card: at most **2** copies, or **1** if legendary.
  - Basic lands: any number, within the land caps.
  - Special lands (Rainbow, Distant Planet): 2.
  - You also can't use more copies than you **own**. Owned copies are shared by all your decks: owning 2
    Fire Fox lets every deck use 2.
- **P2.4 Land caps:**
  - Mono: at most 20 lands.
  - Dual: at most 11 lands of each colour, 22 in total.
  - A land that makes both colours (Rainbow) counts toward whichever colour has fewer.
- **P2.5** A deck can only be saved when it passes every rule above. When it doesn't, nothing is saved, and
  your collection and other decks are untouched.
  - The Deck Builder lists what stops the working deck from saving, each with a fix where one is clear
    ("Too many lands: 21 (at most 20). Remove 1 land").
  - `getDeckIssues` builds that list, but `validateDeckBuild` still decides. A deck it accepts shows no
    issues, and every error it reports is listed.
  - An Add button that can't add says why: not owned, all owned copies already in the deck, copy limit, or
    deck full. These are the same limits the save checks.
  - Leaving the Deck Builder or switching decks with unsaved edits asks first. Filters never change the
    working deck.
- **P2.6 Which deck is played:** starting a match with Fire + Water plays the saved `FIRE_WATER` deck, exactly
  as saved, and remembers it as the selected deck. The Deck Builder opens on the selected deck.

## 3. Credits, packs and the Binder

- **P3.1 Prices:** Fantasy, Science Fiction, Tech, Alien and Robot packs cost 60 credits; Lands packs cost 40.
  - With too few credits, nothing changes: no charge, no cards, no pack screen.
- **P3.2 What's in a pack:** 5 **different** cards from that pack's pool.
  - **Changed:** pools come from the reviewed per-card list `PACK_MEMBERSHIP`
    ([CARD_AUDIT.md](CARD_AUDIT.md) §7), so Alien and Robot packs hold aliens and robots. The Lands pack holds
    the 8 lands only; Badlands Boar and the ×3 land weighting are gone. Prices, pack size and slots are
    unchanged.
  - Slots 1–3 draw commons, slot 4 a rare, and slot 5 an epic or legendary.
  - A rarity a pack has fewer than 2 cards of is merged with the next one down for that slot. Today that is only
    the Robot pack's single Epic, so its card 5 is Epic or Rare.
  - A pool smaller than a pack would be completed from the whole catalog (none is).
  - The shop's "What's inside" shows every card a pack can contain and the exact chance of each.
  - Win packs use a random theme, weighted Fantasy 24, Science Fiction 18, and Tech, Alien, Robot and Lands
    14 each.
- **P3.3 Duplicates:** pulled cards add to your owned count, so duplicates stack.
  - The reveal marks a card NEW only if you owned none **before** that pack. It also shows how many you have now.
  - That before-count is kept in memory, not saved. After a reload it is worked out from the current count, as a
    pack never holds a card twice.
  - A second tap or Enter while a pack is open buys nothing (`purchasePack` returns `pack_open`).
- **P3.4 Packs opened:** **Changed:** shop packs now also count toward "packs opened". It used to count only
  win packs.
- **P3.5 Binder (Collection):**
  - Lists the whole catalog. Owned cards show their count (`x3`); the rest are marked "Not owned" (`x0`).
  - "Owned" and "Not owned" views, search, and filters for element, type, mana value and rarity.
  - Sorting by name, mana value, rarity, type or copies owned.
  - Summary line: "N of 268 unique cards • M total cards", counted from the saved collection.
  - **Changed:** it used to list owned cards only.
  - Browsing never writes to the save (`npm run collection`).
- **P3.6 Pack screen:** titled "Victory Pack" for match rewards and "<Theme> Pack" for shop purchases.
  **Changed:** every pack used to be titled "Victory Pack", and QA debug text was shown to players.

## 4. Match rewards

- **P4.1 Win:** +25 credits, and **one booster pack every time**: its cards are added to your collection
  straight away, then revealed via OPEN BOOSTER. Also +1 win and +1 pack opened.
  **Changed:** the OPEN BOOSTER button could not be clicked or tapped (QA D1). The cards were already in your
  collection, but the screen was stuck.
- **P4.2 Loss:** +10 credits and +1 loss. **Changed:** the defeat screen now shows the +10 credits.
- **P4.3** Rewards are recorded once per match, and saved immediately.

## 5. Resets

- **P5.1 RESET STATS** sets wins and losses to 0. The collection, decks, credits and packs-opened count are
  kept.
- **P5.2 RESET PROGRESS** replaces the whole profile with a new one (100 credits, starter collection,
  starter decks, 0 stats), after you confirm.
  - The old profile is kept in the backup list (§7), so it can be restored by hand.
  - **Changed:** the stats screen used to keep showing the old numbers, and the next match wrote the old
    win/loss totals back.

## 6. Saved data (`localStorage`)

| Key | Contents |
|---|---|
| `emoji_elements_meta_v1` | The profile (schema version 1): `{version: 1, initialized, collection: {cardId: count}, decks: {KEY: {deckKey, colors, starterCardIds, cardIds}}, selectedDeckKey, stats: {wins, losses, packsOpened}, wallet: {credits}, lastPack: {themeKey, cardIds, openedAt} or null}` |
| `emoji_elements_meta_backups` | **New:** up to 3 earlier versions of the profile, oldest first: `[{savedAt, reason, raw}]`. `raw` is the exact text that was stored before the game rewrote it. |
| `emojiElementsStats` | `{wins, losses, total}`. A copy of the stats, kept for the legacy single-file build. It is read only once, when no profile exists yet (P7.4). |
| `emojiElementsMuted` | `"true"` / `"false"` |
| `emojiElementsProgress` | Written only by the legacy `emoji-elements.html` (`{coins, boosterPacks}`). The live game ignores it (see §8). |

If the browser refuses to save (storage full or blocked), the game keeps playing and shows
"⚠️ Progress could not be saved". **Changed:** this used to be silent.

## 7. Loading, repair and migration plan

The schema stays at **version 1**: no field is added to or removed from the profile. What changed is how a
loaded profile is checked and repaired. These are the rules, in the order they are applied on every load:

1. **No profile:** a new one is created (P1.1). If `emojiElementsStats` from the legacy build exists, its
   wins and losses are carried over (P7.4). **Changed:** they used to be discarded.
2. **Unreadable profile (corrupt JSON):** its exact text is added to the backups with reason `corrupt`, then
   a new profile is created. **Changed:** it used to be overwritten with no copy kept.
3. **Any readable profile** (version 1, a missing `version`, or an unknown version) is **repaired, never
   replaced**:
   - **Kept:** every card id that exists in the catalog, with its count; every deck (trimmed to cards you
     own, within the copy limits); credits; stats; the selected deck; the last pack.
   - **Dropped:** card ids that no longer exist in the catalog (they are still in the backup).
   - **Coerced:** numbers stored as text ("250") are read as numbers.
   - **Added:** missing standard decks, built only from cards you own. No cards are ever granted to an
     existing profile.
   - **Starter lists:** the starter list of each standard deck (the RESET TO STARTER target) is refreshed
     from the current card catalog.
   - **Untouched decks:** a deck that is still exactly its old starter list (after trimming to owned cards)
     is updated to the new starter list. Decks you edited are never changed.
   - **Changed:** a profile with a missing or different `version` used to be thrown away and replaced by a
     new one, losing the whole collection and all credits.
4. **Backup before rewriting:** if the repaired profile differs from what was stored, the stored text is
   first added to the backups. The reason is `repair`, or `unsupported-version` for a newer version.
   Loading an already-clean profile writes nothing.
5. Backups keep the 3 most recent entries. To restore one by hand, copy its `raw` text back into
   `emoji_elements_meta_v1` in the browser's storage panel, then reload.

**P7.4 Legacy stats:** stats from `emojiElementsStats` are imported only when no profile exists and the game
isn't in the middle of RESET PROGRESS.

**Future schema changes:** bump `version`, add a `migrate(fromVersion)` step before repair, and keep the
backup step. An unknown *newer* version is still salvaged rather than replaced, with the original kept in the
backups.

## 8. Unresolved economy and balance choices

| Topic | Current rule | Why it's open |
|---|---|---|
| Win reward | Every win: +25 credits **and** a pack worth 60 credits. A loss gives +10. | README used to say 15% pack chance (`WIN_FREE_PACK_CHANCE` is unused). Winning is worth ~85 credits vs 10 for losing. |
| Pack quality | Every pack guarantees 1 rare and 1 epic-or-legendary (slots 4–5); the Robot pack's last slot is Epic or Rare | Strong for the price. The small themed pools make their best cards common: Phantom Train is in half of all Tech packs, Battle Mech in a third of Robot packs ([CARD_AUDIT.md](CARD_AUDIT.md) §7). |
| ~~Theme pools~~ | ✅ Resolved in the pack pass: explicit, reviewed membership ([CARD_AUDIT.md](CARD_AUDIT.md) §7) | The odds changes are documented there. |
| Starter collection | No legendaries; Lands pack at 40 credits is the only way to get Rainbow or Distant Planet | Intended? |
| Owned copies shared across decks | Owning 1 copy lets every deck use it | The alternative (copies locked per deck) would need new UI. |
| Legacy coins | `emojiElementsProgress` coins and booster packs from the legacy single-file build are not converted to credits | Different economy; converting would grant credits. |
| Duplicate protection | None: packs can pull cards you already own many copies of | README roadmap mentions duplicate-protection tuning. |


## Codex persistence hardening

`npm run persistence` exercises original-byte backups, malformed/missing fields, blocked
reads, quota failures, repeated confirmation, reward and pack reloads, preferences and
same-profile tabs. Profile mutations require the browser's exclusive Web Lock. Other tabs
are explicitly read-only for progression until the writer closes and they reload. A stored
snapshot changed by an external writer is rejected. Failed purchases spend nothing and
open no pack. Backup failure prevents destructive repair/reset. Failed reward saves keep
the awarded session snapshot; **Retry saving** persists it without awarding it again.
Legacy stats are a best-effort mirror of the authoritative meta save, not a second payout.

The existing achievement feature is now integrated; see [ACHIEVEMENTS.md](ACHIEVEMENTS.md)
for its separate versioned store, precise definitions, QA isolation and crash-window limits.
Stats/progress reset retains preferences and earned achievements. Gameplay rules, prices,
win/loss credits and starter collection sizes are unchanged.

Focused verification:

```sh
node --test --test-concurrency=2 tests/progression.test.mjs tests/packs.test.mjs tests/persistence.test.mjs tests/achievements.test.mjs tests/achievement-hardening.test.mjs
node tests/achievements-doc.mjs
```

`npm run verify -- --group=logic` includes these and every other root browser test suite
in CI. Physical browser storage eviction, OS kill/power loss, older non-cooperating builds
and cross-device synchronization are outside the local-storage guarantee. The original
raw saves are kept in browser backup keys before repair; backups still need available quota.

QA mode now uses `emoji_elements_meta_qa_v1`, `emojiElementsStatsQA` and a separate backup key.
It cannot write or backfill artificial payouts into the normal profile on a later reload.
The smoke harness exercises its QA profile explicitly; production-profile persistence is
covered by the progression, persistence and achievement suites.
