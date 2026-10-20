# EMOJI ELEMENTS: AI Audit

How the AI opponent plays at each difficulty, whether it follows the same rules as you, how it was tested, what
changed, and what the numbers say. The rules themselves are in [RULES.md](RULES.md) and
[EFFECTS.md](EFFECTS.md).

## 1. How it is tested

```bash
node --test tests/ai.test.mjs              # 33 tests, ~2.5 min (npm run ai; also run in CI)
node tests/ai-sim.mjs                      # measured sample: 15 decks × 3 difficulties × 6 seeds (npm run ai:sim)
node tests/ai-sim.mjs --seeds=8 --label=x  # the sample used below: 360 matches, ~6 min
```

### The simulation

`tests/lib/ai-sim.mjs` plays complete matches in Chromium:
- **Starter decks:** every one of the 15. Your side always uses its saved starter deck.
- **Difficulties:** easy, medium and hard.
- **Seeds:** each match has a fixed seed, so any single match can be re-run on its own.
- **Determinism:** `Math.random` is seeded and Playwright's fake clock drives all timers, so a seed always
  replays the same match.

**Your side** is a fixed **reference bot**. It plays only through the real player actions (`playCard`,
`tapLand`, `activateArtifact`, ATTACK → select → CONFIRM, `endTurn`). Each turn it:
- plays a land;
- casts the most expensive useful card it can afford;
- attacks when the automatic block can't kill its creature, or the trade is even or better;
- goes all-in when the attack is lethal.

**Monitors** wrap the AI's decision points and record anything the player isn't allowed to do:
- **Lands:** more than one land a turn.
- **Paying:** playing a card it can't pay for, or ending up with negative mana.
- **Timing:** playing a card outside its turn, after the match ended, or from outside its hand.
- **Attacks:** a tapped, summoning-sick or Defender attacker; an attacker that isn't its own; attacking twice in
  one turn.
- **Blocks:** an illegal block on either side: a flyer blocked without Flying/Reach, Menace blocked by one,
  Unblockable blocked, a blocker used twice.
- **Stalls and loops:**
  - an AI turn that doesn't hand back control within 15 s of game time (the game's own failsafe is at
    12 s);
  - a player turn that can't make progress;
  - a turn or action cap being hit (which catches loops);
  - any page error or failsafe warning.

**Decision measures** are also recorded:
- missed land drops;
- how much of the mana it makes it spends;
- turns ending with an affordable card still in hand;
- casts that do nothing;
- attack rate, and attackers lost per attack;
- missed lethal attacks, and lethal burn left in hand;
- match length, and how each match ended.

### The test suite

`tests/ai.test.mjs` contains:
- targeted scenarios, run at every difficulty where it matters (§2, §3);
- a CI-sized simulation: all 15 starter decks × 3 difficulties, one seed each, asserting no violation, error or
  stall.

The same file run against the previous AI: 23 of the 33 tests pass, including all 15 simulation runs and the
rule-parity scenarios. The 10 that fail are the new behaviours in §3 and §5.

## 2. Does the AI follow the player's rules?

**Yes, with one exception, now fixed.** In 360 seeded matches before the changes and 360 after, the
monitors found no illegal land, mana, timing, tapping, attack or block, no crash, no stall and no loop. Every
match ended by life or deck-out, not by a cap.

| Rule | AI behaviour | Evidence |
|---|---|---|
| One land per turn | ✅ Same as you | Monitor (0 / 720 matches); scenario at each difficulty |
| Mana: pays from its own untapped lands and mana artifacts; unspent mana is lost | ✅ | Monitor; scenario "only casts what its lands can pay for" |
| Timing: acts only on its turn, never after the match ends | ✅ | Monitor; scenario "no AI action after the match ends during its turn" |
| Tapping and untapping: untaps at its turn start; Deep Freeze holds | ✅ | Scenario "frozen, defenders, or new this turn do not attack" |
| Attack eligibility (`canAttack`, shared with you) | ✅ | Monitor; scenario; RULES.md C1 |
| Blocking: automatic for both sides, same function | ✅ | Monitor on both directions |
| Targeting and card effects: the same `resolveSpell`, `castInstant` and `resolveArtifactOnPlay` | ✅ | EFFECTS.md table (every card cast by both sides) |
| **Deck building: copy limits** | ❌ → ✅ | See below |

