# Emoji Elements recorded SFX

Curated and mixed from **Kenney / Kenney.nl** CC0-1.0 game-audio packs.
The original pack license notices are preserved in `licenses/`.
CC0: https://creativecommons.org/publicdomain/zero/1.0/

## Shipped bank

`sfx-bank.wav`: 27 edited clips in one 360,542-byte, mono 22,050 Hz PCM16 sprite (8.17 seconds).
`manifest.json` records exact frame offsets, lengths, original source-file SHA-256 hashes, and bank SHA-256.
No third-party requests or runtime dependency are needed.

Menu buttons use compact clicks; menus and cards use paper/card foley; attacks combine swishes
and body impacts; blocks/artifacts use metal; spells/healing/rewards use glass/bell textures.
Pack opening uses a recorded card-pack tear. Summon variants, reveal rarities, hit intensity and
subtle theme filtering/pitch retain their existing gameplay meanings.

## Sources (retrieved 2026-10-22)

- [Interface Sounds](https://kenney.nl/assets/interface-sounds) — [exact archive](https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip); extracted folder `interface`.
  Archive SHA-256: `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`.
- [Casino Audio](https://kenney.nl/assets/casino-audio) — [exact archive](https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip); extracted folder `casino`.
  Archive SHA-256: `f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18`.
- [RPG Audio](https://kenney.nl/assets/rpg-audio) — [exact archive](https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip); extracted folder `rpg`.
  Archive SHA-256: `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b`.
- [Impact Sounds](https://kenney.nl/assets/impact-sounds) — [exact archive](https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip); extracted folder `impact`.
  Archive SHA-256: `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`.
- [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) — [exact archive](https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip); extracted folder `scifi`.
  Archive SHA-256: `119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04`.

## Rebuild

Download the archives above, verify their hashes, and extract each into its named folder,
so `/path/to/packs/interface/Audio/` and the other four pack directories exist. Then:

```sh
python3 scripts/build-sfx.py /path/to/packs
npm run pwa:build
npm run pwa:check
```

Python 3 and ffmpeg are authoring tools only. The script downmixes/resamples, trims low-level
leading/trailing silence, layers selected recordings, normalizes peaks, and applies short endpoint
fades. It writes the bank, provenance manifest, license copies, and embedded cue offsets in
`feedback.js`. Original source recordings are not all shipped. No synthesis is added to the bank.

## Runtime behavior

The first trusted gesture starts one asynchronous fetch/decode in the existing shared AudioContext.
Startup/credits/gameplay never await it. Once ready, every cue uses an AudioBufferSourceNode;
there are no per-hit downloads. A cold/failed bank uses the previous synthesis as a temporary
fallback. Download/decoder errors are caught and retry only after a 30-second cooldown.
Earlier inputs are never queued for replay when loading finishes.

Master mute, independent music/effects sliders, music ducking, cooldowns, eight-voice limit,
priority eviction, explicit source cleanup, haptics and saved preferences retain the existing paths.
The bank is a hashed required PWA asset, so a complete installed build includes it offline.

Listen/compare in `docs/sound-board.html`; its volume and theme controls do not overwrite saved
game preferences. Headless rendering measures signal/tails; phone/headphone listening remains
the subjective final check.
