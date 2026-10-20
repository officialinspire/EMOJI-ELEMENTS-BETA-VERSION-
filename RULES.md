# EMOJI ELEMENTS: Turn and Resource Rules

These are the authoritative turn, mana and match-end rules for the live game (`index.js`). Each rule is
checked by `tests/rules.test.mjs` (`npm run rules`). Rules marked **house rule** are deliberate choices
that differ from, or aren't covered by, the trading-card games this one is modelled on. Rules marked
**changed** were defined in the rules-hardening pass; the old behaviour is noted with each.

## 1. Setup

- **R1.1** Each player starts at 20 life with a 60-card deck and draws a 7-card opening hand.
  - The player's deck is the saved deck for the chosen colour(s), e.g. `FIRE` or `FIRE_WATER`.
  - The AI's deck is generated from one or two of the five colours: Fire, Water, Earth, Swamp or Light.
    **Changed:** before this pass, "colorless" could be picked as an AI colour, which filled about 1 in 4 AI
    decks with 11–20 blank placeholder cards.
- **R1.2** The player always takes the first turn and **skips the draw on that first turn**. The AI draws on
  every one of its turns, including its first.

## 2. Mulligan

- **R2.1** **Changed (house rule):** you may mulligan **once per match**, only on your first turn, and only
  **before your first action**. "Before your first action" means nothing on your battlefield and nothing in
  your graveyard: no land played, no card cast, no land tapped.
  - A mulligan shuffles your hand into your deck and draws 6.
  - The MULLIGAN button is disabled as soon as a mulligan is no longer allowed. An already-open confirmation
    dialog is also refused if you acted in the meantime.
  - **Before:** a mulligan was allowed any time before your first End Turn, even after you had played and
    tapped lands. That allowed playing cards and then drawing 6 fresh ones. It could also be confirmed from a
    dialog left open into a later turn.

## 3. Turn structure

- **R3.1 Your turn:**
  1. Draw a card.
  2. Upkeep: your artifacts' "each turn" effects happen.
  3. Untap all your permanents.
  4. Your mana pool is emptied and your one-land allowance resets.
  5. **Main phase.** You play cards and tap lands. You may attack **once**: ATTACK, select attackers,
     then CONFIRM. Cards can still be played after combat.
  6. END TURN: unused mana is lost.
- **R3.2 AI turn:** untap, draw, upkeep, play at most one land, tap all its lands, play cards, attack.
- **R3.3 Timing:** you can only play cards, tap lands, use artifacts, attack or end the turn **during your
  own turn**. There is no instant-speed play (see `flash` in the card audit). You can't end your turn while
  attackers are being declared; confirm or cancel the attack first.

## 4. Lands and mana

- **R4.1** You may play **one land per turn**. The AI is limited the same way.
- **R4.2** Tapping a land adds one mana of its colour:
  - Distant Planet (Light or Swamp) and Rainbow (any colour) ask which colour you want.
  - Crystal Wasteland adds colourless mana.
  - Mana artifacts add colourless mana when clicked.
- **R4.3** A card's coloured cost must be paid with that colour. **House rule:** colourless mana is wild and
  can also pay coloured costs. Generic (colourless) costs can be paid with any mana.
  - Casting spends exactly the cost.
  - A card you can't afford is refused, and nothing changes.
- **R4.4** **Changed:** clicking a tapped land untaps it **only while its mana is still unspent**, and the
  mana is returned to your pool (an "undo").
  - Once that mana has been spent, the land stays tapped until your next turn.
  - **Before:** the land untapped even after its mana was spent, so it could be tapped again for unlimited mana.
- **R4.5** **Changed:** a colour picked from the dual-land dialog after your turn has ended (or the match is
  over) does nothing. Choosing a colour and then quickly tapping another dual land no longer hides the second
  dialog.

## 5. Creatures, combat and tapping

- **R5.1** Creatures can't attack on the turn they enter the battlefield (summoning sickness) unless they have
  haste. This applies to the AI too.