**Fixed:** AI decks used to break the deck-building limits.
- `generateDeck` picked cards *with replacement*, so **315 of 360** sampled AI decks had more than 2 copies of a
  card, or more than 1 of a legendary. That is something no player deck can have.
- AI decks now follow the same limits (2 copies, 1 legendary). Average legendaries per AI deck went from 1.14 to
  0.98.
- Tested by the scenario "generated AI decks follow the deck-building copy limits", which builds 90 decks.

Not hidden advantages, and kept as documented:
- The AI never mulligans.
- It draws on its first turn, while you go first and skip that draw (RULES.md R1.2).
- Its deck is generated from its colours rather than chosen from a collection.

## 3. Difficulty levels

Every level plays by exactly the same rules, and with decks built under the same limits. They differ only in how
carefully they choose (`AI_PROFILES` in `index.js`):

| | Easy | Medium | Hard |
|---|---|---|---|
| Cards played per turn | 1 | 2 | as many as its mana allows |
| Casts instants | never | yes | yes |
| Sees lethal (burn or an all-in attack) | no | yes | yes |
| Attacks | about 70% of its ready creatures, at random | only attacks that don't lose a creature for nothing; all-in when lethal | like medium, and keeps blockers home when your board could kill it next turn |
| Land drop and mana colours | smart (all levels) | smart | smart |
| Skips cards that would do nothing | yes (all levels) | yes | yes |

**Changed:**
- **Before:** medium differed from easy only in attacking with "the top 60%" of its creatures.
  - Neither medium nor easy cast instants.
  - Hard attacked with every creature, every turn.
  - All three tapped multi-colour lands for their first colour, played the first land in hand, and could cast
    buffs with no creature, removal with no target, or draws that decked them out.
- **Decisions, all levels:**
  - **Land drop:** the land that lets the most cards be cast this turn, then the colour the hand needs most.
  - **Multi-colour lands:** tapped for the colour that lets the most cards be cast.
  - **No wasted cards:** it never casts something that would do nothing:
    - a buff with no creature;
    - destroy, tap or bounce with no legal (non-Hexproof) target;
    - revive with no creature in its graveyard;
    - discard against an empty hand;
    - a draw that would empty its deck;
    - two-sided sweepers only when they kill more of yours (from the effects pass).
- **Decisions, medium and hard:**
  - **Lethal burn first.**
  - **Lethal attacks:** all-in when the damage that gets through the automatic blocks is lethal.
  - **Attack order:** blocks go toughest-blocker-first to attackers in the order they are declared (the same for
    your attacks), so the AI orders its attackers to let the most damage through.
  - **Careful attacks:** each attacker is checked against the exact block it will meet (first strike, double
    strike, deathtouch, damage already marked). It stays home if it would die without taking something worth as
    much.
- **Hard only:**
  - **Keeps blockers home:** if the power of your creatures could kill it next turn, it keeps back enough
    blockers.

## 4. Results (360-match sample, same seeds and harness before and after)

AI win rate against the reference bot; 120 matches per difficulty, 24 per starter deck. At these sizes the
uncertainty is roughly ±9 points per difficulty and ±20 points per deck, so treat deck-level differences as
indications only.

| Difficulty | AI win rate (before → after) | Median match length, your turns (before → after) | Missed lethal attacks | Lethal burn held | Casts that did nothing | Share of its mana spent |
|---|---|---|---|---|---|---|
| Easy | 45.8% → **50.0%** | 10 → 10 | 30 → 33 | 3 → 11 | 50 → **0** | 0.32 → 0.32 |
| Medium | 45.0% → **61.7%** | 8 → 8 | 23 → **0** | 19 → **0** | 39 → **0** | 0.36 → 0.51 |
| Hard | 57.5% → **70.0%** | 8 → 8 | 6 → **0** | 0 → 0 | 86 → **0** | 0.53 → 0.55 |
| All | 49.4% → 60.6% | 9 → 8 (p90: 14 → 14) | | | | |

- The difficulties were 46 / 45 / 58%, with easy and medium indistinguishable. They are now a clear ladder:
  50 / 62 / 70%.
- Easy's misses are by design: it attacks at random and never casts instants.
- Attackers lost per attack went from 0.09 to 0.05 (medium) and from 0.08 to 0.04 (hard).
- Errors, stalled turns, cap hits and deck-outs were 0 before and after.

