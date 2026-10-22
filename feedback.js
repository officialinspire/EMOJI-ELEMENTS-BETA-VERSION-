// Sound effects and haptics for EMOJI ELEMENTS (window.GameFeedback). Loaded before index.js.
//
// Every effect is synthesised here with the Web Audio API: short, quiet tails, a gentle compressor on the bus,
// a little pitch variation on sounds that repeat, a cooldown per sound and a cap on overlapping voices, so a
// long session stays comfortable. Music and the intro video stay HTML media elements in index.js.
//
// Nothing makes a sound before the player has touched the page: the AudioContext is created by unlock(), which
// index.js calls from a user gesture. If the browser blocks, suspends or interrupts audio (iOS calls, background
// tabs), effects are silently skipped and the next gesture resumes it.
//
// Haptics go through haptic(kind) only: brief patterns, a cooldown per kind, nothing before the first touch,
// nothing while the page is hidden, a single short pulse with reduced motion, and nothing at all when the
// player switched haptics off or the device has no vibration.
(function () {
    'use strict';

    // ---- Settings, each under its own localStorage key (none of them is part of the game profile)
    const KEYS = {
        muted: 'emojiElementsMuted',           // master: music and effects
        musicOff: 'emojiElementsMusicOff',
        musicVolume: 'emojiElementsMusicVolume',
        sfxOff: 'emojiElementsSfxOff',
        sfxVolume: 'emojiElementsSfxVolume',
        haptics: 'emojiElementsHaptics'
    };
    const DEFAULTS = { muted: false, musicOff: false, musicVolume: 0.5, sfxOff: false, sfxVolume: 0.7, haptics: true };

    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(KEYS[key]);
            if (raw === null) return fallback;
            if (typeof fallback === 'boolean') return raw === 'true';
            const n = Number(raw);
            return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    const settings = {};
    Object.keys(DEFAULTS).forEach(key => { settings[key] = read(key, DEFAULTS[key]); });
    const listeners = [];

    // persist: false changes it for this page only (the sound board uses that, so it never touches the player's settings)
    function setSetting(key, value, { persist = true } = {}) {
        if (!(key in DEFAULTS)) return;
        settings[key] = typeof DEFAULTS[key] === 'boolean' ? !!value : Math.max(0, Math.min(1, Number(value) || 0));
        if (persist) {
            try { localStorage.setItem(KEYS[key], String(settings[key])); } catch (_) { /* blocked storage: lasts this visit */ }
        }
        applySfxGain();
        listeners.forEach(fn => { try { fn(key, settings[key]); } catch (_) { /* a listener's problem */ } });
    }

    const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // ---- Audio graph: cue voices → sfx gain → compressor → speakers
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let sfxGain = null;
    let noiseBuffer = null;
    let gestureSeen = false;
    const stats = { played: {}, dropped: {} };
    const lastPlayed = {};
    const activeVoices = [];     // { cue, end, nodes }
    const MAX_VOICES = 8;

    const count = (bucket, name) => { stats[bucket][name] = (stats[bucket][name] || 0) + 1; };

    function sfxLevel() {
        return settings.muted || settings.sfxOff ? 0 : settings.sfxVolume;
    }

    function applySfxGain() {
        if (!ctx || !sfxGain) return;
        sfxGain.gain.setTargetAtTime(sfxLevel(), ctx.currentTime, 0.015);
    }

    function buildBus(context, destination) {
        const gain = context.createGain();
        const comp = context.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.12;
        // Makeup gain: at the default 70 % the effects sit just under the music (about -24 to -32 dBFS RMS)
        const makeup = context.createGain();
        makeup.gain.value = 2.2;
        gain.connect(comp).connect(makeup).connect(destination);
        return gain;
    }

    function makeNoise(context) {
        const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.6), context.sampleRate);
        const data = buffer.getChannelData(0);
        let seed = 12345;   // fixed noise: the same texture every time, independent of Math.random
        for (let i = 0; i < data.length; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            data[i] = (seed / 0x3fffffff) - 1;
        }
        return buffer;
    }

    // Called from a user gesture (index.js). Creates or resumes the context; harmless to call often.
    function unlock() {
        gestureSeen = true;
        if (!AudioCtor) return;
        try {
            if (!ctx) {
                ctx = new AudioCtor({ latencyHint: 'interactive' });
                sfxGain = buildBus(ctx, ctx.destination);
                sfxGain.gain.value = sfxLevel();
                noiseBuffer = makeNoise(ctx);
            }
            if (ctx.state !== 'running') ctx.resume().catch(() => { /* blocked: the next gesture tries again */ });
        } catch (_) {
            ctx = null;   // no audio on this device; the game plays silently
        }
    }

    // Background tabs don't need a running context (battery); it resumes on return if it was unlocked.
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend().catch(() => {});
        else if (gestureSeen) ctx.resume().catch(() => {});
    });

    // ---- Synthesis helpers. Each takes the context, the bus and a start time; all envelopes end at zero.
    function env(context, param, t, peak, attack, decay) {
        param.setValueAtTime(0.0001, t);
        param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
        param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function tone(context, bus, t, { type = 'sine', freq, to = null, attack = 0.004, decay = 0.12, gain = 0.2, filter = null, detune = 0 }) {
        const osc = context.createOscillator();
        const amp = context.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
        osc.detune.value = detune;
        env(context, amp.gain, t, gain, attack, decay);
        let node = osc;
        if (filter) {
            const f = context.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = filter;
            node.connect(f);
            node = f;
        }
        node.connect(amp).connect(bus);
        osc.start(t);
        osc.stop(t + attack + decay + 0.02);
        return t + attack + decay + 0.02;
    }

    function noise(context, bus, t, { type = 'bandpass', freq = 2000, to = null, q = 1, attack = 0.003, decay = 0.08, gain = 0.15 }) {
        const src = context.createBufferSource();
        src.buffer = noiseBuffer || makeNoise(context);
        const f = context.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
        f.Q.value = q;
        const amp = context.createGain();
        env(context, amp.gain, t, gain, attack, decay);
        src.connect(f).connect(amp).connect(bus);
        src.start(t);
        src.stop(t + attack + decay + 0.02);
        return t + attack + decay + 0.02;
    }

    const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);   // MIDI note → Hz

    // Tonal cues follow the visual theme: bell-like in Arcane Fantasy, pure in Deep Space, soft square in Neon.
    function timbre() {
        const theme = document.documentElement.dataset.theme;
        if (theme === 'neon') return { type: 'square', filter: 2600, level: 0.55 };
        if (theme === 'deep-space') return { type: 'sine', filter: null, level: 1.1 };
        return { type: 'triangle', filter: null, level: 1 };
    }

    // ---- The cues. vary: random pitch spread in cents; cooldown: ms before the same cue may play again;
    // maxVoices: how many of this cue may sound at once.
    const CUES = {
        select: { vary: 60, cooldown: 45, maxVoices: 2, play: (c, b, t, o, v) => {
            const tb = timbre();
            return tone(c, b, t, { type: tb.type, filter: tb.filter, freq: 1320 * v, to: 1150 * v, decay: 0.045, gain: 0.11 * tb.level });
        } },
        open: { vary: 30, cooldown: 90, maxVoices: 1, play: (c, b, t, o, v) => {
            const tb = timbre();
            tone(c, b, t, { type: tb.type, filter: tb.filter, freq: NOTE(79) * v, decay: 0.06, gain: 0.07 * tb.level });
            return tone(c, b, t + 0.055, { type: tb.type, filter: tb.filter, freq: NOTE(84) * v, decay: 0.09, gain: 0.07 * tb.level });
        } },
        close: { vary: 30, cooldown: 90, maxVoices: 1, play: (c, b, t, o, v) => {
            const tb = timbre();
            tone(c, b, t, { type: tb.type, filter: tb.filter, freq: NOTE(84) * v, decay: 0.05, gain: 0.06 * tb.level });
            return tone(c, b, t + 0.05, { type: tb.type, filter: tb.filter, freq: NOTE(77) * v, decay: 0.08, gain: 0.06 * tb.level });
        } },
        // A card lifted from the hand: a soft paper swish
        pickup: { vary: 120, cooldown: 70, maxVoices: 1, play: (c, b, t, o, v) =>
            noise(c, b, t, { type: 'bandpass', freq: 2600 * v, to: 4600 * v, q: 0.9, attack: 0.012, decay: 0.06, gain: 0.08 }) },
        // A creature arrives: a low thump and a two-note chime (fantasy) or a rising filtered zap (sci-fi)
        summon: { vary: 40, cooldown: 100, maxVoices: 2, play: (c, b, t, o, v) => {
            tone(c, b, t, { type: 'sine', freq: 170 * v, to: 90 * v, decay: 0.14, gain: 0.22 });
            if (o.variant === 'scifi') {
                return tone(c, b, t + 0.02, { type: 'sawtooth', filter: 1800, freq: 320 * v, to: 980 * v, attack: 0.01, decay: 0.16, gain: 0.07 });
            }
            const tb = timbre();
            tone(c, b, t + 0.03, { type: tb.type, filter: tb.filter, freq: NOTE(76) * v, decay: 0.18, gain: 0.07 * tb.level });
            return tone(c, b, t + 0.09, { type: tb.type, filter: tb.filter, freq: NOTE(83) * v, decay: 0.22, gain: 0.06 * tb.level });
        } },
        // An artifact: a short metallic ping (two inharmonic partials)
        artifact: { vary: 40, cooldown: 100, maxVoices: 2, play: (c, b, t, o, v) => {
            tone(c, b, t, { type: 'sine', freq: 1180 * v, decay: 0.2, gain: 0.07 });
            return tone(c, b, t, { type: 'sine', freq: 1693 * v, decay: 0.14, gain: 0.05 });
        } },
        // A spell resolves: a quick rising sparkle over a breath of air
        spell: { vary: 50, cooldown: 120, maxVoices: 2, play: (c, b, t, o, v) => {
            const tb = timbre();
            noise(c, b, t, { type: 'highpass', freq: 3000, attack: 0.02, decay: 0.16, gain: 0.04 });
            [74, 79, 83, 86].forEach((n, i) => tone(c, b, t + i * 0.035, { type: tb.type, filter: tb.filter, freq: NOTE(n) * v, decay: 0.1, gain: 0.05 * tb.level }));
            return t + 0.25;
        } },
        // A land tapped: a short wooden "tok"; quick taps step up gently (o.step 0..4)
        landTap: { vary: 25, cooldown: 35, maxVoices: 3, play: (c, b, t, o, v) => {
            const step = Math.pow(2, (Math.min(4, o.step || 0) * 2) / 12);
            noise(c, b, t, { type: 'lowpass', freq: 1200, attack: 0.001, decay: 0.02, gain: 0.06 });
            return tone(c, b, t, { type: 'sine', freq: 360 * v * step, to: 250 * v * step, decay: 0.07, gain: 0.16 });
        } },
        // Your turn begins (untap): a soft rising two-note
        turnStart: { vary: 0, cooldown: 400, maxVoices: 1, play: (c, b, t) => {
            const tb = timbre();
            tone(c, b, t, { type: tb.type, filter: tb.filter, freq: NOTE(72), decay: 0.09, gain: 0.05 * tb.level });
            return tone(c, b, t + 0.07, { type: tb.type, filter: tb.filter, freq: NOTE(79), decay: 0.14, gain: 0.05 * tb.level });
        } },
        // Attack declared: a whoosh into a low hit
        attack: { vary: 40, cooldown: 140, maxVoices: 1, play: (c, b, t, o, v) => {
            noise(c, b, t, { type: 'bandpass', freq: 700 * v, to: 2800 * v, q: 1.2, attack: 0.04, decay: 0.12, gain: 0.12 });
            return tone(c, b, t + 0.1, { type: 'triangle', freq: 120 * v, to: 70 * v, decay: 0.12, gain: 0.15 });
        } },
        // A block: a dull metallic clank
        block: { vary: 50, cooldown: 140, maxVoices: 1, play: (c, b, t, o, v) => {
            noise(c, b, t, { type: 'bandpass', freq: 1800 * v, q: 6, attack: 0.001, decay: 0.09, gain: 0.12 });
            tone(c, b, t, { type: 'square', filter: 1400, freq: 210 * v, decay: 0.09, gain: 0.07 });
            return tone(c, b, t, { type: 'sine', freq: 520 * v, decay: 0.12, gain: 0.05 });
        } },
        // You lose life: a low thud, heavier for bigger hits (o.intensity 0..1). One cue per change, not per point.
        damageTaken: { vary: 40, cooldown: 160, maxVoices: 1, play: (c, b, t, o, v) => {
            const k = 0.6 + 0.4 * Math.min(1, o.intensity || 0);
            noise(c, b, t, { type: 'lowpass', freq: 700, attack: 0.002, decay: 0.09 * k + 0.03, gain: 0.12 * k });
            return tone(c, b, t, { type: 'sine', freq: 150 * v, to: 55 * v, decay: 0.16 + 0.08 * k, gain: 0.3 * k });
        } },
        // The enemy loses life: a crisper, higher hit
        damageDealt: { vary: 40, cooldown: 140, maxVoices: 1, play: (c, b, t, o, v) => {
            const k = 0.6 + 0.4 * Math.min(1, o.intensity || 0);
            noise(c, b, t, { type: 'highpass', freq: 1800, attack: 0.001, decay: 0.05, gain: 0.07 * k });
            return tone(c, b, t, { type: 'triangle', freq: 330 * v, to: 160 * v, decay: 0.12, gain: 0.18 * k });
        } },
        // Life gained (either side): a warm rising pair with a soft shimmer
        heal: { vary: 20, cooldown: 220, maxVoices: 1, play: (c, b, t, o, v) => {
            tone(c, b, t, { type: 'sine', freq: NOTE(72) * v, attack: 0.02, decay: 0.2, gain: 0.07 });
            tone(c, b, t + 0.08, { type: 'sine', freq: NOTE(79) * v, attack: 0.02, decay: 0.24, gain: 0.07 });
            return tone(c, b, t + 0.08, { type: 'sine', freq: NOTE(91) * v, attack: 0.03, decay: 0.18, gain: 0.025 });
        } },
        // A creature dies: a short crumble falling in pitch
        destroy: { vary: 60, cooldown: 120, maxVoices: 2, play: (c, b, t, o, v) => {
            noise(c, b, t, { type: 'lowpass', freq: 1600 * v, to: 220, q: 0.8, attack: 0.004, decay: 0.24, gain: 0.12 });
            return tone(c, b, t, { type: 'sine', freq: 110 * v, to: 60 * v, decay: 0.16, gain: 0.12 });
        } },
        // A pack is torn open: a short papery rip
        packRip: { vary: 30, cooldown: 400, maxVoices: 1, play: (c, b, t, o, v) => {
            for (let i = 0; i < 4; i++) noise(c, b, t + i * 0.045, { type: 'bandpass', freq: (1600 + i * 500) * v, q: 1.5, attack: 0.004, decay: 0.05, gain: 0.08 });
            return noise(c, b, t + 0.18, { type: 'highpass', freq: 2500, attack: 0.01, decay: 0.08, gain: 0.04 });
        } },
        // A card revealed: a soft flip; rarer cards add a rising arpeggio (o.rarity)
        reveal: { vary: 30, cooldown: 120, maxVoices: 2, play: (c, b, t, o, v) => {
            noise(c, b, t, { type: 'bandpass', freq: 3200, q: 1, attack: 0.002, decay: 0.035, gain: 0.06 });
            const notes = { rare: [72, 76, 79], epic: [72, 76, 79, 84], legendary: [72, 76, 79, 84, 88] }[o.rarity];
            if (!notes) return tone(c, b, t, { type: 'sine', freq: NOTE(81) * v, decay: 0.06, gain: 0.05 });
            const tb = timbre();
            notes.forEach((n, i) => tone(c, b, t + 0.03 + i * 0.065, { type: tb.type, filter: tb.filter, freq: NOTE(n), decay: 0.2, gain: 0.06 * tb.level }));
            let end = t + 0.03 + notes.length * 0.065 + 0.2;
            if (o.rarity === 'legendary') {
                [84, 88, 91].forEach(n => tone(c, b, end - 0.15, { type: 'sine', freq: NOTE(n), attack: 0.04, decay: 0.5, gain: 0.025 }));
                end += 0.4;
            }
            return end;
        } },
        // An achievement: a short three-note fanfare with a light chord tail
        achievement: { vary: 0, cooldown: 800, maxVoices: 1, play: (c, b, t) => {
            const tb = timbre();
            [67, 72, 76].forEach((n, i) => tone(c, b, t + i * 0.09, { type: tb.type, filter: tb.filter, freq: NOTE(n), decay: 0.14, gain: 0.07 * tb.level }));
            [72, 76, 79].forEach(n => tone(c, b, t + 0.27, { type: 'sine', freq: NOTE(n), attack: 0.03, decay: 0.45, gain: 0.035 }));
            return t + 0.78;
        } },
        // Victory: a major arpeggio into a held chord, about 1.3 s
        victory: { vary: 0, cooldown: 1500, maxVoices: 1, priority: true, play: (c, b, t) => {
            const tb = timbre();
            [60, 64, 67, 72].forEach((n, i) => tone(c, b, t + i * 0.1, { type: tb.type, filter: tb.filter, freq: NOTE(n), decay: 0.22, gain: 0.08 * tb.level }));
            [60, 64, 67, 72].forEach(n => tone(c, b, t + 0.42, { type: 'sine', freq: NOTE(n), attack: 0.04, decay: 0.85, gain: 0.04 }));
            return t + 1.33;
        } },
        // Defeat: a slow, soft falling minor line, about 1.3 s
        defeat: { vary: 0, cooldown: 1500, maxVoices: 1, priority: true, play: (c, b, t) => {
            [69, 65, 62].forEach((n, i) => tone(c, b, t + i * 0.18, { type: 'sine', freq: NOTE(n), attack: 0.02, decay: 0.3, gain: 0.08 }));
            tone(c, b, t + 0.54, { type: 'sine', freq: NOTE(50), attack: 0.05, decay: 0.75, gain: 0.07 });
            return t + 1.36;
        } },
        // Not allowed (not your turn, can't afford): two low soft blips
        deny: { vary: 0, cooldown: 300, maxVoices: 1, play: (c, b, t) => {
            tone(c, b, t, { type: 'square', filter: 600, freq: 180, decay: 0.04, gain: 0.05 });
            return tone(c, b, t + 0.07, { type: 'square', filter: 600, freq: 150, decay: 0.05, gain: 0.05 });
        } }
    };

    // Pitch variation has its own generator, so effects never consume the game's Math.random (deals, packs, AI)
    let variationSeed = 0x9e3779b9;
    function variation() {
        variationSeed ^= variationSeed << 13;
        variationSeed ^= variationSeed >>> 17;
        variationSeed ^= variationSeed << 5;
        return ((variationSeed >>> 0) % 10000) / 10000;
    }

    function pruneVoices(now) {
        for (let i = activeVoices.length - 1; i >= 0; i--) {
            if (activeVoices[i].end <= now) activeVoices.splice(i, 1);
        }
    }

    // Plays a cue. Returns true if it was scheduled; false if skipped (locked, muted, cooldown, too many voices).
    function play(name, options = {}) {
        const cue = CUES[name];
        if (!cue) return false;
        if (!ctx || ctx.state !== 'running') { count('dropped', `${name}:locked`); return false; }
        if (sfxLevel() <= 0) { count('dropped', `${name}:muted`); return false; }
        const nowMs = performance.now();
        if (nowMs - (lastPlayed[name] ?? -Infinity) < cue.cooldown) { count('dropped', `${name}:cooldown`); return false; }
        const t = ctx.currentTime + 0.005;
        pruneVoices(ctx.currentTime);
        const same = activeVoices.filter(v => v.cue === name).length;
        if (same >= cue.maxVoices) { count('dropped', `${name}:voices`); return false; }
        if (activeVoices.length >= MAX_VOICES) {
            if (!cue.priority) { count('dropped', `${name}:busy`); return false; }
            activeVoices.splice(0, activeVoices.length - MAX_VOICES + 1);
        }
        lastPlayed[name] = nowMs;
        const cents = cue.vary ? (variation() * 2 - 1) * cue.vary : 0;
        const v = Math.pow(2, cents / 1200);
        try {
            const end = cue.play(ctx, sfxGain, t, options, v);
            activeVoices.push({ cue: name, end });
            count('played', name);
            return true;
        } catch (_) {
            count('dropped', `${name}:error`);
            return false;
        }
    }

    // Silences effects still ringing (leaving a match for the menu)
    function stopAll() {
        if (!ctx || !sfxGain) return;
        const level = sfxLevel();
        sfxGain.gain.cancelScheduledValues(ctx.currentTime);
        sfxGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        sfxGain.gain.setTargetAtTime(level, ctx.currentTime + 0.15, 0.02);
        activeVoices.length = 0;
    }

    // Renders a cue offline (no speakers, no unlock needed): for tests and the sound board's measurements.
    async function renderCue(name, options = {}, seconds = 2) {
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const cue = CUES[name];
        if (!Offline || !cue) return null;
        const off = new Offline(1, Math.floor(44100 * seconds), 44100);
        const bus = buildBus(off, off.destination);
        bus.gain.value = options.volume ?? DEFAULTS.sfxVolume;
        const savedNoise = noiseBuffer;
        noiseBuffer = makeNoise(off);
        const end = cue.play(off, bus, 0.01, options, 1);
        noiseBuffer = savedNoise;
        const buffer = await off.startRendering();
        return { buffer, scheduledEnd: end };
    }

    // ---- Haptics: one guarded helper with brief patterns
    const HAPTIC_PATTERNS = {
        select: 8,
        toggle: 12,
        play: 15,
        impact: [22, 40, 30],
        reveal: 12,
        revealRare: [14, 40, 14, 40, 26],
        victory: [30, 60, 30, 60, 90],
        defeat: [60]
    };
    const HAPTIC_PRIORITY = ['victory', 'defeat', 'revealRare'];
    const HAPTIC_COOLDOWN = { select: 70, toggle: 100, play: 120, impact: 450, reveal: 150, revealRare: 500, victory: 2000, defeat: 2000 };
    const lastHaptic = {};
    let lastAnyHaptic = -Infinity;
    const hapticStats = { sent: {}, skipped: {} };
    const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

    function haptic(kind) {
        const pattern = HAPTIC_PATTERNS[kind];
        const skip = why => { hapticStats.skipped[`${kind}:${why}`] = (hapticStats.skipped[`${kind}:${why}`] || 0) + 1; return false; };
        if (pattern === undefined) return skip('unknown');
        if (!settings.haptics) return skip('off');
        if (!hapticsSupported()) return skip('unsupported');
        if (document.hidden) return skip('hidden');
        // A real touch, click or key seen by the game (unlock), and the browser agrees the page was used
        const activated = gestureSeen && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true);
        if (!activated) return skip('no-gesture');
        const now = performance.now();
        if (now - (lastHaptic[kind] ?? -Infinity) < HAPTIC_COOLDOWN[kind]) return skip('cooldown');
        // Within 50 ms of another buzz only the big moments get through (a win right after the attack buzz)
        if (now - lastAnyHaptic < 50 && !HAPTIC_PRIORITY.includes(kind)) return skip('busy');
        // Reduced motion: one short pulse at most, never a pattern
        const send = prefersReducedMotion() ? Math.min(12, Array.isArray(pattern) ? pattern[0] : pattern) : pattern;
        lastHaptic[kind] = now;
        lastAnyHaptic = now;
        try {
            const ok = navigator.vibrate(send);
            hapticStats.sent[kind] = (hapticStats.sent[kind] || 0) + 1;
            return ok;
        } catch (_) {
            return skip('error');
        }
    }

    window.GameFeedback = {
        unlock,
        play,
        stopAll,
        haptic,
        renderCue,
        cues: Object.keys(CUES),
        settings,
        setSetting,
        onSettingsChange: fn => listeners.push(fn),
        hapticsSupported,
        get state() { return ctx ? ctx.state : (AudioCtor ? 'locked' : 'unsupported'); },
        stats: () => ({ played: { ...stats.played }, dropped: { ...stats.dropped }, haptics: JSON.parse(JSON.stringify(hapticStats)), voices: activeVoices.length })
    };
})();
