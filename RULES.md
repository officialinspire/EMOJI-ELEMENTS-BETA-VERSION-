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

## Still open (not changed in this pass)

| Topic | Current behaviour | Why it's open |
|---|---|---|
| Choosing blockers | Automatic for both sides (R5.4) | Manual blocking would be new UI. |
| Spell targets | Damage spells hit the opponent; destroy/tap/bounce/buff pick random targets | Card text says "target" (card audit, decision F). |
| `flash`, `unblockable` | No effect | Card audit, decision E. |
| Upkeep order | You draw before your upkeep effects and untap. The AI untaps, then draws, then upkeep. | Only the order of log messages differs. Neither side can act in between. |
| AI mana display | The AI's unspent mana stays visible during your turn | Cosmetic; the AI's pool is cleared at the start of its turn. |
| Who goes first | Always the player | It could alternate or be random. |
