# 🎮 EMOJI ELEMENTS — Beta Version (v2.0)

A browser-based, Magic-inspired card battler built with vanilla HTML/CSS/JavaScript, now with intro video, full audio asset pack, expanded card content, and polished UI effects.

## 🚀 Recent Updates (v2.0)

### 🎬 Intro Experience
- Added opening credit video: `inspiresoftwareintro.mp4`
- Auto-play intro on load with click/tap skip support
- Smooth transition from intro to start menu

### 🔊 Audio Expansion
- Start menu background music loop (`startmenu.mp3`)
- Gameplay BGM asset included (`gameplaybackgroundmusic.mp3`)
- Expanded SFX pack for core actions:
  - land tap/untap, summon types, combat, damage/heal, menu actions, victory/defeat

### 🃏 Gameplay + Card System Enhancements
- Expanded card pool with 150+ cards across elements and themes
- Added/expanded keyword ability support, including:
  - Flying, Trample, Lifelink, Haste, Vigilance, Defender, Reach
  - Deathtouch, First Strike, Double Strike, Hexproof, Menace, Flash
- Rebalanced mana costs and creature stat profiles for smoother matches

### ✨ UX / UI Improvements
- Start menu dramatic fade-in animation
- Victory/defeat overlays and animated life-counter feedback
- Improved responsive behavior and mobile touch interactions
- Long-press card detail support on touch devices

### 📊 Stats + Persistence
- Tracks wins, losses, total games, and win rate
- Saves stats locally with browser localStorage

---

## 📁 Project Structure

Core runtime files:
1. `index.html` — app structure, overlays, intro integration
2. `styles.css` — layout, animations, responsive UI
3. `index.js` — game logic, card database, state + systems

Media assets (included in this repo):
- Intro: `inspiresoftwareintro.mp4`
- Music: `startmenu.mp3`, `gameplaybackgroundmusic.mp3`
- SFX: tap, untap, summon, attack, block, heal/damage, menu, game result clips

---

## ▶️ How to Run

1. Keep all files in this repository together (HTML/CSS/JS + media assets).
2. Open `index.html` in a modern browser.
3. Start playing — no build step or dependency install required.

> Tip: For best autoplay/audio behavior, interact once (click/tap) after load if your browser blocks media autoplay.

---

## 🎯 Core Controls

- **Click/Tap hand cards**: Play cards
- **Click land**: Tap for mana
- **Click tapped land**: Untap and refund mana (when allowed by game logic)
- **Mulligan**: One-time starting hand redraw to 6 cards
- **Attack Phase**: Select attackers
- **End Turn**: Pass turn to AI
- **Right-click / Long-press**: View card details
- **Menu button**: Open pause/settings flow

---

## 🧠 Gameplay Overview

### Objective
Reduce the opponent from 20 life to 0.

### Card Types
- **Land** — mana generation (typically one per turn)
- **Creature** — board presence, attack/block units
- **Instant/Spell** — immediate effects
- **Artifact** — persistent value effects

### Turn Flow
1. Untap
2. Draw
3. Main Phase
4. Combat
5. Main Phase 2
6. End Turn

---

## 🤖 AI & Modes

- **Element-based deck identity** (Fire, Water, Earth, Swamp, Light)
- **Difficulty options**:
  - Easy
  - Medium
  - Hard

---

## 📱 Compatibility

Tested target environments:
- Chrome (Desktop/Mobile)
- Safari (Desktop/iOS)
- Firefox
- Edge
- Android Chrome

Touch + mouse inputs are supported.

---

## 🔧 Technical Notes

- Pure vanilla JavaScript implementation
- No framework or bundler required
- Local persistence via `localStorage`
- Responsive design and animation-heavy UI

---

## 📌 Planned Next Improvements

- Deeper integration of all SFX in every gameplay action
- Extended rules coverage for advanced keyword interactions
- More card effects and balance passes
- Tournament/deck-building features
- Multiplayer exploration

---

## 🎉 Ready to Play

Open `index.html`, choose your setup, and battle.
