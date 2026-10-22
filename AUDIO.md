# EMOJI ELEMENTS: Sound and Haptics

Branch `claude/audio-feedback`, built on the battle-screen and pause pass (`claude/battle-pause`).

| Part | Where |
|---|---|
| Effects and haptics engine (`window.GameFeedback`) | `feedback.js` |
| Wiring, music and the settings UI | `index.js` |
| Tests | `tests/audio.test.mjs` (`npm run audio`) |
| Listening page | `docs/sound-board.html` |

## Current soundtrack and mix

- Main menu: `minimalist menu theme.mp3` (175.9 s; source mean −15.4 dBFS, peak −0.6 dBFS).
- Gameplay: `Emoji Elements - Celestial Battle Theme.mp3` (174.0 s; source mean −16.9 dBFS, peak −1.0 dBFS).
- Fresh installs start at Music 30% and Effects 70%. Existing saved preferences are preserved.
  Music has a 0.45 mix trim: at the defaults its mean is approximately −32.8 / −34.3 dBFS.
  Successful effects briefly duck music to 35% of its current level, then recover with a gentle envelope.
  These are signal measurements, not listening judgments; users can adjust either slider independently.
- Streaming music is routed once through per-track Web Audio gains in the effects engine's shared,
  gesture-unlocked context. This supports fades and music volume on mobile browsers that ignore
  `HTMLMediaElement.volume`. The intro video remains outside that graph and outside music ducking;
  saved master mute now also silences its audio. Music cannot start until the intro ends or is skipped.
- Without Web Audio or supported media routing, HTML media playback remains the fallback. On browsers
  that ignore media volume in this fallback, Music on/off and master mute remain available.
- Settings changed during a fade use the latest volume. Rapid transitions cancel stale fades.
  Hidden pages pause music; foregrounding resumes the same position, and gameplay remains paused
  until the player resumes it. Stopping a track while hidden prevents an unwanted restart.
- The PWA caches the two new filenames, including URL-encoded spaces, with offline range support.
  Run `npm run pwa:build` after changing soundtrack files and commit both generated files.

The sections below document the original effects pass and its historical measurements. For this
soundtrack update, automated browser tests cover startup/credits isolation, real streaming gain routing,
foreground effects ducking/recovery, settings/fade races, rapid menu transitions, hidden-page lifecycle,
existing independent controls, and both new cached tracks offline. Real-device listening remains required
for subjective balance on phone speakers/headphones and OS-specific interruptions.

## 1. What was there

**Media files.** The repository holds 20 audio/video files: 19 MP3s and the intro MP4. I found no 21st file;
the intro video's audio track may be what made 21.

| File | Used as | Length | Mean / peak level | Notes |
|---|---|---|---|---|
| startmenu.mp3 | menu music | 28.5 s | −12.3 / 0.0 dB | kept |
| gameplaybackgroundmusic.mp3 | match music | 139.5 s | −15.4 / −2.8 dB | kept |
| inspiresoftwareintro.mp4 | intro video | 5.9 s | −21.3 / −6.1 dB | kept |
| select.mp3, summoncreaturefantasy.mp3, scifisummon.mp3, summoninstant.mp3 | menu selection, both summons, spells and artifacts | 2.4 s each | −38.1 / −12.8 dB | **one sound, four byte-identical files**: selection, summons, spells and artifacts all sounded the same |
| menuopen.mp3 / menuclose.mp3 | menu open / close (19 places) | 1.9 s | −33.0 / −0.3 dB and −47.4 / −23.3 dB | 2 s tails on a click; open was 14 dB louder than close |
| tapland.mp3 / untap.mp3 | land tap / turn start | 1.8 / 2.3 s | −53.0 / −41.6 dB | near-silent compared with the rest |
| attack.mp3, block.mp3 | attack, block | 0.4 / 0.8 s | −16.9 / −20.1 dB | loudest effects |
| playertakedamage / opponenttakedamage / playerheal / opponentheals .mp3 | life changes | 1.0–1.9 s | −21.6 to −26.5 dB | see timing |
| carddestroyed.mp3 | creature dies | 2.4 s | −29.6 dB | |
| gamevictorysfx.mp3 / gamelosesfx.mp3 | win / loss | 4.2 / **9.7 s** | −26.8 / −17.4 dB; the loss peaked at **0.0 dBFS** | |

