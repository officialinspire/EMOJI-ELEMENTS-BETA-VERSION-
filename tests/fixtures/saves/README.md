# Saved-data fixtures

Realistic `localStorage` contents used by `tests/progression.test.mjs`. They were generated with the real
game functions (`createInitialMeta`, `generatePack`, `validateMeta`) at commit `8fe4d17`, the build before
the progression-hardening pass. That makes them what returning players actually have on disk.
**Do not regenerate them with newer code**: their job is to prove that old saves still load.

| File | Key | What it represents |
|---|---|---|
| `existing.json` | `emoji_elements_meta_v1` | A mid-progress player. Four packs opened (with duplicate pulls), 135 credits, 4 wins / 3 losses, an edited FIRE deck, EARTH_LIGHT selected. FIRE_SWAMP is the old 59-card clamped starter. |
| `preDual.json` | `emoji_elements_meta_v1` | An older profile with only the five mono decks (from before dual decks existed). |
| `partial.json` | `emoji_elements_meta_v1` | No `version`, numbers stored as strings, one deck without its starter list. |
| `future.json` | `emoji_elements_meta_v1` | Written by a newer build: `version: 2` plus unknown fields. |
| `renamed.json` | `emoji_elements_meta_v1` | Holds a card id that no longer exists (`creatures-flame-fox`) in the collection and the FIRE deck. |
| `corrupt.txt` | `emoji_elements_meta_v1` | `existing.json` cut off part-way through a write (invalid JSON). |
| `legacy-stats.json` | `emojiElementsStats` | Stats from the pre-meta build, with no meta save present. |
