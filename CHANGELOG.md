# EMOJI ELEMENTS - Beta Version Changelog

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