- **R5.2** Attacking taps a creature unless it has vigilance. `defender` creatures can't attack.
- **R5.3** **Changed:** permanents untap at the **start of their controller's turn**, not at the end of it.
  - Your creatures that attacked stay tapped through the AI's turn and **can't block**, exactly like the AI's
    attackers on your turn. This is what makes vigilance matter.
  - **Before:** the player's permanents untapped at the end of the player's own turn, so the player's
    attackers could always block. The AI's never could.
- **R5.4** **House rule:** blocking is automatic for both sides. Each attacker is blocked by the toughest
  untapped legal blocker, if one exists; two blockers are needed against menace. Flying attackers can only be
  blocked by flying or reach creatures.

## 6. Drawing from an empty deck

- **R6.1** **Changed (house rule):** a player who has to draw a card while their deck is empty **loses the
  match immediately**. This applies to the turn-start draw, the AI's draw, and draw effects such as Harvest or
  Crown of Power.
  - **Before:** the draw silently did nothing and the match could stall forever.
  - Decks are 60 cards, so this only decides long matches or heavy-draw decks.

## 7. Winning, losing and the end of a match

- **R7.1** A player whose life reaches 0 loses immediately. Life can't go below 0.
- **R7.2** **Simultaneous lethal (house rule):** effects resolve one step at a time, and the **first** player
  to reach 0 life (or to draw from an empty deck) loses. Nothing later in the same effect applies. For
  example, Drain Life that takes the enemy to 0 wins, whatever your own life was. If both players are found
  at 0 in the same check, it counts as a **loss** for the player; there are no draws.
- **R7.3** A match ends exactly once. After that, **no game action works**: playing cards, tapping lands,
  using artifacts, attacking, mulligans, ending the turn, and the keyboard shortcuts are all refused. Rewards
  and stats are recorded once: a win gives +25 credits and a booster pack; a loss gives +10 credits.
- **R7.4** **Changed:** leaving a match (Pause → Main Menu) cancels any AI turn still in progress.
  - **Before:** an unfinished AI turn kept running on its timers. If a new match was started within a few
    seconds, it could play lands and creatures and attack on the player's first turn, and start an extra
    player turn.

## 8. Combat

These rules are checked by `tests/combat.test.mjs` (`npm run combat`). Its scenario table runs every case
twice, once with the player attacking and once with the AI attacking, so both sides follow the same rules.
Emoji Elements borrows trading-card-game vocabulary, but these rules are its own.

- **C1 Attacking.** On your turn you may attack once: ATTACK, select attackers, CONFIRM.
  - A creature can attack if it is untapped, does not have Defender, and either arrived before this turn or
    has Haste.
  - Haste counts even if it was **granted** after the creature arrived (Footsteps, Gravity Boots). **Changed:**
    granted haste used to do nothing.
  - Clicking a creature that can't attack logs the reason (tapped, summoning sickness, defender). **Changed:**
    this was silent before.
  - Confirming with no attackers cancels the attack and does not use it up.
  - The AI follows the same eligibility rules.
- **C2 Blocking is automatic for both sides (house rule).** Attackers are handled in the order they were
  declared. Each one is blocked by the defender's **toughest** untapped creature that can legally block it and
  isn't already blocking.
  - A menace attacker needs **exactly two** blockers, otherwise it is unblocked.
  - Blocks happen whenever a legal blocker exists, even if the blocker will die.
  - Creatures with summoning sickness and Defender creatures may block. Tapped creatures can't.
- **C3 Legal blockers.**
  - Flying attackers can only be blocked by creatures with Flying or Reach.
  - **Unblockable** attackers can't be blocked. **Changed:** unblockable used to have no effect.
- **C4 Damage.** Creatures deal damage equal to their power.
  - An **unblocked** attacker hits the defending player.
  - A **blocked** attacker splits its damage over its blockers in **block order (toughest first)**: each blocker
    must receive lethal damage before the next one gets any. Lethal means its remaining toughness, or just 1
    from a Deathtouch creature. Without Trample, the last blocker receives all the remaining damage. With
    Trample, the remaining damage goes to the defending player.
  - Each blocker deals its power to the attacker.
  - Damage within a step is simultaneous.
- **C5 Excess damage to a creature is lost (house rule).** A creature can only take damage up to its remaining
  toughness. Lifelink counts the damage actually taken, plus any damage to a player.