Effect loudness spread over **36 dB** (tapland −53 dB mean, attack −17 dB).

**Timing:**
- **Damage and healing played once per life point**, 100 ms apart, by restarting the same `<audio>` element.
  Six damage made one sound that restarted six times (one `play` event, five restarts of its first 0.1 s).
- **Heal spells (Meditate and the other `heal_draw` cards) played their heal sound twice**: once in the spell,
  and once per point in the life change.
- **Each sound was one element**, so it couldn't overlap itself. A second play cut the first off. A blanket
  100 ms rule dropped repeats.
- **Pack opening was silent**: no sound for the rip or for revealing cards, rare or not.
- **There was no achievement system** in that baseline.

**Mute:**
- One switch (`emojiElementsMuted`), the header 🔊, muted every element. There was no separate music or
  effects control. The previous pass added Music and Haptics switches to the pause menu.

**Mobile playback:**
- All 19 elements were created at load with the default preload. **19 files, 1.8 MB, downloaded before the
  first tap**: every effect, the menu music and the intro. Only the match music waited.
- `<audio>` effects have noticeable start latency on phones, and iOS ignores `.volume` on media elements.

**Unlock:**
- Music started only after CLICK TO START, which is correct. Effect `play()` calls before a gesture were
  rejected and logged at debug level.
- The one direct `navigator.vibrate(50)` (on long-press) had no guard apart from the setting the pause pass
  added.

## 2. The new effects

Every effect is now synthesised with the Web Audio API in `feedback.js`. There are no effect files any more:
the 17 effect MP3s are removed. Music and the intro video remain streaming `<audio>` / `<video>` elements; see the current soundtrack
section above for the updated routing and mix.

**How the effects are shaped:**
- **Graph:** cue voices → effects gain (the Effects volume) → compressor (−18 dB, 4:1) → +7 dB makeup → speakers.
- **Short tails:** UI sounds ring for 50–150 ms; most game sounds for under 0.35 s; rare reveals up to 0.9 s;
  victory and defeat about 1.3 s.
- **Pitch variation** on sounds that repeat (selection ±60 cents, land taps ±25, hits ±40…), so long sessions
  don't sound mechanical. Quick land taps also step up a whole tone each, to at most 4 steps, so tapping a row of
  lands sounds like a short run.
- **Limits:**
  - each cue has a cooldown (selection 45 ms … victory 1.5 s) and a cap on copies sounding at once (1–3);
  - all effects together are capped at 8 voices, with victory and defeat allowed to take a slot;
  - damage and healing play **one** cue per life change, scaled by its size, never one per point.
- **Themes:** tonal cues follow the visual theme. Arcane Fantasy uses a bell-like triangle wave, Deep Space pure
  sines, and Neon Sci-Fi a softened square. Sci-fi creatures get a rising filtered zap instead of the fantasy
  chime.

Measured from offline renders (`GameFeedback.renderCue`, OfflineAudioContext, Arcane theme, Effects at the
default 70 %). Length is until the signal falls below −60 dB. For comparison, the music plays at about −21 dB mean.