### By starter deck (AI win rate, all difficulties, after)

| Deck | AI win | Deck | AI win | Deck | AI win |
|---|---|---|---|---|---|
| FIRE | 33% | FIRE_WATER | 67% | WATER_SWAMP | 67% |
| WATER | 67% | FIRE_EARTH | 63% | WATER_LIGHT | 63% |
| EARTH | 50% | FIRE_SWAMP | 58% | EARTH_SWAMP | 67% |
| SWAMP | 46% | FIRE_LIGHT | 54% | EARTH_LIGHT | 67% |
| LIGHT | 63% | WATER_EARTH | 71% | SWAMP_LIGHT | 75% |

The FIRE starter is the strongest for the player in both samples (AI win 17% before, 33% after). It is fast:
cheap creatures plus Fireball, and matches end in ~7 turns. SWAMP_LIGHT and WATER_EARTH are the weakest. I left
starter decks unchanged (see §6).

### Stall conditions

- **No turn ever stalled.** The AI's own 12 s failsafe never fired.
- **Turns with no land, no play and no attack:** 3.9% before, 4.6% after.
- **Turns with nothing affordable to play** (mana or colour screw): 14.6% before, 14.2% after.
- **Turns where easy held only instants it never casts:** 35% of its turns. That is its design: easy plays
  creatures and artifacts only. For medium, this went from 36% to 4%.
- **Quiet stretches** (3+ AI turns in a row without attacking or dealing damage) happen in most matches.
  They come from the opening turns and from walled boards (defenders, big blockers). The longest was 10–12
  turns. All of these matches still ended by life.

## 5. Pacing change

- **Measured:** every AI turn took exactly **7.0 s** of fixed waits (plus 1.5 s after END TURN). That held even
  though 48% of AI turns have no attack and about 4% do nothing at all.
- **Change:** a step that did nothing now waits 0.3 s instead of 1.5 s:
  - no land to play;
  - no mana to tap (tapping waits 1.0 s);
  - no card played;
  - no attack (0.5 s before your turn starts).
- **Result:** the average AI turn is **5.4 s** (was 7.05 s). An idle turn takes ~3.9 s including the END TURN
  pause (was 8.5 s). The busiest turns are unchanged at ~8 s.
- **Tested** by "AI turn pacing" in `tests/ai.test.mjs`.

## 6. Not changed (choices for you)

| Topic | Now | Why it's open |
|---|---|---|
| Starter deck balance | FIRE beats the AI far more often than the other starters (§4) | Changing starters changes saved decks and progression (PROGRESSION.md §7); the sample per deck is small. Re-run `npm run ai:sim -- --seeds=20 --deck=FIRE` before deciding. |
| Hard strength | 70% against the reference bot | Fair (same rules) but strong. It could play fewer cards a turn, or skip the "keep blockers" rule. |
| Easy and instants | Easy never casts instants, so they pile up in its hand | Clear for players ("easy only plays creatures and artifacts"), but its hand clogs. It could cast instants only when they are lethal. |
| Choosing blockers | Automatic for both sides (RULES.md R5.4) | Smarter AI blocking would need a rules change for both sides. |
| Spell targets | Random legal targets for both sides (EFFECTS.md E2) | The AI can't aim removal at your best creature; neither can you. |
| AI mulligan | Never | The player has one free mulligan; the AI could get the same rule. |

## 7. Code

- **`index.js`:**
  - `AI_PROFILES` and `getAiProfile`;
  - choices: `aiWantsToCast` (usefulness), `aiChooseLand`, `aiTapManaSources`, `scoreAiPlay`,
    `aiChooseNextPlay`;
  - attacks: `aiBlockOutcome`, `aiAttackDamage`, `aiBestAttackOrder`, `chooseEnemyAttackers`;
  - `generateDeck` (copy limits);
  - the step waits in `aiTurn`.
- **Tests:**
  - `tests/lib/ai-sim.mjs`: the bot, monitors and summaries;
  - `tests/ai-sim.mjs`: the sample CLI;
  - `tests/ai.test.mjs`: the scenarios and the CI simulation;
  - `tests/combat.test.mjs`: its AI-attacks table now declares every attacker explicitly, because it tests
    combat resolution, not AI judgement.