- **C6 First Strike and Double Strike.**
  - If any creature in a block has First Strike or Double Strike, there is an earlier damage step in which only
    those creatures deal damage. Creatures killed then deal no normal damage. This is how first strike
    survives a trade.
  - Double Strike deals damage in both steps. **Changed:** an **unblocked** double striker now also hits the
    player twice (it used to hit once, and lifelink also counted once).
  - A blocked attacker whose blockers all died in the first step deals no more damage, unless it has Trample:
    then the whole second hit goes to the player.
- **C7 Deathtouch.** Any damage a Deathtouch creature deals to a creature destroys it. A 0-power Deathtouch
  creature deals no damage, so it destroys nothing.
- **C8 Lifelink.** Damage dealt by a Lifelink creature also gains its controller that much life, whether the
  creature is attacking or blocking.
- **C9 Order and lethal (house rule).** Attackers resolve one at a time in declaration order; dead creatures
  are removed after all attackers resolve. If a player reaches 0 life, the match ends at once, and nothing
  after that applies (including later lifelink).
- **C10 Death and graveyards.**
  - A creature with damage at least equal to its toughness goes to its **owner's** graveyard, untapped and
    undamaged.
  - **House rule:** tokens also go to the graveyard and can be revived.
  - **Changed:** revive spells return the **most recent creature** in your graveyard. They used to return the
    last card of any type, including instants and artifacts.
- **C11 Cleanup.** Damage marked on creatures wears off between turns. After combat the game returns to the
  main phase with no attackers selected.
- **C12 Hexproof.** Your opponent's destroy, tap and bounce effects can't choose this creature. It still blocks,
  is blocked, and is hit by "all creatures" effects such as Earthquake.
- **C13 Vigilance.** Attacking doesn't tap the creature, so it can still block on the next enemy turn (see R5.3).
- **C14 Granted keywords** (Feather, Surf, In the Clouds, Halo, Gravity Boots, Footsteps, Elven Bow) apply
  only to the creature that received them. **Changed:** a granted keyword used to be added to the shared card
  definition. That gave it to every copy of that card on both sides, in hand and deck, for the rest of the
  session.
- **C15 Flash: not supported.** There is no instant-speed play, so Flash currently has **no effect**. The card
  details screen says so.

| Keyword | Cards | Status |
|---|---|---|
| Flying, Reach | 40, 8 | ✅ Supported (C3) |
| Trample | 19 | ✅ Supported (C4) |
| Lifelink | 14 | ✅ Supported (C5, C8) |
| Haste | 27 + granted | ✅ Supported, including when granted (C1) |
| Vigilance | 36 | ✅ Supported (C13) |
| Defender | 17 | ✅ Supported (C1, C2) |
| Deathtouch | 13 | ✅ Supported (C7) |
| First Strike, Double Strike | 16, 1 | ✅ Supported (C6) |
| Menace | 17 | ✅ Supported (C2) |
| Hexproof | 8 | ⚠️ Partial by design: protects only against the opponent's destroy, tap and bounce (C12) |
| Unblockable | 1 + Surf | ✅ Supported (C3) |
| Flash | 9 | ❌ Not supported (C15) |

## Still open (not changed in this pass)

| Topic | Current behaviour | Why it's open |
|---|---|---|
| Choosing blockers | Automatic for both sides (R5.4) | Manual blocking would be new UI. |
| Spell targets | Damage spells hit the opponent; destroy/tap/bounce/buff pick random targets | Card text says "target" (card audit, decision F). |
| `flash` | No effect (C15) | Needs an instant-speed window during the AI turn (card audit, decision E). |
| Damage order among blockers | Toughest blocker first (C4) | Letting the attacker choose the order would need new UI. |
| Bonuses on dead creatures | A creature keeps its buffs and granted keywords in the graveyard and if revived or bounced | It could instead reset to the printed card. |
| Upkeep order | You draw before your upkeep effects and untap. The AI untaps, then draws, then upkeep. | Only the order of log messages differs. Neither side can act in between. |
| AI mana display | The AI's unspent mana stays visible during your turn | Cosmetic; the AI's pool is cleared at the start of its turn. |
| Who goes first | Always the player | It could alternate or be random. |
