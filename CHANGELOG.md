# EMOJI ELEMENTS - Beta Version Changelog

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