| Event | Cue | Length | Peak | RMS |
|---|---|---|---|---|
| Menu selection (also choosing an attacker) | `select` | 55 ms | −19.8 dBFS | −35.1 |
| Menu open / close | `open` / `close` | 147 / 134 ms | −15.6 / −17.1 | −32.2 / −33.8 |
| Card pickup (pressing a playable hand card) | `pickup` | 70 ms | −24.4 | −42.0 |
| Creature played (fantasy / sci-fi) | `summon` | 286 / 176 ms | −13.2 / −13.5 | −26.1 / −25.7 |
| Artifact played | `artifact` | 182 ms | −18.7 | −31.8 |
| Spell resolves | `spell` | 210 ms | −16.8 | −30.4 |
| Land tap, land played | `landTap` | 76 ms | −16.3 | −29.5 |
| Your turn (untap) | `turnStart` | 202 ms | −17.6 | −33.8 |
| Attack | `attack` | 216 ms | −8.1 | −25.8 |
| Block | `block` | 121 ms | −17.9 | −32.8 |
| You take damage (small / 8+) | `damageTaken` | 191 / 223 ms | −14.0 / −10.1 | −25.1 / −21.4 |
| Enemy takes damage | `damageDealt` | 119 ms | −15.3 | −30.7 |
| Healing | `heal` | 316 ms | −13.6 | −27.1 |
| Creature destroyed | `destroy` | 166 ms | −15.2 | −30.0 |
| Pack torn open | `packRip` | 274 ms | −15.9 | −37.0 |
| Card revealed (common / rare / epic / legendary) | `reveal` | 66 / 340 / 405 / 926 ms | −24.3 / −15.6 / −15.0 / −13.4 | −38.5 / −29.1 / −28.4 / −29.1 |
| Achievement unlock | `achievement` | 744 ms | −11.8 | −28.9 |
| Victory | `victory` | 1.34 s | −7.5 | −26.5 |
| Defeat | `defeat` | 1.21 s | −12.6 | −26.2 |
| Not allowed (any ⚠️ message: not your turn, can't afford…) | `deny` | 131 ms | −17.0 | −32.9 |

**Notes on the cue set:**
- **Achievement:** the integrated achievement notices call `GameFeedback.play('achievement')` after an earned unlock; quiet backfill and QA fixtures do not play it.
- **The AI's plays** use the same summon, spell and artifact cues as yours, and their cooldowns keep a burst of
  AI plays from piling up.
- **Before and after for a heal spell:** previously 1 + 3 sounds (the spell, then one per point). Now one heal
  cue.

## 3. Unlock, interruptions and blocked audio

- **No sound before a touch.** `feedback.js` creates its AudioContext only in `unlock()`. `index.js` calls it
  from capture-phase `pointerdown`, `keydown` and `touchend` listeners, so nothing can play, and nothing is
  created, before the first touch, click or key. Before that, `play()` returns false and counts the skip.
- **Interruptions are quiet.** When the browser suspends or interrupts audio (a call on iOS, a background tab,
  a refused `resume()`), effects are skipped without errors, and the next gesture resumes the context. The
  context is also suspended while the page is hidden (battery) and resumed when it returns.
- **No Web Audio at all:** `GameFeedback.state` is `unsupported`, every effect is skipped, and the game plays
  normally (tested).
- **Downloads before the first tap** are now 2 files, the intro and the menu music, instead of 19 (measured in
  Chromium).

## 4. Settings

Each setting is saved on this device under its own key, never in the game profile. Resetting progress keeps them.

| Setting | Key | Default | Notes |
|---|---|---|---|
| Sound (master) | `emojiElementsMuted` | on | The header 🔊. While it is off, Music and Effects are shown off and can't be changed. |
| Music | `emojiElementsMusicOff` | on | Menu and match music |
| Music volume | `emojiElementsMusicVolume` | 30 % | Web Audio gain with background mix trim; saved values are preserved. |
| Effects | `emojiElementsSfxOff` | on | |
| Effects volume | `emojiElementsSfxVolume` | 70 % | Letting go of the slider plays a sample |
| Haptics | `emojiElementsHaptics` | on | Disabled, with "Not available on this device", where there is no vibration |

**Where they are:**
- the pause panel (Settings);
- the main menu's new **🔊 Sound** chip beside the Theme chip, which opens a Sound & haptics dialog.

Both draw the same rows (`renderSoundSettings`). The switches are `role="switch"` with ON/OFF text, and the
sliders are labelled range inputs with a percentage. The dialog has the usual Esc, focus trap and focus return.

## 5. Haptics

Every vibration goes through `GameFeedback.haptic(kind)`, which `index.js` wraps as `haptic(kind)`. The old
direct `navigator.vibrate(50)` on long-press now goes through it too.

| Kind | Pattern (ms) | Used for | Cooldown |
|---|---|---|---|
| `select` | 8 | Choosing an attacker; long-press for details | 70 ms |
| `toggle` | 12 | Turning Haptics on | 100 ms |
| `play` | 15 | You play a card | 120 ms |
| `impact` | 22 · 40 · 30 | You confirm an attack; you take damage | 450 ms |
| `reveal` | 12 | A pack tears open | 150 ms |
| `revealRare` | 14 · 40 · 14 · 40 · 26 | A rare, epic or legendary card is revealed | 500 ms |
| `victory` | 30 · 60 · 30 · 60 · 90 | You win | 2 s |
| `defeat` | 60 | You lose | 2 s |

**Guards.** `haptic` does nothing:
- when the setting is off, or the device has no `navigator.vibrate`;
- before a real touch, click or key the game has seen, and the browser agrees the page was used;
- while the page is hidden;
- within its own cooldown;
- within 50 ms of another buzz, except victory, defeat and rare reveals.

**Reduced motion:** a pattern becomes one pulse of at most 12 ms.

**AI turns:** they never buzz, except when you take damage. That buzz is once per hit, never per point and
never per AI action.

## 6. How it was checked

### Automatically (headless Chromium; no speakers)

`tests/audio.test.mjs` has 15 tests, in CI. Each one checks what the game asks the audio and vibration APIs to
do. None of them listens.

- Nothing is created or played before the first gesture, and effect files are no longer downloaded.
- Every cue renders below −6 dBFS peak, is audible, and stays inside its length limit.
- Master, music, effects, volumes and haptics are independent, clamped, and kept across a reload; the profile
  is untouched.
- The menu Sound dialog and the pause panel agree; sliders by keyboard; a switched-off channel hides its slider;
  Esc closes.
- **Rapid input:** 20 selections in one moment play once; all 21 cues at once stay within 8 voices; six quick
  land taps step 0, 1, 2, 3, 4, 4.
- **One sound per life change:** 6 damage gives one `damageTaken` (intensity 0.75) and one impact buzz. A heal
  spell gives one heal cue.
- **A whole turn:** taps, a play, an attack and the AI's turn use the right cues, and the AI turn buzzes at most
  once (your damage).
- **Pause:** nothing from the match sounds during 20 s of pause; settings still answer; the AI's sounds resume
  with it.
- **Pack opening:** one rip, one reveal per card with that card's rarity, rare patterns spaced by their cooldown.
- **Win and loss:** one stinger and one pattern each.
- **Haptic guards:** off, before a gesture, hidden page, cooldown, and reduced motion (one 12 ms pulse).
- **No vibration support:** the switch is disabled and labelled, and a turn plays normally.
- **No Web Audio:** effects are skipped and a turn plays normally.
- **Suspended or interrupted context:** effects wait quietly and come back.
- **The sound board** plays all 27 buttons and leaves the saved settings alone.

**Updated tests:** `tests/battle.test.mjs`'s pause-settings test now covers the four switches. Its remaining-time
test has ±300 ms margins: it failed once under heavy machine load (the fake clock also moves with real time). It
still tells "the 1 s left" from "at once" and from "the full 1.5 s again".

### On a real device

**Not done in this pass.** I can't listen to audio or feel vibration here, and the Firefox and WebKit engines
aren't installed. Nothing in this document has been heard on a real phone or speaker.

To review, open `docs/sound-board.html` on the deployed site (or a local server). It plays every cue in any
theme and at any volume, and every haptic pattern. It doesn't change the game's saved settings. Then play a
match. Please check:

- **Comfort:** sounds at the default volumes over a 20-minute match on phone speakers and on headphones; whether
  anything is too loud next to the music.
- **iOS:** effects start on the first tap after CLICK TO START, and come back after a phone call or app switch.
  The ringer/silent switch silences Web Audio effects while music elements may still play. Decide whether that
  is acceptable.
- **Android vibration** strength for each pattern. iOS Safari has no `navigator.vibrate`, so Haptics shows "Not
  available".
- Check the Music slider and fades on iOS with the streaming Web Audio gain, and Music on/off in the no-Web-Audio fallback.

### Listening files

The renders above were also saved as WAV files (one per cue, plus all cues in a row), so they can be heard
without running the game. They were shared with this pass, not committed.

## 7. Limits

- **Achievements:** earned notices use the cue; saved-history backfill stays quiet.
- **Card pickup** sounds on pointer press only. Keyboard play goes straight to the play sound.
- **Measurements** are the synthesised signal. A phone speaker will thin out the low thuds (damage, summon).

Release hardening: each synthesized cue now owns its sources, filters and envelopes. Priority eviction
stops/disconnects the evicted cue, natural completion disconnects its nodes, and `stopAll()` destroys
future notes before gain recovery. `tests/audio-lifecycle.test.mjs` independently observes real Web Audio
nodes; the three-node processing bus remains for subsequent cues. See RELEASE.md for measured soak limits.
