    // One writer per origin/profile. Other tabs can inspect/play, but cannot overwrite saves.
    let profileWriteState = 'pending';
    let profileSavedRaw = null;
    let profileRepairBlocked = false;
    function persistenceNotice(message, retry = false) {
        let el = document.getElementById('persistenceNotice');
        if (!el) {
            el = document.createElement('div'); el.id = 'persistenceNotice';
            el.setAttribute('role', 'alert');
            el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:30000;padding:8px;background:#29212b;color:white;text-align:center;font:14px sans-serif';
            document.body.appendChild(el);
        }
        el.textContent = message;
        if (retry) {
            const button = document.createElement('button'); button.textContent = 'Retry saving';
            button.addEventListener('click', () => saveStats());
            el.append(' ', button);
        }
    }
    function canSaveProfile() {
        if (profileWriteState === 'writer' && !profileRepairBlocked) return true;
        persistenceNotice(profileWriteState === 'reader'
            ? 'Another tab owns this profile. Progress here is not saved. Close the other tab and reload here to save.'
            : 'Progress could not be saved. Storage is unavailable or the original save needs recovery. Keep this tab open.');
        return false;
    }

    // Gameplay has its own seeded stream. Presentation code may use Math.random freely
    // without moving deck, AI, target or reward decisions. A replay can reset this seed.
    let gameplayRandomState = (Math.random() * 4294967296) >>> 0;
    function setGameplaySeed(seed) { gameplayRandomState = seed >>> 0; }
    function gameplayRandom() {
        gameplayRandomState = (gameplayRandomState + 0x6D2B79F5) | 0;
        let t = Math.imul(gameplayRandomState ^ (gameplayRandomState >>> 15), 1 | gameplayRandomState);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    // Instance identity is runtime-only, never a random gameplay decision.
    let cardInstanceSequence = 1000000;
    function nextCardInstanceId() { return ++cardInstanceSequence; }

    // QA tooling is off for players. Add ?qa=1 to the URL (or set localStorage emojiElementsQA = '1') to turn
    // on the [QA] console logs, error echoing, DOM/perf checks and the window.__qa* helpers that
    // tests/smoke.mjs uses (QA_REPORT.md). Automated suites live in tests/.
    const QA_MODE = (() => {
        try {
            return new URLSearchParams(window.location.search).has('qa') || localStorage.getItem('emojiElementsQA') === '1';
        } catch (_) {
            return false;
        }
    })();
    const QA_DEBUG = QA_MODE;
    const META_STORAGE_KEY = QA_MODE ? 'emoji_elements_meta_qa_v1' : 'emoji_elements_meta_v1';
    const LEGACY_STATS_STORAGE_KEY = QA_MODE ? 'emojiElementsStatsQA' : 'emojiElementsStats';

    window.__QA_FORCE_META_OFF = false;

    if (QA_MODE) {
        window.addEventListener('error', (event) => {
            const runtimeError = event?.error;
            const message = event?.message || runtimeError?.message || 'Unknown error';
            const stack = runtimeError?.stack || 'No stack trace available';
            console.error('[QA]', message, stack);
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event?.reason;
            const message = reason?.message || String(reason);
            const stack = reason?.stack || 'No stack trace available';
            console.error('[QA]', message, stack);
        });

        // Quick manual QA checks:
        // 1) Load page -> confirm no red errors.
        // 2) Start match -> confirm no red errors.
    }

    // Music stays on HTML media elements; GameFeedback owns the SFX, haptics and saved controls.
    // Variations wait for a match to need them, so they never start over the intro or main menu.
    function battleVariation(file) {
        const media = new Audio();
        media.preload = 'none';
        media.src = file;
        return media;
    }
    const audioSystem = {
        startMenuMusic: new Audio('minimalist menu theme.mp3'),
        gameplayMusic: new Audio('Emoji Elements - Celestial Battle Theme.mp3'),
        winningMusic: battleVariation('Emoji Elements - Winning Battle Theme.mp3'),
        losingMusic: battleVariation('Emoji Elements - Losing Battle Theme.mp3')
    };

    audioSystem.startMenuMusic.loop = true;
    const BATTLE_TRACKS = ['gameplayMusic', 'winningMusic', 'losingMusic'];
    BATTLE_TRACKS.forEach(name => { audioSystem[name].loop = true; });
    Object.values(audioSystem).forEach(audio => GameFeedback.setMusicLevel(audio, 0));

    const soundSettings = GameFeedback.settings;

    // Background headroom keeps effects in front; saved slider preferences are preserved.
    const MUSIC_MIX_GAIN = 0.45;
    const activeAudioFades = new WeakMap();
    const backgroundPausedMusic = new Set();
    let battleMusicKey = 'gameplayMusic';
    let battleMusicPending = null;
    let battleMusicSerial = 0;
    const unavailableBattleTracks = new Set();

    // The old effect names, as cues (feedback.js). Callers that know more (a summon's theme, a reveal's rarity,
    // how much life changed) call GameFeedback.play directly.
    const SFX_CUES = {
        menuOpen: 'open',
        menuClose: 'close',
        select: 'select',
        tapLand: 'landTap',
        untap: 'turnStart',
        cardDestroyed: 'destroy',
        attack: 'attack',
        block: 'block',
        gameVictory: 'victory',
        gameLose: 'defeat'
    };

    // Music (with loop) on its media element; any other name is a sound effect cue
    function playSFX(soundName, loop = false) {
        if (!audioSystem[soundName]) {
            const cue = SFX_CUES[soundName];
            if (cue) GameFeedback.play(cue);
            return;
        }
        try {
            audioSystem[soundName].currentTime = 0;
            audioSystem[soundName].loop = loop;
            if (document.hidden) {
                backgroundPausedMusic.add(audioSystem[soundName]);
                return;
            }
            const playPromise = audioSystem[soundName].play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.debug('Audio play blocked or failed:', e?.name || e));
            }
        } catch (e) {
            console.log('Audio error:', e);
        }
    }

    // Helper function to stop sound
    function stopSFX(soundName) {
        if (SFX_CUES[soundName]) {
            GameFeedback.stopAll();
            return;
        }
        if (audioSystem[soundName]) {
            backgroundPausedMusic.delete(audioSystem[soundName]);
            // A previous transition must not restore volume or stop a newly started session later.
            const fade = activeAudioFades.get(audioSystem[soundName]);
            if (fade) clearInterval(fade);
            activeAudioFades.delete(audioSystem[soundName]);
            try {
                audioSystem[soundName].pause();
                audioSystem[soundName].currentTime = 0;
            } catch (e) {
                console.log('Audio stop error:', e);
            }
        }
    }


    // Sound and haptics settings (GameFeedback.settings, saved per device, never in the profile). The header 🔊 is
    // the master mute. The pause panel and the menu's Sound dialog draw the same rows (renderSoundSettings).
    function applyMuteState() {
        const musicMuted = soundSettings.muted || soundSettings.musicOff;
        Object.values(audioSystem).forEach(audio => { audio.muted = musicMuted; });
        // Active fades resolve their target from current settings; idle tracks update immediately.
        Object.values(audioSystem).forEach(audio => {
            if (!activeAudioFades.has(audio)) GameFeedback.setMusicLevel(audio, musicTarget(audio));
        });

        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.textContent = soundSettings.muted ? '🔇' : '🔊';
            muteBtn.title = soundSettings.muted ? 'Unmute sound' : 'Mute sound';
            muteBtn.setAttribute('aria-pressed', String(soundSettings.muted));
        }
        const intro = document.getElementById('introVideo');
        if (intro && soundSettings.muted) intro.muted = true;
        syncSoundSettings();
    }

    GameFeedback.onSettingsChange(() => applyMuteState());

    function toggleMute() {
        GameFeedback.setSetting('muted', !soundSettings.muted);
        // The pause menu's switch already shows it
        if (!gamePaused) showGameLog(soundSettings.muted ? '🔇 Sound muted' : '🔊 Sound enabled', false);
    }

    function toggleMusic() {
        GameFeedback.setSetting('musicOff', !soundSettings.musicOff);
    }

    function toggleSfx() {
        GameFeedback.setSetting('sfxOff', !soundSettings.sfxOff);
        GameFeedback.play('select');
    }

    function toggleHaptics() {
        if (!GameFeedback.hapticsSupported()) return;
        GameFeedback.setSetting('haptics', !soundSettings.haptics);
        haptic('toggle');
    }

    // One guarded entry point for vibration (feedback.js): kind is select, toggle, play, impact, reveal,
    // revealRare, victory or defeat
    function haptic(kind) {
        return GameFeedback.haptic(kind);
    }

    // Quick land taps step up in pitch a little (up to 4 steps), so tapping a row of lands sounds like a run
    let landTapRun = { step: 0, at: -Infinity };
    function playLandTap() {
        const now = performance.now();
        landTapRun = { step: now - landTapRun.at < 700 ? Math.min(4, landTapRun.step + 1) : 0, at: now };
        GameFeedback.play('landTap', { step: landTapRun.step });
    }

    const SOUND_ROWS = [
        { key: 'muted', id: 'Sound', icon: '🔊', label: 'Sound', note: 'Everything: music and effects', on: () => !soundSettings.muted, toggle: 'toggleMute()' },
        { key: 'musicOff', id: 'Music', icon: '🎵', label: 'Music', note: 'Menu and battle music', on: () => !soundSettings.musicOff, toggle: 'toggleMusic()', volume: 'musicVolume' },
        { key: 'sfxOff', id: 'Sfx', icon: '✨', label: 'Effects', note: 'Cards, combat and menus', on: () => !soundSettings.sfxOff, toggle: 'toggleSfx()', volume: 'sfxVolume' },
        { key: 'haptics', id: 'Haptics', icon: '📳', label: 'Haptics', note: 'Short buzzes for plays, hits, rare cards and wins', on: () => soundSettings.haptics, toggle: 'toggleHaptics()' }
    ];

    function renderSoundSettings(container, prefix) {
        if (!container || container.dataset.rendered) return;
        container.dataset.rendered = '1';
        const anchor = container.querySelector('.pause-theme-btn');
        SOUND_ROWS.forEach(row => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pause-switch-row';
            button.id = `${prefix}${row.id}Switch`;
            button.setAttribute('role', 'switch');
            button.setAttribute('onclick', row.toggle);
            button.dataset.soundRow = row.id;
            button.innerHTML = `
                <span class="pause-row-icon" aria-hidden="true">${row.icon}</span>
                <span class="pause-row-text"><span class="pause-row-label">${row.label}</span><span class="pause-row-note" id="${prefix}${row.id}Note">${row.note}</span></span>
                <span class="pause-switch" aria-hidden="true"></span>`;
            button.setAttribute('aria-describedby', `${prefix}${row.id}Note`);
            container.insertBefore(button, anchor);
            if (row.volume) {
                const slider = document.createElement('label');
                slider.className = 'pause-volume-row';
                slider.dataset.soundVolume = row.volume;
                slider.innerHTML = `
                    <span class="pause-volume-label">${row.label} volume</span>
                    <input type="range" min="0" max="100" step="5" id="${prefix}${row.id}Volume">
                    <output class="pause-volume-value" for="${prefix}${row.id}Volume"></output>`;
                const input = slider.querySelector('input');
                input.addEventListener('input', () => GameFeedback.setSetting(row.volume, Number(input.value) / 100));
                // A sample of the new effects level when the slider is let go
                if (row.volume === 'sfxVolume') input.addEventListener('change', () => GameFeedback.play('select'));
                container.insertBefore(slider, anchor);
            }
        });
        syncSoundSettings();
    }

    function syncSoundSettings() {
        const supported = GameFeedback.hapticsSupported();
        document.querySelectorAll('[data-sound-row]').forEach(button => {
            const row = SOUND_ROWS.find(r => r.id === button.dataset.soundRow);
            const unavailable = row.key === 'haptics' && !supported;
            // Music and Effects follow the master switch
            const blocked = soundSettings.muted && (row.key === 'musicOff' || row.key === 'sfxOff');
            button.setAttribute('aria-checked', String(row.on() && !unavailable && !blocked));
            button.disabled = unavailable || blocked;
            if (row.key === 'haptics') {
                const note = button.querySelector('.pause-row-note');
                if (note) note.textContent = supported ? row.note : 'Not available on this device';
            }
        });
        document.querySelectorAll('[data-sound-volume]').forEach(label => {
            const key = label.dataset.soundVolume;
            const value = Math.round(soundSettings[key] * 100);
            const input = label.querySelector('input');
            if (Number(input.value) !== value) input.value = value;
            input.setAttribute('aria-valuetext', `${value}%`);
            label.querySelector('output').textContent = `${value}%`;
            const channelOff = soundSettings.muted || (key === 'musicVolume' ? soundSettings.musicOff : soundSettings.sfxOff);
            label.hidden = channelOff;
        });
    }

    function showSoundSettings() {
        renderSoundSettings(document.getElementById('menuSoundSettings'), 'menu');
        playSFX('menuOpen');
        document.getElementById('soundDialog').classList.add('show');
    }

    function hideSoundSettings() {
        playSFX('menuClose');
        document.getElementById('soundDialog').classList.remove('show');
    }

    function initializeButtonTypes() {
        document.querySelectorAll('button:not([type])').forEach((button) => {
            button.type = 'button';
        });
    }

    function qaAssertDomIds(ids = []) {
        if (!QA_MODE || !Array.isArray(ids)) return;

        ids.forEach((id) => {
            if (typeof id !== 'string' || !id) return;
            if (!document.getElementById(id)) {
                console.warn('[QA] missing DOM id:', id);
            }
        });
    }

    function getCardTooltipText(card) {
        const stats = card.type === 'creature' ? ` • ${card.power}/${card.toughness}` : '';
        return `${card.emoji} ${card.name}${stats}`;
    }

    function showCardHoverTooltip(text, event) {
        if (isMobile || hoverTooltipPinned || !event) return;
        const tooltip = document.getElementById('cardHoverTooltip');
        if (!tooltip) return;

        tooltip.textContent = text;
        const offset = 14;
        const width = tooltip.offsetWidth || 180;
        const height = tooltip.offsetHeight || 40;
        let x = event.clientX + offset;
        let y = event.clientY - height - offset;

        if (x + width > window.innerWidth - 10) x = window.innerWidth - width - 10;
        if (y < 10) y = event.clientY + offset;

        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.classList.add('show');
    }

    function hideCardHoverTooltip() {
        if (hoverTooltipPinned) return;
        const tooltip = document.getElementById('cardHoverTooltip');
        if (tooltip) tooltip.classList.remove('show');
    }

    // One input path for every card on touch, mouse and keyboard (UI.md):
    //   tap / click / Enter / Space  → onTap
    //   long-press / right-click / I → onLongPress (inspect, or "tap all" on a land stack)
    // A long-press never also triggers onTap, a touch never fires twice (touch end + synthetic click),
    // and dragging a finger to scroll a row does nothing.
    const LONG_PRESS_MS = 400;

    // Input modality. Space/Enter press a focused card or button only when the player got there with Tab;
    // after a click or tap, Space and Enter keep their shortcut meaning (Space = END TURN), as before.
    let lastInputWasPointer = true;
    document.addEventListener('pointerdown', () => { lastInputWasPointer = true; }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab') lastInputWasPointer = false; }, true);

    let cardInteractionDepth = 0;
    function cardInteraction(fn, trusted) {
        if (!trusted) return fn?.();
        cardInteractionDepth++;
        try { return fn?.(); } finally { cardInteractionDepth--; }
    }

    function bindCardPress(el, { onTap, onLongPress, label }) {
        let timer = null;
        let start = null;
        let longPressed = false;

        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        if (label) el.setAttribute('aria-label', label);

        const cancel = () => {
            clearTimeout(timer);
            start = null;
        };

        el.addEventListener('pointerdown', (e) => {
            longPressed = false;
            if (e.pointerType === 'mouse') return;
            start = { x: e.clientX, y: e.clientY, trusted: e.isTrusted };
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!start || !el.isConnected || (el.closest('#gameContainer') && (gamePaused || gameState.matchFinalized))) return;
                longPressed = true;
                const trusted = start.trusted;
                start = null;
                haptic('select');
                cardInteraction(onLongPress, trusted);
            }, LONG_PRESS_MS);
        });
        el.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
        });
        el.addEventListener('pointerup', cancel);
        el.addEventListener('pointercancel', cancel);
        el.addEventListener('pointerleave', cancel);
        el.addEventListener('click', (e) => {
            if (longPressed) {
                longPressed = false;
                e.preventDefault();
                return;
            }
            cardInteraction(onTap, e.isTrusted);
        });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (longPressed) return; // the long-press already acted
            cardInteraction(onLongPress, e.isTrusted);
        });
        el.addEventListener('keydown', (e) => {
            // Only when the card was reached with the keyboard: after a mouse click, Space stays END TURN.
            if ((e.key === 'Enter' || e.key === ' ') && !lastInputWasPointer) {
                e.preventDefault();
                e.stopPropagation();
                cardInteraction(onTap, e.isTrusted);
            } else if (e.key === 'i' || e.key === 'I' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                e.stopPropagation();
                cardInteraction(onLongPress, e.isTrusted);
            }
        });
    }

    // Screen-reader / keyboard name for a card on screen.
    function describeCardForA11y(card, zone) {
        const parts = [card.name];
        if (card.type === 'creature') parts.push(`${card.power}/${card.toughness}${card.damage ? `, ${card.damage} damage` : ''}`);
        else parts.push(card.type === 'instant' ? 'instant' : card.type);
        if (zone === 'hand' && card.cost && Object.keys(card.cost).length) {
            parts.push(`costs ${Object.entries(card.cost).map(([el, n]) => `${n} ${el}`).join(' and ')}`);
        }
        if (card.tapped) parts.push('tapped');
        if (card.summoningSick && card.type === 'creature' && zone === 'board') parts.push('summoning sick');
        return parts.join(', ');
    }

    // updateUI rebuilds the card rows; keep keyboard focus on the same slot so keyboard play can continue.
    function captureRowFocus() {
        const active = document.activeElement;
        const row = active?.closest?.('#playerHand, #playerBoard, #enemyBoard');
        if (!row) return null;
        const item = [...row.children].find(child => child === active || child.contains(active));
        return { rowId: row.id, index: [...row.children].indexOf(item) };
    }

    function restoreRowFocus(saved) {
        if (!saved) return;
        const row = document.getElementById(saved.rowId);
        const items = row ? [...row.children] : [];
        const target = items[Math.min(Math.max(saved.index, 0), items.length - 1)] ||
            document.getElementById('endTurnBtn');
        target?.focus({ preventScroll: true });
    }

    function attachDesktopTooltip(target, card) {
        if (!target || !card || isMobile) return;

        target.addEventListener('mouseenter', (e) => {
            showCardHoverTooltip(getCardTooltipText(card), e);
        });
        target.addEventListener('mousemove', (e) => {
            showCardHoverTooltip(getCardTooltipText(card), e);
        });
        target.addEventListener('mouseleave', () => {
            hideCardHoverTooltip();
        });
    }

    function applyJuice(el, className, ms = 450) {
        if (!el || !className) return;

        try {
            el.classList.remove(className);
            void el.offsetWidth;
            el.classList.add(className);
            const serial = matchSerial;
            setTimeout(() => {
                if (serial !== matchSerial) return;
                try {
                    el.classList.remove(className);
                } catch (_) {
                    // no-op
                }
            }, ms);
        } catch (_) {
            // no-op
        }
    }

    // prefers-reduced-motion: no shaking, particles or sparkles (styles.css stops CSS animation).
    const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function prefersReducedMotion() {
        return !!reducedMotionQuery?.matches;
    }

    function screenShake(intensity = 'med') {
        if (prefersReducedMotion()) return;
        const el = document.body || document.querySelector('.game-container');
        if (!el) return;

        const durationMap = {
            low: 180,
            med: 250,
            high: 320
        };

        try {
            applyJuice(el, 'screen-shake', durationMap[intensity] || durationMap.med);
        } catch (_) {
            // no-op
        }
    }

    function spawnFloatingNumber({ targetEl, text, kind } = {}) {
        if (!targetEl) return;

        try {
            const rect = targetEl.getBoundingClientRect();
            if (!rect || (!rect.width && !rect.height)) return;

            const floater = document.createElement('div');
            floater.className = 'floating-dmg';
            floater.textContent = text ?? '';

            if (kind) {
                floater.classList.add(`floating-dmg-${kind}`);
            }

            floater.style.left = `${rect.left + rect.width / 2}px`;
            floater.style.top = `${rect.top + rect.height / 2}px`;

            document.body.appendChild(floater);
            let removed = false;
            const cleanup = () => {
                if (removed) return;
                removed = true;
                try {
                    floater.remove();
                } catch (_) {
                    // no-op
                }
            };

            floater.addEventListener('animationend', cleanup, { once: true });
            setTimeout(cleanup, 900);
        } catch (_) {
            // no-op
        }
    }

    function qaWarnDomPressure(context = '') {
        if (!QA_MODE) return;

        const overlays = document.querySelectorAll('.victory-overlay.show, .lose-overlay.show, .match-reward-overlay.show, .pack-opening-overlay.show, .guide-overlay[style*="display: flex"]');
        const floaters = document.querySelectorAll('.floating-dmg');

        if (overlays.length > 3) {
            console.warn(`[QA PERF] ${context} overlay pressure high:`, overlays.length);
        }

        if (floaters.length > 24) {
            console.warn(`[QA PERF] ${context} floating elements lingering:`, floaters.length);
        }
    }

    function runQAPerfBurst() {
        if (!QA_MODE) return;

        const targetEl = document.getElementById('playerLife') || document.getElementById('enemyLife');
        if (!targetEl) {
            console.warn('[QA PERF] Missing life target for burst test.');
            return;
        }

        const frameDeltas = [];
        let frames = 0;
        const maxFrames = 30;
        let lastTs = performance.now();

        const captureFrame = (ts) => {
            frameDeltas.push(ts - lastTs);
            lastTs = ts;
            frames += 1;

            if (frames < maxFrames) {
                requestAnimationFrame(captureFrame);
                return;
            }

            const avg = frameDeltas.reduce((acc, delta) => acc + delta, 0) / frameDeltas.length;
            const peak = Math.max(...frameDeltas);
            console.log(`[QA PERF] Burst frame timing avg=${avg.toFixed(2)}ms peak=${peak.toFixed(2)}ms samples=${frameDeltas.length}`);
            qaWarnDomPressure('burst-end');
        };

        requestAnimationFrame(captureFrame);

        for (let i = 0; i < 20; i++) {
            setTimeout(() => {
                spawnFloatingNumber({
                    targetEl,
                    text: `-${(i % 5) + 1}`,
                    kind: 'damage'
                });
            }, i * 12);
        }

        setTimeout(() => qaWarnDomPressure('post-cleanup'), 1100);
    }

    if (QA_MODE) {
        window.__qaPerfBurst = runQAPerfBurst;
    }

    // Helper function to fade audio volume in or out over a duration
    function fadeAudio(audioElement, targetVolume, duration, callback) {
        const existingFade = activeAudioFades.get(audioElement);
        if (existingFade) {
            clearInterval(existingFade);
        }

        const steps = 20;
        const interval = duration / steps;
        const startVolume = GameFeedback.getMusicLevel(audioElement);
        const target = () => typeof targetVolume === 'function' ? targetVolume() : targetVolume;
        let currentStep = 0;

        const fade = setInterval(() => {
            currentStep++;
            GameFeedback.setMusicLevel(audioElement, startVolume + (target() - startVolume) * currentStep / steps);
            if (currentStep >= steps) {
                clearInterval(fade);
                activeAudioFades.delete(audioElement);
                GameFeedback.setMusicLevel(audioElement, target());
                if (callback) callback();
            }
        }, interval);

        activeAudioFades.set(audioElement, fade);
    }

    function musicTarget(audio) {
        return soundSettings.musicVolume * MUSIC_MIX_GAIN *
            (gamePaused && BATTLE_TRACKS.some(name => audio === audioSystem[name]) ? 0.4 : 1);
    }

    function isAudioPlaying(audioElement) {
        return !!audioElement && !audioElement.paused && !audioElement.ended;
    }

    function ensureStartMenuMusic() {
        stopBattleMusic();

        if (!isAudioPlaying(audioSystem.startMenuMusic)) {
            GameFeedback.setMusicLevel(audioSystem.startMenuMusic, 0);
            playSFX('startMenuMusic', true);
        }

        fadeAudio(audioSystem.startMenuMusic, () => musicTarget(audioSystem.startMenuMusic), 800);
    }

    function transitionToGameplayMusic() {
        stopBattleMusic();
        fadeAudio(audioSystem.startMenuMusic, 0, 500, () => {
            stopSFX('startMenuMusic');
        });

        if (!isAudioPlaying(audioSystem.gameplayMusic)) {
            GameFeedback.setMusicLevel(audioSystem.gameplayMusic, 0);
            playSFX('gameplayMusic', true);
        }

        fadeAudio(audioSystem.gameplayMusic, () => musicTarget(audioSystem.gameplayMusic), 800);
    }

    function stopBattleMusic() {
        battleMusicSerial++;
        battleMusicPending = null;
        battleMusicKey = 'gameplayMusic';
        BATTLE_TRACKS.forEach(stopSFX);
        document.getElementById('gameContainer')?.removeAttribute('data-battle-mood');
    }

    // A seven-point life lead changes the score; keep it until the lead shrinks to three.
    // The gap avoids a new track on every small heal or attack near the boundary.
    function desiredBattleMusic() {
        const lead = gameState.playerLife - gameState.enemyLife;
        if (lead >= 7 || (battleMusicKey === 'winningMusic' && lead > 3)) return 'winningMusic';
        if (lead <= -7 || (battleMusicKey === 'losingMusic' && lead < -3)) return 'losingMusic';
        return 'gameplayMusic';
    }

    function updateBattleMusicMood() {
        const board = document.getElementById('gameContainer');
        if (gameState.matchFinalized || gamePaused || document.hidden || board?.style.display !== 'flex' || battleMusicPending) return;
        const nextKey = desiredBattleMusic();
        if (nextKey === battleMusicKey || unavailableBattleTracks.has(nextKey)) return;
        const oldKey = battleMusicKey;
        const current = audioSystem[oldKey];
        const next = audioSystem[nextKey];
        const serial = ++battleMusicSerial;
        battleMusicPending = nextKey;
        GameFeedback.setMusicLevel(next, 0);
        // The recordings share an approximately 174-second arrangement. Start at the same
        // musical position and crossfade without ever waiting on media to update the game.
        try {
            const duration = next.duration;
            next.currentTime = Number.isFinite(duration) && duration > 0
                ? Math.min(current.currentTime % duration, duration - 0.25) : current.currentTime;
        } catch (_) { /* a decoder may not have metadata yet: the fade still works */ }
        try {
            Promise.resolve(next.play()).then(() => {
                if (serial !== battleMusicSerial) return;
                battleMusicPending = null;
                if (gameState.matchFinalized || gamePaused || document.hidden || board.style.display !== 'flex' || desiredBattleMusic() !== nextKey) {
                    stopSFX(nextKey);
                    updateBattleMusicMood();
                    return;
                }
                BATTLE_TRACKS.filter(name => name !== oldKey && name !== nextKey).forEach(stopSFX);
                battleMusicKey = nextKey;
                board.dataset.battleMood = nextKey === 'gameplayMusic' ? 'neutral' : nextKey === 'winningMusic' ? 'winning' : 'losing';
                fadeAudio(current, 0, 1800, () => {
                    if (serial === battleMusicSerial) stopSFX(oldKey);
                });
                fadeAudio(next, () => musicTarget(next), 1800);
            }).catch(() => {
                if (serial !== battleMusicSerial) return;
                battleMusicPending = null;
                unavailableBattleTracks.add(nextKey);
                stopSFX(nextKey);
            });
        } catch (_) {
            battleMusicPending = null;
            unavailableBattleTracks.add(nextKey);
            stopSFX(nextKey);
        }
    }

    // Game State
    const gameState = {
        playerLife: 20,
        enemyLife: 20,
        playerMana: {},
        enemyMana: {},
        playerHand: [],
        playerBoard: [],
        playerDeck: [],
        playerGraveyard: [],  // Graveyard for destroyed creatures
        enemyHand: [],
        enemyBoard: [],
        enemyDeck: [],
        enemyGraveyard: [],  // Enemy graveyard
        selectedCard: null,
        selectedElements: [],
        deckMode: 'dual',
        phase: 'main',
        turn: 'player',
        attackers: [],
        blockers: {},
        difficulty: 'easy',
        previousPlayerLife: 20,
        previousEnemyLife: 20,
        landsPlayedThisTurn: 0,  // Track lands played to enforce one land per turn rule
        hasAttackedThisTurn: false,  // VIGILANCE FIX: Prevent multiple attacks per turn
        playerDeckedOut: false,  // Set when a player has to draw from an empty deck (RULES.md R6.1)
        enemyDeckedOut: false,
        matchFinalized: false
    };

    // Stats tracking
    let gameStats = {
        wins: 0,
        losses: 0,
        total: 0
    };

    const META_ENABLED = true;

    function isMetaRuntimeEnabled() {
        return META_ENABLED && !window.__QA_FORCE_META_OFF;
    }

    // Load stats from localStorage
    function loadStats() {
        if (!isMetaRuntimeEnabled()) {
            return;
        }

        let savedMeta;
        try { savedMeta = localStorage.getItem(META_STORAGE_KEY); } catch (_) { return; }
        if (savedMeta) {
            try {
                const parsedMeta = JSON.parse(savedMeta);
                if (parsedMeta && parsedMeta.stats) {
                    gameStats = {
                        wins: Number.isFinite(parsedMeta.stats.wins) ? parsedMeta.stats.wins : 0,
                        losses: Number.isFinite(parsedMeta.stats.losses) ? parsedMeta.stats.losses : 0,
                        total: (Number.isFinite(parsedMeta.stats.wins) ? parsedMeta.stats.wins : 0) +
                               (Number.isFinite(parsedMeta.stats.losses) ? parsedMeta.stats.losses : 0)
                    };
                    return;
                }
            } catch (error) {
                console.warn('Invalid meta stats, falling back to legacy stats.', error);
            }
        }

        let saved;
        try { saved = localStorage.getItem(LEGACY_STATS_STORAGE_KEY); } catch (_) { return; }
        if (!saved) {
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(saved);
        } catch (error) {
            console.warn('Invalid saved stats, resetting.', error);
            return;
        }
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        gameStats = {
            wins: Number.isFinite(parsed.wins) ? parsed.wins : 0,
            losses: Number.isFinite(parsed.losses) ? parsed.losses : 0,
            total: Number.isFinite(parsed.total) ? parsed.total : 0
        };
    }

    function saveStats() {
        if (isMetaRuntimeEnabled() && gameMeta && gameMeta.stats) {
            try {
                gameMeta.stats.wins = Number.isFinite(gameStats.wins) ? gameStats.wins : 0;
                gameMeta.stats.losses = Number.isFinite(gameStats.losses) ? gameStats.losses : 0;
                gameMeta.stats.packsOpened = Number.isFinite(gameMeta.stats.packsOpened) ? gameMeta.stats.packsOpened : 0;
                if (!metaSave(gameMeta)) return false;
            } catch (error) {
                console.warn('Meta save hook failed while saving stats. Proceeding with baseline stats save.', error);
            }
        }
        if (isMetaRuntimeEnabled() && profileWriteState === 'writer' && !profileRepairBlocked) {
            const achievementsSaved = window.Achievements?.flush();
            if (achievementsSaved !== false) document.getElementById('persistenceNotice')?.remove();
            try { localStorage.setItem(LEGACY_STATS_STORAGE_KEY, JSON.stringify(gameStats)); } catch (_) { /* meta is authoritative */ }
        }
    }

    loadStats();

    // Detect iOS devices
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    let hoverTooltipPinned = false;

    // Intro / startup sequence state
    let startupState = 'awaiting-click';

    // Intro Video Logic with Click to Start
    window.addEventListener('DOMContentLoaded', () => {
        if (QA_MODE) {
            const requiredQaDomIds = [
                // start / menu screens
                'clickToStart',
                'introContainer',
                'introVideo',
                'startModal',
                'mainMenu',
                'startBtn',
                // deck builder
                'deckBuilderScreen',
                'deckBuilderDeckKey',
                'deckBuilderPool',
                'deckBuilderDeck',
                'deckBuilderStatus',
                // pack opening
                'packOpeningOverlay',
                'packCardViewport',
                // victory / how-to-play
                'victoryOverlay',
                'howToPlayScreen',
                'howToPlayPageIndicator'
            ];

            const optionalQaDomIds = [];

            // Pack shop + credits badge are optional as a feature set.
            if (document.getElementById('packShopScreen')) {
                optionalQaDomIds.push('packShopScreen', 'shopCreditsBadge');
            }

            // Binder / collection UI varies by build; only assert known IDs when present.
            ['binderScreen', 'collectionScreen', 'binderOverlay', 'collectionModal'].forEach((id) => {
                if (document.getElementById(id)) {
                    optionalQaDomIds.push(id);
                }
            });

            qaAssertDomIds([...requiredQaDomIds, ...optionalQaDomIds]);
        }

        const clickToStart = document.getElementById('clickToStart');
        const introContainer = document.getElementById('introContainer');
        const introVideo = document.getElementById('introVideo');
        const introSkipHint = introContainer.querySelector('.intro-skip-hint');
        const startModal = document.getElementById('startModal');
        const INTRO_MAX_DURATION_MS = 15000;
        const INTRO_VIDEO_START_TIMEOUT_MS = 3000;
        let introSkipped = false;
        let introTimeoutId = null;
        let introStartWatchdogId = null;

        function clearIntroTimers() {
            if (introTimeoutId) {
                clearTimeout(introTimeoutId);
                introTimeoutId = null;
            }
            if (introStartWatchdogId) {
                clearTimeout(introStartWatchdogId);
                introStartWatchdogId = null;
            }
        }

        function showStartMenu() {
            startupState = 'menu';
            clearIntroTimers();

            clickToStart.style.display = 'none';
            clickToStart.style.pointerEvents = 'none';

            introContainer.classList.remove('hidden');
            introContainer.style.display = 'none';

            startModal.style.display = 'flex';
            requestAnimationFrame(() => {
                startModal.classList.add('modal-visible');
            });

            ensureStartMenuMusic();
        }

        function stopAndResetIntroVideo() {
            try {
                introVideo.pause();
                introVideo.currentTime = 0;
                introVideo.volume = 0;
            } catch (e) {
                console.log('Video stop error:', e);
            }
        }

        function skipIntro() {
            if (introSkipped || startupState === 'menu') {
                return;
            }
            introSkipped = true;
            startupState = 'skipping-intro';
            clearIntroTimers();
            stopAndResetIntroVideo();

            introContainer.classList.add('hidden');
            setTimeout(() => {
                showStartMenu();
            }, 250);
        }

        function markIntroAsPlaying() {
            if (startupState === 'starting-intro') {
                startupState = 'playing-intro';
            }
            setTimeout(() => {
                clickToStart.style.display = 'none';
            }, 150);
        }

        function beginIntroSequence() {
            if (startupState !== 'awaiting-click') {
                return;
            }

            startupState = 'starting-intro';
            introSkipped = false;

            clickToStart.style.opacity = '0';
            clickToStart.style.pointerEvents = 'none';

            // Reduced motion: no intro animation. The tap still unlocks audio for the menu music.
            if (prefersReducedMotion()) {
                skipIntro();
                return;
            }

            introContainer.classList.remove('hidden');
            introContainer.style.display = 'flex';

            introVideo.muted = soundSettings.muted;
            introVideo.volume = 1.0;

            // Fallback in case video playback never starts on slower mobile browsers
            introStartWatchdogId = setTimeout(() => {
                // No progress after 3 s. (A play() that never settles leaves `paused` false, so checking it
                // made the menu wait for the 15 s limit when the video can't be decoded: QA D11.)
                const playbackStillBlocked = introVideo.currentTime === 0;
                if (startupState === 'starting-intro' && playbackStillBlocked) {
                    console.warn('Intro video did not start correctly; showing menu fallback.');
                    skipIntro();
                }
            }, INTRO_VIDEO_START_TIMEOUT_MS);

            introTimeoutId = setTimeout(() => {
                if (startupState !== 'menu') {
                    skipIntro();
                }
            }, INTRO_MAX_DURATION_MS);

            const playPromise = introVideo.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    markIntroAsPlaying();
                }).catch((e) => {
                    // Skipped meanwhile (the tap that skips the intro interrupts play()): don't restart it.
                    if (introSkipped || startupState === 'menu' || startupState === 'skipping-intro') return;
                    console.warn('Video play failed with audio. Retrying muted:', e);
                    introVideo.muted = true;
                    const mutedPlayPromise = introVideo.play();
                    if (mutedPlayPromise !== undefined) {
                        mutedPlayPromise.then(() => {
                            markIntroAsPlaying();
                        }).catch((mutedError) => {
                            console.warn('Muted video play failed:', mutedError);
                            skipIntro();
                        });
                    } else {
                        markIntroAsPlaying();
                    }
                });
            } else {
                markIntroAsPlaying();
            }
        }

        applyMuteState();
        initializeButtonTypes();
        initializeStartMenuState();

        if (introSkipHint) {
            const prefersTouchPrompt = isMobile || window.matchMedia('(pointer: coarse)').matches;
            introSkipHint.textContent = prefersTouchPrompt ? 'Tap anywhere to skip' : 'Click anywhere to skip';
        }

        // Preload video and ensure audio is ready
        introVideo.load();

        // Prepare video for playback with audio (especially important for iOS)
        introVideo.muted = soundSettings.muted;
        introVideo.volume = 1.0;

        // Robust startup trigger for browsers that don't consistently emit pointer events
        const triggerIntroStart = (e) => {
            if (e) {
                e.preventDefault();
            }
            beginIntroSequence();
        };

        clickToStart.addEventListener('pointerup', triggerIntroStart, { once: true });
        clickToStart.addEventListener('touchend', triggerIntroStart, { once: true });
        clickToStart.addEventListener('click', triggerIntroStart, { once: true });

        // When video ends, seamlessly transition to start menu
        introVideo.addEventListener('ended', skipIntro);
        // A <source> that fails to load reports the error on itself, not on the <video>.
        introVideo.querySelectorAll('source').forEach(source => source.addEventListener('error', () => {
            if (startupState === 'starting-intro' || startupState === 'playing-intro') {
                console.warn('Intro video source failed; showing menu fallback.');
                skipIntro();
            }
        }));
        introVideo.addEventListener('error', () => {
            console.warn('Intro video failed to load; showing menu fallback.');
            skipIntro();
        });

        // Allow clicking/tapping to skip video
        introContainer.addEventListener('click', skipIntro);
        introContainer.addEventListener('touchend', (e) => {
            e.preventDefault();
            skipIntro();
        });
    });

    // Mulligan state
    let mulliganUsed = false;
    let playerFirstTurnCompleted = false;

    // Attack Phase and action processing lock (must be declared before startGame function)
    let attackPhase = false;
    let isProcessingAction = false; // Prevents rapid clicking and simultaneous actions
    let processingActionTimer = null; // Failsafe timer to prevent permanent lock
    let activeGraveyardView = 'player';
    let isStartingGame = false;
    // Bumped on match start, abandonment and completion; delayed work belongs to that serial.
    let matchSerial = 0;

    // ---- Achievements (achievements.js) hear about confirmed outcomes only: a card that resolved, a finished
    // combat, a match that ended. reportAchievement never throws into the game.
    function reportAchievement(type, payload) {
        if (QA_MODE || !isMetaRuntimeEnabled()) return;
        try { window.Achievements?.emit(type, payload); } catch (_) { /* never in the game's way */ }
    }

    const manaTotal = mana => Object.values(mana || {}).reduce((sum, n) => sum + (n || 0), 0);

    // What is changing life right now ('instant', 'drain', 'artifact', 'upkeep' or 'combat'). A lethal hit ends the
    // match inside the change, before the spell or combat is reported, so each life change carries its source.
    let lifeChangeSource = null;
    function withLifeSource(source, fn) {
        const previous = lifeChangeSource;
        lifeChangeSource = source;
        try {
            return fn();
        } finally {
            lifeChangeSource = previous;
        }
    }

    // What a spell or artifact actually did, from the public state before and after it resolved
    function snapshotForOutcome() {
        const ids = board => new Map(board.map(c => [c.id, { tapped: !!c.tapped, power: c.power, card: c }]));
        return {
            player: ids(gameState.playerBoard), enemy: ids(gameState.enemyBoard),
            enemyHand: gameState.enemyHand.length, playerDeck: gameState.playerDeck.length,
            playerGraveyard: gameState.playerGraveyard.length,
            enemyLife: gameState.enemyLife
        };
    }

    function describeOutcome(before, card, side) {
        const left = (map, board) => [...map.values()].filter(v => !board.some(c => c.id === v.card.id)).map(v => v.card);
        const enemyGone = left(before.enemy, gameState.enemyBoard).filter(c => c.type === 'creature');
        const playerGone = left(before.player, gameState.playerBoard).filter(c => c.type === 'creature');
        const inHand = (hand, c) => hand.some(h => h.id === c.id);
        const mine = side === 'player' ? gameState.playerBoard : gameState.enemyBoard;
        const myBefore = side === 'player' ? before.player : before.enemy;
        const theirsBefore = side === 'player' ? before.enemy : before.player;
        const theirsGone = side === 'player' ? enemyGone : playerGone;
        const theirHand = side === 'player' ? gameState.enemyHand : gameState.playerHand;
        const added = mine.filter(c => !myBefore.has(c.id) && c.type === 'creature');
        return {
            side,
            card,
            enemyLifeChange: gameState.enemyLife - before.enemyLife,
            bounced: theirsGone.filter(c => inHand(theirHand, c)),
            destroyed: theirsGone.filter(c => !inHand(theirHand, c)),
            deaths: [...enemyGone.filter(c => !inHand(gameState.enemyHand, c)).map(c => ({ card: c, owner: 'enemy' })),
                ...playerGone.filter(c => !inHand(gameState.playerHand, c)).map(c => ({ card: c, owner: 'player' }))],
            tokens: added.filter(c => c.cardType === 'Creature Token').length,
            revived: added.find(c => c.cardType !== 'Creature Token') || null,
            discarded: side === 'player' ? Math.max(0, before.enemyHand - gameState.enemyHand.length) : 0,
            enemyHandAfter: gameState.enemyHand.length,
            frozeTapped: [...theirsBefore.values()].some(v => v.tapped && v.card.frozen),
            buffed: mine.filter(c => myBefore.has(c.id) && c.power > myBefore.get(c.id).power).length,
            drawn: side === 'player' ? Math.max(0, before.playerDeck - gameState.playerDeck.length) : 0
        };
    }

    // ---- Pausable match timers. The AI's turn steps, its failsafe, the action-lock failsafes and the toasts run
    // on these, so PAUSE stops them where they are and RESUME continues them with the time they had left.
    let gamePaused = false;
    const matchTimers = new Map();
    let matchTimerSeq = 0;

    function armMatchTimer(id, timer) {
        timer.startedAt = Date.now();
        timer.handle = setTimeout(() => {
            matchTimers.delete(id);
            if (timer.serial === matchSerial && !gameState.matchFinalized) timer.fn();
        }, timer.remaining);
    }

    function matchDelay(fn, ms) {
        if (gameState.matchFinalized) return null;
        const id = ++matchTimerSeq;
        const timer = { fn, serial: matchSerial, remaining: Math.max(0, ms), startedAt: 0, handle: null };
        matchTimers.set(id, timer);
        if (!gamePaused) armMatchTimer(id, timer);
        return id;
    }

    function clearMatchDelay(id) {
        const timer = matchTimers.get(id);
        if (!timer) return;
        clearTimeout(timer.handle);
        matchTimers.delete(id);
    }

    function freezeMatchTimers() {
        const now = Date.now();
        matchTimers.forEach(timer => {
            clearTimeout(timer.handle);
            timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
        });
    }

    function thawMatchTimers() {
        matchTimers.forEach((timer, id) => armMatchTimer(id, timer));
    }

    // Failsafe function to unlock processing after timeout
    function setProcessingLock(duration = 5000) {
        isProcessingAction = true;

        // Clear any existing timer
        if (processingActionTimer) {
            clearMatchDelay(processingActionTimer);
        }

        // Set failsafe timer to auto-unlock after duration
        processingActionTimer = matchDelay(() => {
            if (QA_MODE) console.log('⚠️ Failsafe: Auto-unlocking processing action');
            isProcessingAction = false;
            updateUI();
        }, duration);
    }

    // Function to properly release processing lock
    function releaseProcessingLock() {
        isProcessingAction = false;
        if (processingActionTimer) {
            clearMatchDelay(processingActionTimer);
            processingActionTimer = null;
        }
        // CRITICAL FIX: Update UI to refresh button states immediately after releasing lock
        updateUI();
    }

    // Keyword rules: the one source for card details, board badges and How To Play (RULES.md §8).
    const KEYWORD_RULES = {
        flying: { label: 'Flying', badge: '🪽', text: 'Can only be blocked by creatures with Flying or Reach.' },
        reach: { label: 'Reach', badge: '🏹', text: 'Can block creatures with Flying.' },
        trample: { label: 'Trample', badge: '🐾', text: 'Damage beyond what its blockers need to die goes to the defending player.' },
        lifelink: { label: 'Lifelink', badge: '💖', text: 'Damage it deals also gains its controller that much life.' },
        haste: { label: 'Haste', badge: '⚡', text: 'Can attack the turn it arrives.' },
        vigilance: { label: 'Vigilance', badge: '👁️', text: "Doesn't tap when attacking, so it can still block." },
        defender: { label: 'Defender', badge: '🧱', text: "Can't attack, but can block." },
        deathtouch: { label: 'Deathtouch', badge: '☠️', text: 'Any damage it deals to a creature destroys it.' },
        first_strike: { label: 'First Strike', badge: '1️⃣', text: 'Deals combat damage before creatures without First Strike.' },
        double_strike: { label: 'Double Strike', badge: '2️⃣', text: 'Deals combat damage twice: once early, once with normal damage.' },
        hexproof: { label: 'Hexproof', badge: '🔰', text: "Your opponent's destroy, tap and bounce effects can't choose it." },
        menace: { label: 'Menace', badge: '😈', text: 'Can only be blocked by two or more creatures.' },
        unblockable: { label: 'Unblockable', badge: '👻', text: "Can't be blocked." },
        flash: { label: 'Flash', badge: '💨', text: 'No effect yet: this version has no instant-speed play.' }
    };

    function describeKeyword(ability) {
        const rule = KEYWORD_RULES[ability];
        return rule ? `${rule.label}: ${rule.text}` : ability;
    }

    // ---- Card presentation helpers, shared by the hand, the battlefield, card details and pack reveals.
    // They only read card data; ids, stats, costs, rarity and rules stay where they are.
    const ELEMENT_LABELS = { fire: 'Fire', water: 'Water', earth: 'Earth', swamp: 'Swamp', light: 'Light', colorless: 'Colorless' };
    const elementLabel = element => `${ELEMENTS[element]?.emoji || ''} ${ELEMENT_LABELS[element] || element}`.trim();
    const CARD_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    // The rarity glyph gives each rarity a shape as well as a colour
    const RARITY_INFO = {
        common: { label: 'Common', glyph: '●' },
        uncommon: { label: 'Uncommon', glyph: '◆' },
        rare: { label: 'Rare', glyph: '◆' },
        epic: { label: 'Epic', glyph: '⬢' },
        legendary: { label: 'Legendary', glyph: '★' }
    };
    const CARD_TYPE_INFO = {
        creature: { label: 'Creature', icon: '🐾' },
        instant: { label: 'Instant', icon: '✨' },
        artifact: { label: 'Artifact', icon: '⚙️' },
        land: { label: 'Land', icon: '⛰️' }
    };

    function getCardRarity(card) {
        return CARD_RARITIES.includes(card?.__rarity) ? card.__rarity : 'common';
    }

    // The colours a card face shows: a land's mana colours, otherwise its cost colours (largest first, as
    // written); cards with neither are colorless.
    function getCardIdentity(card) {
        const source = card?.type === 'land'
            ? (Array.isArray(card.elements) ? card.elements : [card.element])
            : Object.keys(card?.cost || {});
        const colours = [...new Set(source)].filter(element => element !== 'colorless' && ELEMENTS[element]);
        return colours.length ? colours : ['colorless'];
    }

    // Element colours for a face or panel: --card-el-1/--card-el-2 drive its background (styles.css "CARD FACES")
    function applyCardIdentity(el, card) {
        const identity = getCardIdentity(card);
        el.dataset.elements = identity.join(' ');
        el.classList.toggle('is-multicolor', identity.length === 2);
        el.classList.toggle('is-rainbow', identity.length > 2);
        el.style.setProperty('--card-el-1', `var(--elc-${identity[0]})`);
        el.style.setProperty('--card-el-2', `var(--elc-${identity[1] || identity[0]})`);
        return identity;
    }

    // Mana cost as pips: one per colour with its count, colorless as ◇. A free card shows 0.
    function renderCostPips(cost) {
        const entries = Object.entries(cost || {}).filter(([, n]) => n > 0);
        if (!entries.length) return '<span class="cost-pip cost-pip-free" title="Free">0</span>';
        return entries.map(([element, n]) => `<span class="cost-pip" data-element="${element}" title="${n} ${ELEMENT_LABELS[element] || element}">`
            + `<span class="cost-pip-icon" aria-hidden="true">${ELEMENTS[element]?.emoji || '◇'}</span><span class="cost-pip-n">${n}</span></span>`).join('');
    }

    function describeCost(cost) {
        const entries = Object.entries(cost || {}).filter(([, n]) => n > 0);
        return entries.length ? entries.map(([element, n]) => `${n} ${ELEMENT_LABELS[element] || element}`).join(' + ') : 'Free';
    }

    // Keyword badge for a card face. Flash has no effect in this version, so its badge is marked inactive.
    function createKeywordBadge(ability) {
        const badge = document.createElement('div');
        badge.className = 'ability-icon';
        badge.textContent = KEYWORD_RULES[ability]?.badge || ability[0].toUpperCase();
        badge.title = describeKeyword(ability);
        if (ability === 'flash') badge.classList.add('is-inactive');
        return badge;
    }

    // One keyword in card details: badge, name and the KEYWORD_RULES text
    function renderKeywordDetail(ability) {
        const rule = KEYWORD_RULES[ability];
        if (!rule) return `<div class="card-detail-keyword">${ability}</div>`;
        const inactive = ability === 'flash';
        return `<div class="card-detail-keyword${inactive ? ' is-inactive' : ''}">`
            + `<span class="kw-badge" aria-hidden="true">${rule.badge}</span>`
            + `<span class="kw-body"><strong>${rule.label}</strong>${inactive ? ' <span class="kw-tag">No effect</span>' : ''}: ${rule.text}</span></div>`;
    }

    // Token creatures made by token spells (tokenType). `default` is for a token spell without a type.
    const TOKEN_TYPES = {
        spirit: { name: 'Spirit Token', emoji: '👻', power: 1, toughness: 1, abilities: ['flying'] },
        soldier: { name: 'Soldier Token', emoji: '🗡️', power: 1, toughness: 1, abilities: [] },
        beast: { name: 'Beast Token', emoji: '🐻', power: 2, toughness: 2, abilities: [] },
        default: { name: 'Token', emoji: '🪙', power: 1, toughness: 1, abilities: [] }
    };

    // Rules text for instants and artifacts: exactly what the engine does (EFFECTS.md). Card details show
    // it under the card's own text.
    function describeEffect(card) {
        const v = card.value;
        const isArtifact = card.type === 'artifact';
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const eachTurn = text => `At the start of each of your turns, ${text}.`;
        const usedUp = isArtifact ? ' The artifact is then used up.' : '';
        const keywordLabels = abilities => (abilities || []).map(a => KEYWORD_RULES[a]?.label || a);

        switch (card.effect) {
            case 'damage':
                if (isArtifact) return eachTurn(`it deals ${v} damage to your opponent`);
                if (card.target === 'all') return `Deals ${v} damage to every creature, yours too.`;
                return `Deals ${v} damage to your opponent.`;
            case 'heal':
                return isArtifact ? eachTurn(`you gain ${v} life`) : `You gain ${v} life.`;
            case 'heal_draw':
                return `You gain ${v} life and draw ${plural(card.drawCards || 1, 'card')}.`;
            case 'draw':
                return isArtifact ? eachTurn(`you draw ${plural(v, 'extra card')}`) : `Draw ${plural(v, 'card')}.`;
            case 'draw_on_play':
                return `When played, draw ${plural(v || 1, 'card')}.${usedUp}`;
            case 'drain':
                return `Your opponent loses ${v} life and you gain ${v}.`;
            case 'destroy':
                return 'Destroys a random enemy creature without Hexproof.';
            case 'buff':
            case 'buff_defense': {
                const power = card.effect === 'buff' ? v : 0;
                const toughness = card.effect === 'buff_defense' || card.buffType !== 'power' ? v : 0;
                const parts = [];
                if (v > 0) parts.push(`+${power}/+${toughness}`);
                parts.push(...keywordLabels(card.grantAbilities));
                const who = card.targetAll ? 'Each creature you control gets' : 'A random creature you control gets';
                const duration = card.untilEndOfTurn ? ' until end of turn' : ' while it stays on the battlefield';
                return `${who} ${parts.join(' and ')}${duration}.${usedUp}`;
            }
            case 'tap':
                return card.skipUntap
                    ? "Taps a random enemy creature without Hexproof (an untapped one if there is one). It doesn't untap during its controller's next untap."
                    : 'Taps a random untapped enemy creature without Hexproof.';
            case 'bounce':
                return "Returns up to 2 random enemy creatures without Hexproof to their owner's hand.";
            case 'revive':
                return 'Returns the most recent creature in your graveyard to the battlefield. It can attack next turn (or now, with Haste).';
            case 'aoe':
                return `Deals ${v} damage to each enemy creature.${usedUp}`;
            case 'mana':
                return `Once per turn, click it to add ${v} ${ELEMENTS.colorless.emoji} colourless mana.`;
            case 'token': {
                const token = TOKEN_TYPES[card.tokenType] || TOKEN_TYPES.default;
                const keywords = keywordLabels(token.abilities);
                return `Creates ${plural(v || 1, token.name)} (${token.power}/${token.toughness}${keywords.length ? ' ' + keywords.join(', ') : ''}).`;
            }
            case 'discard':
                return `Your opponent discards ${plural(v || 1, 'random card')}.`;
            case 'discard_draw':
                return `Your opponent discards ${plural(v || 1, 'random card')}, and you draw ${plural(v || 1, 'card')} either way.`;
            default:
                return card.desc || '';
        }
    }

    // Mana System
    const ELEMENTS = {
        fire: { emoji: '🔥', color: '#ff4444' },
        water: { emoji: '💧', color: '#4444ff' },
        earth: { emoji: '🌍', color: '#44ff44' },
        swamp: { emoji: '💀', color: '#8844ff' },
        light: { emoji: '☀️', color: '#ffff44' },
        colorless: { emoji: '◇', color: '#cccccc' }
    };

    // Card Database - MASSIVELY EXPANDED with Themes and Card Types!
    const CARD_DATABASE = {
        // LANDS (Mana generators)
        lands: {
            fire: { emoji: '🔥', type: 'land', cardType: 'Land', element: 'fire', name: 'Volcanic Peak', desc: 'Tap for Fire mana', theme: 'Nature' },
            water: { emoji: '💧', type: 'land', cardType: 'Land', element: 'water', name: 'Mystic Springs', desc: 'Tap for Water mana', theme: 'Nature' },
            earth: { emoji: '🌍', type: 'land', cardType: 'Land', element: 'earth', name: 'Ancient Grove', desc: 'Tap for Earth mana', theme: 'Nature' },
            swamp: { emoji: '💀', type: 'land', cardType: 'Land', element: 'swamp', name: 'Cursed Bog', desc: 'Tap for Swamp mana', theme: 'Fantasy' },
            light: { emoji: '☀️', type: 'land', cardType: 'Land', element: 'light', name: 'Sacred Temple', desc: 'Tap for Light mana', theme: 'Fantasy' },
            wasteland: { emoji: '🏜️', type: 'land', cardType: 'Land', element: 'colorless', name: 'Crystal Wasteland', desc: 'Tap for colorless mana', theme: 'Science Fiction' },
            distant_planet: { emoji: '🪐', type: 'land', cardType: 'Land - Dual', elements: ['light', 'swamp'], name: 'Distant Planet', desc: 'Tap for Light or Swamp mana', theme: 'Science Fiction' },
            rainbow: { emoji: '🌈', type: 'land', cardType: 'Land - Universal', elements: ['fire', 'water', 'earth', 'swamp', 'light'], name: 'Rainbow', desc: 'Tap for any color mana', theme: 'Nature' }
        },
        
        // CREATURES - MASSIVELY EXPANDED
        creatures: {
            // Fire Creatures (17 total!)
            dragon: { emoji: '🐉', type: 'creature', cardType: 'Creature', cost: { fire: 6 }, power: 6, toughness: 6, abilities: ['flying', 'trample'], name: 'Ancient Dragon', desc: 'Legendary flying beast', theme: 'Fantasy' },
            phoenix: { emoji: '🦅', type: 'creature', cardType: 'Creature', cost: { fire: 4 }, power: 3, toughness: 2, abilities: ['flying', 'haste'], name: 'Phoenix', desc: 'Reborn from flames', theme: 'Fantasy' },
            demon: { emoji: '👹', type: 'creature', cardType: 'Creature', cost: { fire: 5 }, power: 5, toughness: 4, abilities: ['trample', 'menace'], name: 'Infernal Demon', desc: 'Tramples all in its path', theme: 'Fantasy' },
            tiger: { emoji: '🐅', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 2, abilities: ['haste'], name: 'Blazing Tiger', desc: 'Swift and fierce', theme: 'Nature' },
            fox: { emoji: '🦊', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: ['haste'], name: 'Fire Fox', desc: 'Cunning flame spirit', theme: 'Nature' },
            lion: { emoji: '🦁', type: 'creature', cardType: 'Creature', cost: { fire: 4 }, power: 4, toughness: 3, abilities: ['trample'], name: 'Fire Lion', desc: 'King of the burning plains', theme: 'Nature' },
            salamander: { emoji: '🦎', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 1, abilities: ['haste'], name: 'Fire Salamander', desc: 'Quick striker', theme: 'Nature' },
            monkey: { emoji: '🐒', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: ['haste'], name: 'Magma Monkey', desc: 'Mischievous and hot-tempered', theme: 'Nature' },
            bull: { emoji: '🐂', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 3, abilities: ['trample'], name: 'Raging Bull', desc: 'Unstoppable force', theme: 'Nature' },
            horse: { emoji: '🐴', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 2, abilities: ['haste'], name: 'Flame Steed', desc: 'Swift as wildfire', theme: 'Nature' },
            boar: { emoji: '🐗', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 3, abilities: ['trample'], name: 'Wild Boar', desc: 'Fierce and territorial', theme: 'Nature' },
            ram: { emoji: '🐏', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: ['first_strike'], name: 'Fire Ram', desc: 'Charges with fury', theme: 'Nature' },
            scorpion: { emoji: '🦂', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 2, toughness: 1, abilities: ['deathtouch', 'haste'], name: 'Lava Scorpion', desc: 'Deadly stinger', theme: 'Nature' },
            crab: { emoji: '🦀', type: 'creature', cardType: 'Creature', cost: { fire: 1 }, power: 1, toughness: 3, abilities: ['defender'], name: 'Magma Crab', desc: 'Hard shell protector', theme: 'Nature' },
            lobster: { emoji: '🦞', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: [], name: 'Fire Lobster', desc: 'Armored attacker', theme: 'Nature' },
            beetle: { emoji: '🪲', type: 'creature', cardType: 'Creature', cost: { fire: 1 }, power: 1, toughness: 2, abilities: [], name: 'Ember Beetle', desc: 'Small but resilient', theme: 'Nature' },
            ladybug: { emoji: '🐞', type: 'creature', cardType: 'Creature', cost: { fire: 1 }, power: 1, toughness: 1, abilities: ['flying'], name: 'Fire Ladybug', desc: 'Tiny flyer', theme: 'Nature' },
            oni: { emoji: '👹', type: 'creature', cardType: 'Creature', cost: { fire: 5 }, power: 5, toughness: 5, abilities: ['trample', 'haste'], name: 'Raging Oni', desc: 'Demonic warrior from legend', theme: 'Fantasy' },
            djinn: { emoji: '🧞‍♂️', type: 'creature', cardType: 'Creature', cost: { fire: 6 }, power: 5, toughness: 5, abilities: ['flying', 'trample'], name: 'Fire Djinn', desc: 'Wishes granted in flame', theme: 'Fantasy' },
            fireman: { emoji: '👨‍🚒', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 2, toughness: 3, abilities: ['vigilance'], name: 'Fireman', desc: 'Brave first responder', theme: 'City' },
            phoenix_firebird: { emoji: '🐦‍🔥', type: 'creature', cardType: 'Creature', cost: { fire: 5 }, power: 4, toughness: 3, abilities: ['flying', 'haste'], name: 'Phoenix Firebird', desc: 'Eternal flame reborn', theme: 'Fantasy' },

            // Water Creatures (17 total!)
            whale: { emoji: '🐋', type: 'creature', cardType: 'Creature', cost: { water: 6 }, power: 6, toughness: 7, abilities: ['defender', 'vigilance'], name: 'Leviathan Whale', desc: 'Guardian of the deep', theme: 'Nature' },
            shark: { emoji: '🦈', type: 'creature', cardType: 'Creature', cost: { water: 4 }, power: 4, toughness: 3, abilities: ['menace'], name: 'Great Shark', desc: 'Ocean predator', theme: 'Nature' },
            octopus: { emoji: '🐙', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 2, toughness: 4, abilities: ['defender', 'reach'], name: 'Giant Octopus', desc: 'Master of defense', theme: 'Nature' },
            dolphin: { emoji: '🐬', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 2, abilities: ['flash'], name: 'Mystic Dolphin', desc: 'Intelligent swimmer', theme: 'Nature' },
            fish: { emoji: '🐟', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 1, abilities: [], name: 'School Fish', desc: 'Basic sea creature', theme: 'Nature' },
            seal: { emoji: '🦭', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 3, abilities: [], name: 'Arctic Seal', desc: 'Cold water dweller', theme: 'Nature' },
            otter: { emoji: '🦦', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 2, abilities: ['flash'], name: 'River Otter', desc: 'Playful but fierce', theme: 'Nature' },
            penguin: { emoji: '🐧', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 2, abilities: [], name: 'Ice Penguin', desc: 'Cold-adapted', theme: 'Nature' },
            frog: { emoji: '🐸', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 2, abilities: ['flash'], name: 'Swamp Frog', desc: 'Amphibious jumper', theme: 'Nature' },
            squid: { emoji: '🦑', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 3, toughness: 3, abilities: ['reach'], name: 'Giant Squid', desc: 'Tentacled terror', theme: 'Nature' },
            shrimp: { emoji: '🦐', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 1, abilities: ['first_strike'], name: 'Mantis Shrimp', desc: 'Tiny but tough', theme: 'Nature' },
            crocodile: { emoji: '🐊', type: 'creature', cardType: 'Creature', cost: { water: 4 }, power: 4, toughness: 4, abilities: ['deathtouch'], name: 'Swamp Croc', desc: 'Apex predator', theme: 'Nature' },
            turtle: { emoji: '🐢', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 0, toughness: 6, abilities: ['defender', 'hexproof'], name: 'Ancient Turtle', desc: 'Impenetrable shell', theme: 'Nature' },
            seahorse: { emoji: '🐴', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 2, abilities: [], name: 'Sea Horse', desc: 'Graceful swimmer', theme: 'Nature' },
            jellyfish: { emoji: '🪼', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 0, toughness: 4, abilities: ['defender', 'deathtouch'], name: 'Stinging Jellyfish', desc: 'Floating defender', theme: 'Nature' },
            snail: { emoji: '🐌', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 0, toughness: 3, abilities: ['defender'], name: 'Armored Snail', desc: 'Slow but safe', theme: 'Nature' },
            swan: { emoji: '🦢', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 2, abilities: ['flying'], name: 'Crystal Swan', desc: 'Elegant flyer', theme: 'Nature' },
            mermaid: { emoji: '🧜‍♀️', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 2, toughness: 3, abilities: ['flash'], name: 'Enchanting Mermaid', desc: 'Siren of the seas', theme: 'Fantasy' },
            great_white: { emoji: '🦈', type: 'creature', cardType: 'Creature', cost: { water: 5 }, power: 5, toughness: 4, abilities: ['menace', 'trample'], name: 'Great White Shark', desc: 'Apex ocean predator', theme: 'Nature' },

            // Earth Creatures (17 total!)
            elephant: { emoji: '🐘', type: 'creature', cardType: 'Creature', cost: { earth: 6 }, power: 6, toughness: 7, abilities: ['trample', 'vigilance'], name: 'Elder Elephant', desc: 'Unstoppable might', theme: 'Nature' },
            gorilla: { emoji: '🦍', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 4, abilities: ['trample'], name: 'Silverback Gorilla', desc: 'Jungle king', theme: 'Nature' },
            bear: { emoji: '🐻', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 3, abilities: ['first_strike'], name: 'Forest Bear', desc: 'Powerful hunter', theme: 'Nature' },
            rabbit: { emoji: '🐰', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 1, abilities: ['haste'], name: 'Swift Rabbit', desc: 'Quick hopper', theme: 'Nature' },
            deer: { emoji: '🦌', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 2, abilities: ['vigilance'], name: 'Noble Deer', desc: 'Forest wanderer', theme: 'Nature' },
            wolf: { emoji: '🐺', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Pack Wolf', desc: 'Cunning predator', theme: 'Nature' },
            rhino: { emoji: '🦏', type: 'creature', cardType: 'Creature', cost: { earth: 5 }, power: 5, toughness: 5, abilities: ['trample'], name: 'Armored Rhino', desc: 'Charging tank', theme: 'Nature' },
            hippo: { emoji: '🦛', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 5, abilities: ['vigilance'], name: 'River Hippo', desc: 'Territorial giant', theme: 'Nature' },
            squirrel: { emoji: '🐿️', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 1, abilities: ['haste'], name: 'Forest Squirrel', desc: 'Nimble gatherer', theme: 'Nature' },
            hedgehog: { emoji: '🦔', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 2, abilities: ['defender'], name: 'Spiky Hedgehog', desc: 'Defensive ball', theme: 'Nature' },
            badger: { emoji: '🦡', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 2, abilities: ['first_strike'], name: 'Fierce Badger', desc: 'Aggressive burrower', theme: 'Nature' },
            giraffe: { emoji: '🦒', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 2, toughness: 4, abilities: ['reach', 'vigilance'], name: 'Tall Giraffe', desc: 'Can reach high', theme: 'Nature' },
            zebra: { emoji: '🦓', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 2, abilities: ['haste'], name: 'Striped Zebra', desc: 'Fast runner', theme: 'Nature' },
            camel: { emoji: '🐪', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 2, toughness: 4, abilities: ['vigilance'], name: 'Desert Camel', desc: 'Enduring traveler', theme: 'Nature' },
            ox: { emoji: '🐂', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 3, abilities: ['trample'], name: 'Strong Ox', desc: 'Powerful worker', theme: 'Nature' },
            panda: { emoji: '🐼', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 2, toughness: 4, abilities: ['lifelink'], name: 'Bamboo Panda', desc: 'Peaceful guardian', theme: 'Nature' },
            koala: { emoji: '🐨', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 1, toughness: 3, abilities: ['defender'], name: 'Sleepy Koala', desc: 'Tree hugger', theme: 'Nature' },
            cowboy: { emoji: '🤠', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 2, abilities: ['first_strike'], name: 'Wild West Cowboy', desc: 'Quick draw master', theme: 'City' },
            weightlifter: { emoji: '🏋️‍♂️', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 4, abilities: ['vigilance'], name: 'Weightlifter', desc: 'Strength and endurance', theme: 'City' },
            tiger_earth: { emoji: '🐅', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 3, abilities: ['trample'], name: 'Bengal Tiger', desc: 'Jungle apex predator', theme: 'Nature' },
            ladybug_earth: { emoji: '🐞', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 2, abilities: [], name: 'Garden Ladybug', desc: 'Lucky protector', theme: 'Nature' },

            // Swamp/Death Creatures (17 total!)
            vampire: { emoji: '🧛', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 4, toughness: 3, abilities: ['lifelink', 'flying'], name: 'Ancient Vampire', desc: 'Drains life force', theme: 'Fantasy' },
            zombie: { emoji: '🧟', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 3, toughness: 3, abilities: ['menace'], name: 'Risen Zombie', desc: 'Undead walker', theme: 'Fantasy' },
            ghost: { emoji: '👻', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 1, abilities: ['flying', 'hexproof'], name: 'Restless Ghost', desc: 'Ethereal spirit', theme: 'Fantasy' },
            bat: { emoji: '🦇', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 1, toughness: 1, abilities: ['flying', 'lifelink'], name: 'Vampire Bat', desc: 'Blood drinker', theme: 'Fantasy' },
            spider: { emoji: '🕷️', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 3, abilities: ['reach', 'deathtouch'], name: 'Giant Spider', desc: 'Web spinner', theme: 'Fantasy' },
            skeleton: { emoji: '💀', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 2, abilities: ['first_strike'], name: 'Skeleton Warrior', desc: 'Bones reanimate', theme: 'Fantasy' },
            wizard: { emoji: '🧙', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 2, toughness: 4, abilities: ['deathtouch'], name: 'Dark Wizard', desc: 'Necromancer', theme: 'Fantasy' },
            witch: { emoji: '🧙‍♀️', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 2, toughness: 3, abilities: ['deathtouch'], name: 'Swamp Witch', desc: 'Curse caster', theme: 'Fantasy' },
            rat: { emoji: '🐀', type: 'creature', cardType: 'Creature', cost: { swamp: 1 }, power: 1, toughness: 1, abilities: ['menace'], name: 'Plague Rat', desc: 'Disease carrier', theme: 'Fantasy' },
            snake: { emoji: '🐍', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 1, abilities: ['deathtouch'], name: 'Venom Snake', desc: 'Poisonous striker', theme: 'Fantasy' },
            scorpion_dark: { emoji: '🦂', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 1, toughness: 1, abilities: ['deathtouch', 'first_strike'], name: 'Death Scorpion', desc: 'Toxic sting', theme: 'Fantasy' },
            crow: { emoji: '🐦‍⬛', type: 'creature', cardType: 'Creature', cost: { swamp: 1 }, power: 1, toughness: 1, abilities: ['flying'], name: 'Death Crow', desc: 'Omen of doom', theme: 'Fantasy' },
            werewolf: { emoji: '🐺', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 4, toughness: 3, abilities: ['double_strike'], name: 'Werewolf', desc: 'Cursed beast', theme: 'Fantasy' },
            gargoyle: { emoji: '🗿', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 2, toughness: 4, abilities: ['flying', 'defender'], name: 'Stone Gargoyle', desc: 'Eternal sentinel', theme: 'Fantasy' },
            mummy: { emoji: '🧟‍♂️', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Ancient Mummy', desc: 'Wrapped horror', theme: 'Fantasy' },
            goblin: { emoji: '👺', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 1, abilities: ['haste'], name: 'Goblin Raider', desc: 'Quick attacker', theme: 'Fantasy' },
            troll: { emoji: '🧌', type: 'creature', cardType: 'Creature', cost: { swamp: 5 }, power: 5, toughness: 5, abilities: ['trample'], name: 'Swamp Troll', desc: 'Regenerating brute', theme: 'Fantasy' },
            demonic_clown: { emoji: '🤡', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 3, toughness: 3, abilities: ['menace', 'deathtouch'], name: 'Demonic Clown', desc: 'Nightmare fuel incarnate', theme: 'Fantasy' },

            // Light Creatures (17 total!)
            unicorn: { emoji: '🦄', type: 'creature', cardType: 'Creature', cost: { light: 4 }, power: 3, toughness: 3, abilities: ['lifelink', 'vigilance'], name: 'Sacred Unicorn', desc: 'Pure of heart', theme: 'Fantasy' },
            angel: { emoji: '👼', type: 'creature', cardType: 'Creature', cost: { light: 5 }, power: 4, toughness: 4, abilities: ['flying', 'vigilance'], name: 'Guardian Angel', desc: 'Divine protector', theme: 'Fantasy' },
            eagle: { emoji: '🦅', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 2, abilities: ['flying', 'vigilance'], name: 'Sky Eagle', desc: 'Ever watchful', theme: 'Nature' },
            dove: { emoji: '🕊️', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 1, abilities: ['flying', 'lifelink'], name: 'Peace Dove', desc: 'Symbol of hope', theme: 'Fantasy' },
            butterfly: { emoji: '🦋', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: ['flying'], name: 'Light Butterfly', desc: 'Delicate beauty', theme: 'Nature' },
            pegasus: { emoji: '🦄', type: 'creature', cardType: 'Creature', cost: { light: 5 }, power: 4, toughness: 4, abilities: ['flying', 'vigilance'], name: 'Winged Pegasus', desc: 'Legendary mount', theme: 'Fantasy' },
            fairy: { emoji: '🧚', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['flying', 'flash'], name: 'Forest Fairy', desc: 'Magical sprite', theme: 'Fantasy' },
            cat: { emoji: '🐱', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: ['vigilance'], name: 'Temple Cat', desc: 'Sacred guardian', theme: 'City' },
            dog: { emoji: '🐕', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 2, toughness: 2, abilities: ['vigilance'], name: 'Loyal Hound', desc: 'Faithful companion', theme: 'City' },
            owl: { emoji: '🦉', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['flying', 'vigilance'], name: 'Wise Owl', desc: 'All-seeing', theme: 'Nature' },
            bee: { emoji: '🐝', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: ['flying', 'first_strike'], name: 'Golden Bee', desc: 'Busy worker', theme: 'Nature' },
            chicken: { emoji: '🐔', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: [], name: 'Holy Chicken', desc: 'Blessed fowl', theme: 'Nature' },
            parrot: { emoji: '🦜', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 2, toughness: 1, abilities: ['flying'], name: 'Sun Parrot', desc: 'Colorful flyer', theme: 'Nature' },
            flamingo: { emoji: '🦩', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 2, toughness: 2, abilities: ['vigilance'], name: 'Pink Flamingo', desc: 'Elegant wader', theme: 'Nature' },
            peacock: { emoji: '🦚', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 3, abilities: ['flying'], name: 'Royal Peacock', desc: 'Majestic display', theme: 'Nature' },
            chick: { emoji: '🐣', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 0, toughness: 1, abilities: ['lifelink'], name: 'Baby Chick', desc: 'Innocent life', theme: 'Nature' },
            hamster: { emoji: '🐹', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: ['haste'], name: 'Holy Hamster', desc: 'Quick and cute', theme: 'City' },

            // SCI-FI CREATURES (30+ total!)
            robot: { emoji: '🤖', type: 'creature', cardType: 'Creature', cost: { fire: 4, earth: 1 }, power: 4, toughness: 4, abilities: ['vigilance'], name: 'Combat Robot', desc: 'Mechanical warrior unit', theme: 'Science Fiction' },
            alien: { emoji: '👽', type: 'creature', cardType: 'Creature', cost: { swamp: 3, water: 1 }, power: 3, toughness: 2, abilities: ['flying', 'menace'], name: 'Alien Invader', desc: 'From another world', theme: 'Science Fiction' },
            alien_monster: { emoji: '👾', type: 'creature', cardType: 'Creature', cost: { fire: 2, swamp: 1 }, power: 3, toughness: 1, abilities: ['haste'], name: 'Pixel Monster', desc: '8-bit terror', theme: 'Science Fiction' },
            ufo: { emoji: '🛸', type: 'creature', cardType: 'Creature', cost: { light: 4, water: 1 }, power: 2, toughness: 5, abilities: ['flying', 'defender'], name: 'UFO Saucer', desc: 'Hovering spacecraft', theme: 'Science Fiction' },
            satellite: { emoji: '🛰️', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 1, toughness: 3, abilities: ['flying', 'vigilance'], name: 'Satellite Drone', desc: 'Orbital observer', theme: 'Science Fiction' },
            rocket: { emoji: '🚀', type: 'creature', cardType: 'Creature', cost: { fire: 5 }, power: 5, toughness: 3, abilities: ['flying', 'haste'], name: 'Battle Rocket', desc: 'Supersonic striker', theme: 'Science Fiction' },
            astronaut: { emoji: '👨‍🚀', type: 'creature', cardType: 'Creature', cost: { light: 3, earth: 1 }, power: 2, toughness: 3, abilities: ['vigilance'], name: 'Space Marine', desc: 'Elite soldier', theme: 'Science Fiction' },
            cyborg: { emoji: '🦾', type: 'creature', cardType: 'Creature', cost: { fire: 3, earth: 1 }, power: 4, toughness: 2, abilities: ['first_strike'], name: 'Cyborg Soldier', desc: 'Enhanced warrior', theme: 'Science Fiction' },
            android: { emoji: '🤖', type: 'creature', cardType: 'Creature', cost: { water: 3, light: 2 }, power: 3, toughness: 4, abilities: ['vigilance'], name: 'Android Guardian', desc: 'Synthetic protector', theme: 'Science Fiction' },
            mech: { emoji: '🦿', type: 'creature', cardType: 'Creature', cost: { earth: 5, fire: 2 }, power: 7, toughness: 6, abilities: ['trample'], name: 'Battle Mech', desc: 'Walking fortress', theme: 'Science Fiction' },
            drone: { emoji: '🚁', type: 'creature', cardType: 'Creature', cost: { light: 2, fire: 1 }, power: 2, toughness: 1, abilities: ['flying', 'haste'], name: 'Attack Drone', desc: 'Autonomous flyer', theme: 'Science Fiction' },
            computer: { emoji: '💻', type: 'creature', cardType: 'Creature', cost: { light: 2, water: 1 }, power: 1, toughness: 3, abilities: ['defender', 'hexproof'], name: 'AI Core', desc: 'Digital intelligence', theme: 'Science Fiction' },
            brain: { emoji: '🧠', type: 'creature', cardType: 'Creature', cost: { swamp: 3, water: 1 }, power: 2, toughness: 3, abilities: ['hexproof'], name: 'Cyber Brain', desc: 'Artificial mind', theme: 'Science Fiction' },
            dna: { emoji: '🧬', type: 'creature', cardType: 'Creature', cost: { earth: 2, light: 1 }, power: 1, toughness: 2, abilities: [], name: 'Gene Splice', desc: 'Genetic experiment', theme: 'Science Fiction' },
            microbe: { emoji: '🦠', type: 'creature', cardType: 'Creature', cost: { swamp: 1 }, power: 1, toughness: 1, abilities: ['deathtouch'], name: 'Nano Virus', desc: 'Microscopic threat', theme: 'Science Fiction' },
            pill: { emoji: '💊', type: 'creature', cardType: 'Creature', cost: { light: 1, water: 1 }, power: 0, toughness: 2, abilities: ['lifelink'], name: 'Med Capsule', desc: 'Healing nanobot', theme: 'Science Fiction' },
            syringe: { emoji: '💉', type: 'creature', cardType: 'Creature', cost: { swamp: 2, fire: 1 }, power: 2, toughness: 1, abilities: ['deathtouch'], name: 'Bio Injector', desc: 'Chemical weapon', theme: 'Science Fiction' },
            microscope: { emoji: '🔬', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['vigilance'], name: 'Lab Scanner', desc: 'Research unit', theme: 'Science Fiction' },
            telescope: { emoji: '🔭', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 2, abilities: ['flying', 'reach'], name: 'Orbital Scanner', desc: 'Long-range sensor', theme: 'Science Fiction' },
            battery: { emoji: '🔋', type: 'creature', cardType: 'Creature', cost: { fire: 1, water: 1 }, power: 1, toughness: 3, abilities: ['defender'], name: 'Power Cell', desc: 'Energy storage', theme: 'Science Fiction' },
            magnet: { emoji: '🧲', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 2, abilities: [], name: 'Magnetic Trap', desc: 'Pulls enemies in', theme: 'Science Fiction' },
            satellite_dish: { emoji: '📡', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['vigilance'], name: 'Signal Tower', desc: 'Communication hub', theme: 'Science Fiction' },
            radar: { emoji: '📡', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 1, toughness: 3, abilities: ['reach'], name: 'Radar Array', desc: 'Detection system', theme: 'Science Fiction' },
            bomb_scifi: { emoji: '💣', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 4, toughness: 1, abilities: ['haste'], name: 'Plasma Bomb', desc: 'Explosive payload', theme: 'Science Fiction' },
            gear: { emoji: '⚙️', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 2, abilities: ['defender'], name: 'Mech Part', desc: 'Machine component', theme: 'Science Fiction' },
            wrench: { emoji: '🔧', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 1, abilities: ['first_strike'], name: 'Repair Bot', desc: 'Maintenance unit', theme: 'Science Fiction' },
            hammer: { emoji: '🔨', type: 'creature', cardType: 'Creature', cost: { fire: 2, earth: 1 }, power: 3, toughness: 1, abilities: ['first_strike'], name: 'Forge Hammer', desc: 'Construction tool', theme: 'Science Fiction' },
            hourglass: { emoji: '⏳', type: 'creature', cardType: 'Creature', cost: { light: 3, swamp: 1 }, power: 2, toughness: 2, abilities: ['vigilance', 'flash'], name: 'Time Device', desc: 'Temporal manipulator', theme: 'Science Fiction' },
            alarm: { emoji: '⏰', type: 'creature', cardType: 'Creature', cost: { fire: 1 }, power: 1, toughness: 1, abilities: ['haste'], name: 'Alert System', desc: 'Quick responder', theme: 'Science Fiction' },
            watch: { emoji: '⌚', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 2, abilities: ['vigilance'], name: 'Chrono Watch', desc: 'Time keeper', theme: 'Science Fiction' },
            cd: { emoji: '💿', type: 'creature', cardType: 'Creature', cost: { light: 1 }, power: 1, toughness: 1, abilities: ['flying'], name: 'Data Disc', desc: 'Information storage', theme: 'Science Fiction' },
            phone: { emoji: '📱', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['flash'], name: 'Comm Device', desc: 'Mobile terminal', theme: 'Science Fiction' },
            camera: { emoji: '📷', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 1, abilities: ['vigilance'], name: 'Spy Camera', desc: 'Surveillance unit', theme: 'Science Fiction' },
            video: { emoji: '📹', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 2, abilities: ['vigilance'], name: 'Recorder Drone', desc: 'Video capture', theme: 'Science Fiction' },
            men_in_black: { emoji: '🕴️', type: 'creature', cardType: 'Creature', cost: { swamp: 3, light: 1 }, power: 3, toughness: 3, abilities: ['flash', 'hexproof'], name: 'Men In Black', desc: 'Government agents', theme: 'Science Fiction' },
            alien_grey: { emoji: '👽', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 3, toughness: 3, abilities: ['flying', 'flash'], name: 'Grey Alien', desc: 'Extraterrestrial visitor', theme: 'Science Fiction' },
            astronaut_mixed: { emoji: '👨‍🚀', type: 'creature', cardType: 'Creature', cost: { swamp: 2, light: 2 }, power: 2, toughness: 3, abilities: ['flying', 'vigilance'], name: 'Astronaut Explorer', desc: 'Brave space pioneer', theme: 'Science Fiction' },

            // MIXED COLOR CREATURES
            poop: { emoji: '💩', type: 'creature', cardType: 'Creature', cost: { earth: 2, swamp: 1 }, power: 2, toughness: 3, abilities: ['menace'], name: 'Poop', desc: 'Stinky but effective', theme: 'Nature' },
            santa: { emoji: '🎅', type: 'creature', cardType: 'Creature', cost: { fire: 3, light: 2 }, power: 3, toughness: 4, abilities: ['vigilance', 'lifelink'], name: 'Santa Claus', desc: 'Jolly gift giver', theme: 'City' },
            police: { emoji: '👮', type: 'creature', cardType: 'Creature', cost: { water: 2, light: 1 }, power: 2, toughness: 3, abilities: ['vigilance', 'first_strike'], name: 'Police Officer', desc: 'Law and order', theme: 'City' },
            crooked_cop: { emoji: '👮🏽', type: 'creature', cardType: 'Creature', cost: { water: 2, swamp: 1 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Crooked Cop', desc: 'Corrupt enforcer', theme: 'City' },
            farmer: { emoji: '🧑‍🌾', type: 'creature', cardType: 'Creature', cost: { earth: 2, light: 1 }, power: 2, toughness: 2, abilities: ['vigilance'], name: 'Farmer', desc: 'Hardworking cultivator', theme: 'City' },
            welder: { emoji: '👩‍🏭', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: [], name: 'Welder', desc: 'Industrial craftsperson', theme: 'City' },
            sunflower: { emoji: '🌻', type: 'creature', cardType: 'Creature', cost: { earth: 2, light: 1 }, power: 1, toughness: 3, abilities: ['defender', 'lifelink'], name: 'Sunflower', desc: 'Radiant bloom', theme: 'Nature' },

            // New mono-color expansion creatures
            fire_lantern_fish: { emoji: '🎏', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 1, abilities: ['haste'], name: 'Lantern Koi', desc: 'Glows with ember heat', theme: 'Nature' },
            fire_hot_pepper: { emoji: '🌶️', type: 'creature', cardType: 'Creature', cost: { fire: 1 }, power: 1, toughness: 1, abilities: ['haste'], name: 'Hot Pepper Sprite', desc: 'Spicy burst attacker', theme: 'Nature' },
            fire_torch_runner: { emoji: '🏃‍♂️', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 2, abilities: ['haste'], name: 'Torch Runner', desc: 'Never slows down', theme: 'City' },
            fire_forge_hound: { emoji: '🦮', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 2, abilities: ['first_strike'], name: 'Forge Hound', desc: 'Guard of blazing anvils', theme: 'Fantasy' },
            fire_comet_hawk: { emoji: '🪶', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 1, abilities: ['flying', 'haste'], name: 'Comet Hawk', desc: 'Streaks across the sky', theme: 'Nature' },
            fire_volcano_golem: { emoji: '🗿', type: 'creature', cardType: 'Creature', cost: { fire: 4 }, power: 4, toughness: 4, abilities: ['trample'], name: 'Volcano Golem', desc: 'Molten stone giant', theme: 'Fantasy' },
            fire_rocket_imp: { emoji: '🚀', type: 'creature', cardType: 'Creature', cost: { fire: 2 }, power: 2, toughness: 1, abilities: ['flying', 'haste'], name: 'Rocket Imp', desc: 'Tiny but explosive', theme: 'Science Fiction' },
            fire_ember_chef: { emoji: '👨‍🍳', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 2, toughness: 3, abilities: ['lifelink'], name: 'Ember Chef', desc: 'Serves healing stews', theme: 'City' },
            fire_war_drummer: { emoji: '🥁', type: 'creature', cardType: 'Creature', cost: { fire: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'War Drummer', desc: 'Rallies the charge', theme: 'City' },
            fire_neon_panther: { emoji: '🐆', type: 'creature', cardType: 'Creature', cost: { fire: 4 }, power: 4, toughness: 2, abilities: ['haste', 'menace'], name: 'Neon Panther', desc: 'Hunts through city lights', theme: 'Science Fiction' },

            water_jelly_knight: { emoji: '🪼', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 1, toughness: 3, abilities: ['flying'], name: 'Jelly Knight', desc: 'Floats over blockers', theme: 'Nature' },
            water_otter_scout: { emoji: '🦦', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 2, abilities: ['unblockable'], name: 'Otter Scout', desc: 'Slips past defenses', theme: 'Nature' },
            water_moonfish: { emoji: '🐠', type: 'creature', cardType: 'Creature', cost: { water: 1 }, power: 1, toughness: 2, abilities: [], name: 'Moonfish', desc: 'Glides in calm tides', theme: 'Nature' },
            water_tidal_turtle: { emoji: '🐢', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 2, toughness: 4, abilities: ['defender'], name: 'Tidal Turtle', desc: 'Shell like a fortress', theme: 'Nature' },
            water_snow_owl: { emoji: '🦉', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 2, toughness: 3, abilities: ['flying'], name: 'Snow Owl', desc: 'Silent winter hunter', theme: 'Nature' },
            water_harbor_mage: { emoji: '🧙‍♀️', type: 'creature', cardType: 'Creature', cost: { water: 4 }, power: 3, toughness: 3, abilities: ['hexproof'], name: 'Harbor Mage', desc: 'Ward of mist and tide', theme: 'Fantasy' },
            water_dolphin_rider: { emoji: '🐬', type: 'creature', cardType: 'Creature', cost: { water: 3 }, power: 3, toughness: 2, abilities: ['haste'], name: 'Dolphin Rider', desc: 'Rushes with ocean speed', theme: 'Nature' },
            water_hydrobot: { emoji: '🤖', type: 'creature', cardType: 'Creature', cost: { water: 4 }, power: 3, toughness: 4, abilities: ['vigilance'], name: 'Hydrobot', desc: 'Pressure-powered guardian', theme: 'Science Fiction' },
            water_ice_gargoyle: { emoji: '🧊', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 2, abilities: ['flying'], name: 'Ice Gargoyle', desc: 'Frozen winged sentinel', theme: 'Fantasy' },
            water_wave_skater: { emoji: '🛹', type: 'creature', cardType: 'Creature', cost: { water: 2 }, power: 2, toughness: 1, abilities: ['haste'], name: 'Wave Skater', desc: 'Rides every surge', theme: 'City' },

            earth_mole_engineer: { emoji: '🦫', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 3, abilities: ['defender'], name: 'Mole Engineer', desc: 'Builds underground walls', theme: 'Nature' },
            earth_bison_guard: { emoji: '🐃', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 3, abilities: ['vigilance'], name: 'Bison Guard', desc: 'Steadfast herd protector', theme: 'Nature' },
            earth_stone_serpent: { emoji: '🐍', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Stone Serpent', desc: 'Cracks the battlefield', theme: 'Fantasy' },
            earth_garden_giant: { emoji: '🧑‍🌱', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 4, abilities: ['trample'], name: 'Garden Giant', desc: 'Grows with every step', theme: 'Nature' },
            earth_lumber_mammoth: { emoji: '🪵', type: 'creature', cardType: 'Creature', cost: { earth: 4 }, power: 4, toughness: 5, abilities: ['trample'], name: 'Lumber Mammoth', desc: 'Carries whole forests', theme: 'Nature' },
            earth_cactus_guardian: { emoji: '🌵', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 1, toughness: 4, abilities: ['defender'], name: 'Cactus Guardian', desc: 'Painful to attack into', theme: 'Nature' },
            earth_hiker: { emoji: '🥾', type: 'creature', cardType: 'Creature', cost: { earth: 1 }, power: 1, toughness: 2, abilities: ['vigilance'], name: 'Trail Hiker', desc: 'Finds every safe path', theme: 'City' },
            earth_badlands_boar: { emoji: '🦬', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 3, toughness: 3, abilities: ['first_strike'], name: 'Badlands Boar', desc: 'Tusks like blades', theme: 'Nature' },
            earth_mountain_ram: { emoji: '🐐', type: 'creature', cardType: 'Creature', cost: { earth: 2 }, power: 2, toughness: 2, abilities: ['first_strike'], name: 'Mountain Ram', desc: 'Surefooted charger', theme: 'Nature' },
            earth_temple_keeper: { emoji: '🛖', type: 'creature', cardType: 'Creature', cost: { earth: 3 }, power: 2, toughness: 4, abilities: ['reach'], name: 'Temple Keeper', desc: 'Defends sacred ruins', theme: 'Fantasy' },

            swamp_grim_crow: { emoji: '🐦‍⬛', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 1, abilities: ['flying'], name: 'Grim Crow', desc: 'Messenger of doom', theme: 'Fantasy' },
            swamp_leech: { emoji: '🪱', type: 'creature', cardType: 'Creature', cost: { swamp: 1 }, power: 1, toughness: 1, abilities: ['lifelink'], name: 'Blood Leech', desc: 'Feeds to empower you', theme: 'Nature' },
            swamp_bone_hound: { emoji: '🐕‍🦺', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Bone Hound', desc: 'Tracks by scent of fear', theme: 'Fantasy' },
            swamp_grave_digger: { emoji: '⛏️', type: 'creature', cardType: 'Creature', cost: { swamp: 2  }, power: 2, toughness: 2, abilities: [], name: 'Grave Digger', desc: 'Unearths dark relics', theme: 'City' },
            swamp_witch_cat: { emoji: '🐈‍⬛', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 2, toughness: 2, abilities: ['hexproof'], name: 'Witch Cat', desc: 'Avoids targeted spells', theme: 'Fantasy' },
            swamp_night_reaper: { emoji: '🪦', type: 'creature', cardType: 'Creature', cost: { swamp: 4 }, power: 4, toughness: 3, abilities: ['deathtouch'], name: 'Night Reaper', desc: 'One touch ends battles', theme: 'Fantasy' },
            swamp_toxic_frog: { emoji: '🐸', type: 'creature', cardType: 'Creature', cost: { swamp: 2 }, power: 1, toughness: 3, abilities: ['deathtouch'], name: 'Toxic Frog', desc: 'Venomous guardian', theme: 'Nature' },
            swamp_phantom_train: { emoji: '🚂', type: 'creature', cardType: 'Creature', cost: { swamp: 5 }, power: 5, toughness: 4, abilities: ['menace', 'trample'], name: 'Phantom Train', desc: 'Haunts midnight tracks', theme: 'City' },
            swamp_dread_clown: { emoji: '🤡', type: 'creature', cardType: 'Creature', cost: { swamp: 3 }, power: 3, toughness: 2, abilities: ['menace'], name: 'Dread Clown', desc: 'Lurks in shadows', theme: 'City' },
            swamp_night_moth: { emoji: '🦋', type: 'creature', cardType: 'Creature', cost: { swamp: 1 }, power: 1, toughness: 1, abilities: ['flying'], name: 'Night Moth', desc: 'Dark-winged nuisance', theme: 'Nature' },

            light_monk: { emoji: '🧘', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 2, toughness: 2, abilities: ['lifelink'], name: 'Sun Monk', desc: 'Balance through radiance', theme: 'Fantasy' },
            light_lantern_guard: { emoji: '🏮', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 1, toughness: 3, abilities: ['vigilance'], name: 'Lantern Guard', desc: 'Watches through night', theme: 'City' },
            light_dove_rider: { emoji: '🕊️', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 3, abilities: ['flying'], name: 'Dove Rider', desc: 'Carries blessings aloft', theme: 'Fantasy' },
            light_paladin_captain: { emoji: '🛡️', type: 'creature', cardType: 'Creature', cost: { light: 4 }, power: 4, toughness: 4, abilities: ['first_strike', 'vigilance'], name: 'Paladin Captain', desc: 'Leads with honor', theme: 'Fantasy' },
            light_choir_angel: { emoji: '🎶', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 2, abilities: ['flying', 'lifelink'], name: 'Choir Angel', desc: 'Songs mend wounded hearts', theme: 'Fantasy' },
            light_healer_bot: { emoji: '🩺', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 2, toughness: 4, abilities: ['lifelink'], name: 'Healer Bot', desc: 'Programmed for mercy', theme: 'Science Fiction' },
            light_beacon_keeper: { emoji: '🗼', type: 'creature', cardType: 'Creature', cost: { light: 2 }, power: 2, toughness: 2, abilities: ['reach'], name: 'Beacon Keeper', desc: 'Guides allies safely', theme: 'City' },
            light_solar_drake: { emoji: '🐲', type: 'creature', cardType: 'Creature', cost: { light: 5 }, power: 5, toughness: 4, abilities: ['flying'], name: 'Solar Drake', desc: 'Burns with holy fire', theme: 'Fantasy' },
            light_daybreak_stag: { emoji: '🦌', type: 'creature', cardType: 'Creature', cost: { light: 3 }, power: 3, toughness: 3, abilities: ['vigilance'], name: 'Daybreak Stag', desc: 'Herald of dawn', theme: 'Nature' },
            light_mirror_knight: { emoji: '🪞', type: 'creature', cardType: 'Creature', cost: { light: 4 }, power: 3, toughness: 5, abilities: ['hexproof'], name: 'Mirror Knight', desc: 'Reflects hostile magic', theme: 'Fantasy' },
        },
        
        // SPELLS - GREATLY EXPANDED
        spells: {
            // Fire Spells
            fireball: { emoji: '💥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 3 }, effect: 'damage', value: 3, name: 'Fireball', desc: 'Deal 3 damage to the enemy', theme: 'Fantasy' },
            explosion: { emoji: '🎆', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 4 }, effect: 'damage', value: 4, name: 'Explosion', desc: 'Deal 4 damage to the enemy', theme: 'Fantasy' },
            inferno: { emoji: '🔥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 5 }, effect: 'damage', value: 5, name: 'Inferno', desc: 'Deal 5 damage to the enemy', theme: 'Fantasy' },
            meteor: { emoji: '☄️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 6 }, effect: 'damage', value: 6, name: 'Meteor Strike', desc: 'Devastating impact', theme: 'Nature' },
            flame: { emoji: '🕯️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 1 }, effect: 'damage', value: 1, name: 'Flame Jet', desc: 'Quick burn', theme: 'Fantasy' },
            anger: { emoji: '🤬', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 2 }, effect: 'buff', value: 3, buffType: 'power', untilEndOfTurn: true, name: 'Anger', desc: '+3/+0 to creature until end of turn', theme: 'City' },

            // Water Spells
            freeze: { emoji: '❄️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'tap', name: 'Freeze', desc: 'Tap target creature', theme: 'Nature' },
            tsunami: { emoji: '🌊', type: 'instant', cardType: 'Instant/Spell', cost: { water: 5 }, effect: 'bounce', name: 'Tsunami', desc: 'Return creatures to hand', theme: 'Nature' },
            bubble: { emoji: '🫧', type: 'instant', cardType: 'Instant/Spell', cost: { water: 3 }, effect: 'buff_defense', value: 3, name: 'Bubble Shield', desc: '+0/+3 to creature', theme: 'Fantasy' },
            rain: { emoji: '🌧️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'heal', value: 2, name: 'Healing Rain', desc: 'Restore 2 life', theme: 'Nature' },
            whirlpool: { emoji: '🌀', type: 'instant', cardType: 'Instant/Spell', cost: { water: 4 }, effect: 'destroy', name: 'Whirlpool', desc: 'Destroy target creature', theme: 'Nature' },
            deep_freeze: { emoji: '🥶', type: 'instant', cardType: 'Instant/Spell', cost: { water: 3 }, effect: 'tap', skipUntap: true, name: 'Deep Freeze', desc: 'Tap target creature, it doesn\'t untap', theme: 'Fantasy' },
            surf: { emoji: '🏄', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'buff', value: 2, grantAbilities: ['unblockable'], name: 'Surf', desc: 'Creature gets +2/+2 and unblockable', theme: 'City' },
            coral: { emoji: '🪸', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'buff_defense', value: 2, name: 'Coral Shield', desc: '+0/+2 to creature', theme: 'Nature' },

            // Earth Spells
            earthquake: { emoji: '🌋', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 4 }, effect: 'damage', value: 2, target: 'all', name: 'Earthquake', desc: 'Deal 2 to all creatures', theme: 'Nature' },
            growth: { emoji: '🌱', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'buff', value: 2, name: 'Growth', desc: '+2/+2 to creature', theme: 'Nature' },
            roots: { emoji: '🌿', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 1 }, effect: 'buff_defense', value: 2, name: 'Tangling Roots', desc: '+0/+2 to creature', theme: 'Nature' },
            avalanche: { emoji: '🏔️', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 5 }, effect: 'damage', value: 3, target: 'all', name: 'Avalanche', desc: 'Deal 3 to all creatures', theme: 'Nature' },
            harvest: { emoji: '🌾', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'draw', value: 2, name: 'Harvest', desc: 'Draw 2 cards', theme: 'Nature' },
            wrestle: { emoji: '🤼', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 3 }, effect: 'destroy', name: 'Wrestle', desc: 'Destroy target creature', theme: 'City' },
            shroom: { emoji: '🍄', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 1 }, effect: 'buff', value: 1, name: 'Mushroom Power', desc: '+1/+1 to creature', theme: 'Nature' },

            // Swamp Spells
            curse: { emoji: '🔮', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3 }, effect: 'destroy', name: 'Curse', desc: 'Destroy target creature', theme: 'Fantasy' },
            drain: { emoji: '💉', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 2 }, effect: 'drain', value: 2, name: 'Drain Life', desc: 'Deal 2, gain 2 life', theme: 'Fantasy' },
            poison: { emoji: '☠️', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3 }, effect: 'damage', value: 3, name: 'Poison', desc: 'Deal 3 damage', theme: 'Fantasy' },
            necromancy: { emoji: '⚰️', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 4 }, effect: 'revive', name: 'Necromancy', desc: 'Return creature from graveyard', theme: 'Fantasy' },
            terror: { emoji: '😱', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 2 }, effect: 'tap', name: 'Terror', desc: 'Tap target creature', theme: 'Fantasy' },

            // Light Spells
            heal: { emoji: '✨', type: 'instant', cardType: 'Instant/Spell', cost: { light: 2 }, effect: 'heal', value: 3, name: 'Heal', desc: 'Restore 3 life', theme: 'Fantasy' },
            smite: { emoji: '⚡', type: 'instant', cardType: 'Instant/Spell', cost: { light: 3 }, effect: 'damage', value: 3, name: 'Divine Smite', desc: 'Deal 3 damage', theme: 'Fantasy' },
            blessing: { emoji: '🙏', type: 'instant', cardType: 'Instant/Spell', cost: { light: 2 }, effect: 'buff', value: 2, name: 'Blessing', desc: '+2/+2 to creature', theme: 'Fantasy' },
            light_beam: { emoji: '💫', type: 'instant', cardType: 'Instant/Spell', cost: { light: 4 }, effect: 'damage', value: 4, name: 'Light Beam', desc: 'Deal 4 damage', theme: 'Fantasy' },
            resurrection: { emoji: '⛪', type: 'instant', cardType: 'Instant/Spell', cost: { light: 5 }, effect: 'revive', name: 'Resurrection', desc: 'Return creature from graveyard', theme: 'Fantasy' },
            in_clouds: { emoji: '😶‍🌫️', type: 'instant', cardType: 'Instant/Spell', cost: { light: 2 }, effect: 'buff_defense', value: 2, grantAbilities: ['flying'], name: 'In the Clouds', desc: 'Creature gains +0/+2 and flying', theme: 'Fantasy' },
            meditate: { emoji: '🧘🏽‍♀️', type: 'instant', cardType: 'Instant/Spell', cost: { light: 1 }, effect: 'heal_draw', value: 2, drawCards: 1, name: 'Meditate', desc: 'Restore 2 life and draw a card', theme: 'City' },
            feather: { emoji: '🪶', type: 'instant', cardType: 'Instant/Spell', cost: { light: 1 }, effect: 'buff', value: 1, grantAbilities: ['flying'], name: 'Feather', desc: '+1/+1 and flying to creature', theme: 'Nature' },

            // Token Generation Spells
            summon_spirits: { emoji: '👻', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3 }, effect: 'token', value: 2, tokenType: 'spirit', name: 'Summon Spirits', desc: 'Create 2 Spirit tokens (1/1 flying)', theme: 'Fantasy' },
            raise_army: { emoji: '⚔️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 4 }, effect: 'token', value: 3, tokenType: 'soldier', name: 'Raise Army', desc: 'Create 3 Soldier tokens (1/1)', theme: 'Fantasy' },
            forest_call: { emoji: '🌲', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 3 }, effect: 'token', value: 2, tokenType: 'beast', name: 'Call of the Forest', desc: 'Create 2 Beast tokens (2/2)', theme: 'Nature' },

            // Mixed Color Spells
            web: { emoji: '🕸️', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 1, fire: 1 }, effect: 'tap', name: 'Web Trap', desc: 'Tap target creature', theme: 'Nature' },
            comet: { emoji: '☄️', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3, fire: 2 }, effect: 'damage', value: 5, name: 'Comet Strike', desc: 'Deal 5 damage to the enemy', theme: 'Science Fiction' },

            // Discard Spells
            mind_rot: { emoji: '🧠', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 2 }, effect: 'discard', value: 2, name: 'Mind Rot', desc: 'Enemy discards 2 cards', theme: 'Fantasy' },
            thought_steal: { emoji: '💭', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3 }, effect: 'discard_draw', value: 1, name: 'Thought Steal', desc: 'Enemy discards 1, you draw 1', theme: 'Fantasy' }
        },

        // ARTIFACTS - EXPANDED
        artifacts: {
            sword: { emoji: '⚔️', type: 'artifact', cardType: 'Artifact', cost: { fire: 2 }, effect: 'buff', value: 2, buffType: 'power', name: 'Flaming Sword', desc: 'Equipped creature gets +2/+0', theme: 'Fantasy' },
            shield: { emoji: '🛡️', type: 'artifact', cardType: 'Artifact', cost: { earth: 2 }, effect: 'buff_defense', value: 2, name: 'Earth Shield', desc: 'Equipped creature gets +0/+2', theme: 'Fantasy' },
            crown: { emoji: '👑', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'draw', value: 1, name: 'Crown of Power', desc: 'Draw extra card each turn', theme: 'Fantasy' },
            gem: { emoji: '💎', type: 'artifact', cardType: 'Artifact', cost: { water: 2 }, effect: 'mana', value: 1, name: 'Mana Gem', desc: 'Generate extra mana', theme: 'Fantasy' },
            bomb: { emoji: '💣', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'aoe', value: 2, name: 'Bomb', desc: 'Deal 2 to each enemy creature', theme: 'City' },
            chalice: { emoji: '🏆', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'heal', value: 1, name: 'Holy Chalice', desc: 'Gain 1 life each turn', theme: 'Fantasy' },
            scroll: { emoji: '📜', type: 'artifact', cardType: 'Artifact', cost: { swamp: 2 }, effect: 'draw', value: 1, name: 'Dark Scroll', desc: 'Draw an extra card each turn', theme: 'Fantasy' },
            orb: { emoji: '🔮', type: 'artifact', cardType: 'Artifact', cost: { swamp: 3 }, effect: 'damage', value: 1, name: 'Cursed Orb', desc: 'Deal 1 to enemy each turn', theme: 'Fantasy' },
            horn: { emoji: '📯', type: 'artifact', cardType: 'Artifact', cost: { earth: 2 }, effect: 'buff', value: 1, buffType: 'power', targetAll: true, name: 'War Horn', desc: 'Your creatures get +1/+0', theme: 'City' },
            amulet: { emoji: '🪬', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'buff_defense', value: 1, targetAll: true, name: 'Protective Amulet', desc: 'Your creatures get +0/+1', theme: 'Fantasy' },
            ring: { emoji: '💍', type: 'artifact', cardType: 'Artifact', cost: { fire: 1, water: 1 }, effect: 'mana', value: 1, name: 'Magic Ring', desc: 'Boost mana production', theme: 'Fantasy' },
            armor: { emoji: '🦺', type: 'artifact', cardType: 'Artifact', cost: { earth: 3 }, effect: 'buff_defense', value: 3, name: 'Heavy Armor', desc: '+0/+3 to equipped', theme: 'City' },
            axe: { emoji: '🪓', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'buff', value: 3, buffType: 'power', name: 'Battle Axe', desc: '+3/+0 to equipped', theme: 'Fantasy' },
            bow: { emoji: '🏹', type: 'artifact', cardType: 'Artifact', cost: { earth: 2, light: 1 }, effect: 'buff', value: 2, buffType: 'power', grantAbilities: ['flying'], name: 'Elven Bow', desc: '+2/+0 and flying', theme: 'Fantasy' },
            wand: { emoji: '🪄', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'damage', value: 2, name: 'Magic Wand', desc: 'Deal 2 damage to the enemy each turn', theme: 'Fantasy' },
            halo: { emoji: '😇', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'buff', value: 1, targetAll: true, grantAbilities: ['lifelink'], name: 'Halo', desc: 'All your creatures get +1/+1 and lifelink', theme: 'Fantasy' },
            dna_artifact: { emoji: '🧬', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'draw_on_play', value: 1, name: 'DNA Sequence', desc: 'Draw a card when played', theme: 'Science Fiction' },
            fingerprint: { emoji: '🫴', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'mana', value: 1, name: 'Fingerprint Scanner', desc: 'Add 1 colorless mana', theme: 'Science Fiction' },
            footsteps: { emoji: '👣', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'buff', value: 0, targetAll: true, grantAbilities: ['haste'], name: 'Footsteps', desc: 'Your creatures get haste', theme: 'Science Fiction' },
            prism_core: { emoji: '🔋', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'mana', value: 1, name: 'Prism Core', desc: 'Adds 1 colorless mana', theme: 'Science Fiction' },
            gravity_boots: { emoji: '🥾', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'buff', value: 1, buffType: 'power', grantAbilities: ['haste'], name: 'Gravity Boots', desc: '+1/+0 and haste', theme: 'Science Fiction' },
            chrono_watch: { emoji: '⌚', type: 'artifact', cardType: 'Artifact', cost: { colorless: 3 }, effect: 'draw', value: 1, name: 'Chrono Watch', desc: 'Draw an extra card each upkeep', theme: 'Science Fiction' },
            nano_shield: { emoji: '🧫', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'buff_defense', value: 2, name: 'Nano Shield', desc: '+0/+2 to equipped creature', theme: 'Science Fiction' },
            signal_tower: { emoji: '📡', type: 'artifact', cardType: 'Artifact', cost: { colorless: 3 }, effect: 'damage', value: 1, name: 'Signal Tower', desc: 'Deals 1 damage each upkeep', theme: 'Science Fiction' },
            mech_claw: { emoji: '🦾', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'buff', value: 2, buffType: 'power', name: 'Mech Claw', desc: '+2/+0 to equipped creature', theme: 'Science Fiction' },
            aether_lens: { emoji: '🔭', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'draw_on_play', value: 1, name: 'Aether Lens', desc: 'Draw a card when played', theme: 'Science Fiction' },
            repair_drone: { emoji: '🛸', type: 'artifact', cardType: 'Artifact', cost: { colorless: 3 }, effect: 'heal', value: 1, name: 'Repair Drone', desc: 'Gain 1 life each upkeep', theme: 'Science Fiction' },
            void_compass: { emoji: '🧭', type: 'artifact', cardType: 'Artifact', cost: { colorless: 1 }, effect: 'mana', value: 1, name: 'Void Compass', desc: 'Fixes mana with colorless energy', theme: 'Science Fiction' },
            relic_cache: { emoji: '🗄️', type: 'artifact', cardType: 'Artifact', cost: { colorless: 2 }, effect: 'draw', value: 1, name: 'Relic Cache', desc: 'Stores knowledge to draw cards', theme: 'Fantasy' }
        }
    };

    function slugifyCardText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getAllCardsFlat() {
        const cards = [];

        Object.entries(CARD_DATABASE).forEach(([category, categoryCards]) => {
            Object.values(categoryCards).forEach(card => {
                card._category = category;
                cards.push(card);
            });
        });

        return cards;
    }

    function getCardId(card) {
        const categorySlug = slugifyCardText(card && card._category ? card._category : 'card');
        const nameSlug = slugifyCardText(card && card.name ? card.name : card && card.emoji ? card.emoji : 'unnamed');
        return `${categorySlug}-${nameSlug}`;
    }

    function inferRarity(card) {
        const text = `${card.name || ''} ${card.desc || ''}`.toLowerCase();
        const abilities = Array.isArray(card.abilities) ? card.abilities : [];
        const keywords = ['legendary', 'ancient', 'cosmic', 'phoenix', 'dragon', 'angel', 'demon', 'titan'];
        const highValueEffects = ['destroy', 'counter', 'boardwipe', 'discard_draw'];
        const landName = (card.name || '').toLowerCase();

        let score = 0;

        if (keywords.some(keyword => text.includes(keyword))) score += 3;
        if ((card.power || 0) + (card.toughness || 0) >= 9) score += 2;
        if ((card.power || 0) >= 5 || (card.toughness || 0) >= 6) score += 2;
        if (abilities.length >= 2) score += 2;
        if (abilities.includes('flying') && abilities.includes('trample')) score += 1;
        if (highValueEffects.includes(card.effect)) score += 2;
        if ((card.value || 0) >= 3) score += 1;
        if ((card.type || '').toLowerCase() === 'land') {
            if (Array.isArray(card.elements) && card.elements.length > 1) score += 2;
            if (landName.includes('rainbow') || landName.includes('crystal') || landName.includes('distant')) score += 2;
        }

        if (score >= 6) return 'legendary';
        if (score >= 4) return 'epic';
        if (score >= 2) return 'rare';
        return 'common';
    }

    const __ALL_CARDS = getAllCardsFlat();
    const __CARD_BY_ID = Object.create(null);

    __ALL_CARDS.forEach(card => {
        card.__id = getCardId(card);
        card.__rarity = inferRarity(card);
        __CARD_BY_ID[card.__id] = card;
    });

    window.__ALL_CARDS = __ALL_CARDS;
    window.__CARD_BY_ID = __CARD_BY_ID;

    // META persistence module
    const BASE_WIN_CREDITS = 25;
    const BASE_LOSS_CREDITS = 10;
    const WIN_FREE_PACK_CHANCE = 0.15;
    const STARTER_CREDITS = 100;
    const STARTER_MONO_DECK_KEYS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT'];
    const STARTER_DUAL_DECK_KEYS = [
        'FIRE_WATER',
        'FIRE_EARTH',
        'FIRE_SWAMP',
        'FIRE_LIGHT',
        'WATER_EARTH',
        'WATER_SWAMP',
        'WATER_LIGHT',
        'EARTH_SWAMP',
        'EARTH_LIGHT',
        'SWAMP_LIGHT'
    ];
    const STANDARD_DECK_SIZE = 60;
    const STANDARD_MAX_LANDS = 20;
    const DUAL_DECK_MAX_LANDS_PER_COLOR = 11;
    const DUAL_DECK_MAX_LANDS_TOTAL = DUAL_DECK_MAX_LANDS_PER_COLOR * 2;

    function getDeckLandCaps(deckColors) {
        const normalizedColors = Array.isArray(deckColors)
            ? deckColors.filter(color => ELEMENTS[color]).slice(0, 2)
            : [];
        if (normalizedColors.length === 1) {
            return {
                maxLands: STANDARD_MAX_LANDS,
                maxPerColor: { [normalizedColors[0]]: STANDARD_MAX_LANDS },
                colors: normalizedColors
            };
        }

        if (normalizedColors.length >= 2) {
            return {
                maxLands: DUAL_DECK_MAX_LANDS_TOTAL,
                maxPerColor: {
                    [normalizedColors[0]]: DUAL_DECK_MAX_LANDS_PER_COLOR,
                    [normalizedColors[1]]: DUAL_DECK_MAX_LANDS_PER_COLOR
                },
                colors: normalizedColors
            };
        }

        return { maxLands: STANDARD_MAX_LANDS, maxPerColor: {}, colors: [] };
    }

    function inferLandElements(card) {
        if (!card || card.type !== 'land') return [];
        const output = [];
        if (Array.isArray(card.elements)) {
            card.elements.forEach(element => {
                if ((element === 'colorless' || ELEMENTS[element]) && !output.includes(element)) {
                    output.push(element);
                }
            });
        }
        if (card.element && (card.element === 'colorless' || ELEMENTS[card.element]) && !output.includes(card.element)) {
            output.push(card.element);
        }
        return output;
    }

    function getDeckColorsFromKey(deckKey) {
        return String(deckKey || '')
            .split('_')
            .map(part => part.toLowerCase())
            .filter(color => ELEMENTS[color]);
    }

    function getDeckKeyFromElements(elements) {
        const normalized = Array.isArray(elements)
            ? [...new Set(elements.filter(element => ELEMENTS[element]))]
            : [];

        if (normalized.length === 0) return null;
        if (normalized.length === 1) return normalized[0].toUpperCase();

        const priority = ['fire', 'water', 'earth', 'swamp', 'light'];
        const ordered = [...normalized].sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
        return ordered.slice(0, 2).map(color => color.toUpperCase()).join('_');
    }

    function getDeckCardCopyLimit(card) {
        if (!card || card.type === 'land') return Number.POSITIVE_INFINITY;
        return card.__rarity === 'legendary' ? 1 : 2;
    }

    function getDeckBuilderCopyLimit(card) {
        if (!card) return 0;
        // Basic lands are limited by the deck's land caps (getDeckLandCaps), not by copy count.
        if (card.type === 'land' && card.element && card.element !== 'colorless') return Number.POSITIVE_INFINITY;
        return card.__rarity === 'legendary' ? 1 : 2;
    }

    function validateDeckBuild(deckKey, cardIds, meta) {
        const errors = [];
        const safeMeta = meta && typeof meta === 'object' ? meta : {};
        const deck = safeMeta?.decks?.[deckKey];
        const candidate = Array.isArray(cardIds) ? cardIds : [];
        const targetSize = getDeckTargetSize(deck);
        const deckColors = Array.isArray(deck?.colors) && deck.colors.length > 0
            ? deck.colors
            : getDeckColorsFromKey(deckKey);
        const landCaps = getDeckLandCaps(deckColors);
        const landColorCounts = {};
        let totalLands = 0;
        const collection = safeMeta?.collection || {};
        const usedCounts = {};

        if (candidate.length !== targetSize) {
            errors.push(`Deck must contain exactly ${targetSize} cards (currently ${candidate.length}).`);
        }

        candidate.forEach(cardId => {
            const card = __CARD_BY_ID[cardId];
            if (!card) {
                errors.push(`Unknown card id: ${cardId}`);
                return;
            }

            usedCounts[cardId] = (usedCounts[cardId] || 0) + 1;

            if (!isCardEligibleForDeck(card, deckColors)) {
                errors.push(`${card.name} is not valid for ${deckKey} identity.`);
            }

            const owned = Number.isFinite(collection[cardId]) ? collection[cardId] : 0;
            if (usedCounts[cardId] > owned) {
                errors.push(`${card.name} exceeds owned copies (${usedCounts[cardId]}/${owned}).`);
            }

            const maxCopies = getDeckBuilderCopyLimit(card);
            if (usedCounts[cardId] > maxCopies) {
                errors.push(`${card.name} exceeds max copies (${maxCopies}${maxCopies === 1 ? ', legendary limit' : ''}).`);
            }

            if (card.type === 'land') {
                totalLands += 1;
                const supportedLandColors = inferLandElements(card)
                    .filter(element => element !== 'colorless' && landCaps.colors.includes(element));

                if (landCaps.colors.length > 0 && supportedLandColors.length === 0) {
                    errors.push(`${card.name} is not a valid land color for ${deckKey}.`);
                } else if (supportedLandColors.length > 0) {
                    const targetColor = supportedLandColors
                        .sort((a, b) => (landColorCounts[a] || 0) - (landColorCounts[b] || 0))[0];
                    landColorCounts[targetColor] = (landColorCounts[targetColor] || 0) + 1;
                }
            }
        });

        if (totalLands > landCaps.maxLands) {
            errors.push(`Deck can contain at most ${landCaps.maxLands} lands (currently ${totalLands}).`);
        }

        Object.entries(landCaps.maxPerColor).forEach(([color, max]) => {
            const used = landColorCounts[color] || 0;
            if (used > max) {
                errors.push(`${deckKey} can contain at most ${max} ${color} lands (currently ${used}).`);
            }
        });

        return {
            ok: errors.length === 0,
            errors: [...new Set(errors)]
        };
    }

    function metaLoad() {
        if (!isMetaRuntimeEnabled()) return null;

        const raw = localStorage.getItem(META_STORAGE_KEY);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            console.warn('Invalid meta save, rebuilding.', error);
            return null;
        }
    }

    function metaSave(meta) {
        if (!isMetaRuntimeEnabled()) return false;
        if (profileWriteState === 'pending') return false; // initialization waits for the browser lock
        if (!canSaveProfile()) return false;
        try {
            // Also refuse snapshots changed by an older build or external writer without our lock.
            if (localStorage.getItem(META_STORAGE_KEY) !== profileSavedRaw) {
                profileWriteState = 'reader';
                persistenceNotice('This profile changed elsewhere. Reload to use its latest saved progress.');
                return false;
            }
            const raw = JSON.stringify(meta);
            localStorage.setItem(META_STORAGE_KEY, raw);
            profileSavedRaw = raw;
            return true;
        } catch (error) {
            console.warn('Meta save failed.', error);
            persistenceNotice('Progress could not be saved: browser storage is full or blocked. Keep this tab open.', true);
            showGameLog('⚠️ Progress could not be saved: browser storage is full or blocked.', true);
            return false;
        }
    }

    const META_BACKUP_KEY = QA_MODE ? 'emoji_elements_meta_qa_backups' : 'emoji_elements_meta_backups';
    const META_BACKUP_LIMIT = 3;

    // Keeps the exact stored text of a profile before the game rewrites it (PROGRESSION.md §7).
    function backupMetaRaw(raw, reason) {
        if (raw === null) return true;
        if (profileWriteState !== 'writer') return false;
        try {
            const previous = JSON.parse(localStorage.getItem(META_BACKUP_KEY) || '[]');
            const backups = Array.isArray(previous) ? previous : [];
            backups.push({ savedAt: new Date().toISOString(), reason, raw });
            localStorage.setItem(META_BACKUP_KEY, JSON.stringify(backups.slice(-META_BACKUP_LIMIT)));
            return true;
        } catch (error) {
            console.warn('Could not back up the previous save.', error);
            profileRepairBlocked = true;
            persistenceNotice('The original save could not be backed up. It has been kept unchanged; progress here is not saved.');
            return false;
        }
    }

    // Wins/losses from the pre-meta build's emojiElementsStats, for a brand-new profile (PROGRESSION.md P7.4).
    function importLegacyStats(meta) {
        try {
            const legacy = JSON.parse(localStorage.getItem(LEGACY_STATS_STORAGE_KEY) || 'null');
            if (!legacy || typeof legacy !== 'object') return;
            meta.stats.wins = readStoredNumber(legacy.wins) ?? 0;
            meta.stats.losses = readStoredNumber(legacy.losses) ?? 0;
        } catch (_) {
            // unreadable legacy stats: start from zero
        }
    }

    // A number that may have been stored as text; null when it isn't a finite number.
    function readStoredNumber(value) {
        const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        return typeof number === 'number' && Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
    }

    function sameCardMultiset(a, b) {
        if (a.length !== b.length) return false;
        const counts = {};
        a.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        return b.every(id => (counts[id] = (counts[id] || 0) - 1) >= 0);
    }

    // ownedCounts (optional) limits each card to the copies the starter collection owns.
    function buildStarterDeckFromColors(deckKey, colors, ownedCounts = null) {
        const landCaps = getDeckLandCaps(colors);
        const LAND_COUNT = landCaps.maxLands;
        const NON_LAND_COUNT = Math.max(0, STANDARD_DECK_SIZE - LAND_COUNT);
        const STARTER_TYPE_TARGETS = {
            creature: 20,
            instant: 9,
            artifact: 6
        };
        const rarityWeight = {
            common: 0,
            rare: 1,
            epic: 2,
            legendary: 3
        };

        const cardIds = [];
        const cardCounts = {};
        const nonLandCardCounts = {};

        function addCardById(cardId, amount = 1) {
            const card = __CARD_BY_ID[cardId];
            if (!card) return;
            const limit = Math.min(getDeckCardCopyLimit(card), ownedCounts ? (ownedCounts[cardId] || 0) : Number.POSITIVE_INFINITY);
            const current = cardCounts[cardId] || 0;
            const room = Math.max(0, limit - current);
            const toAdd = Math.min(room, amount);
            for (let i = 0; i < toAdd; i++) {
                cardIds.push(cardId);
            }
            cardCounts[cardId] = current + toAdd;
            if (card.type !== 'land') {
                nonLandCardCounts[cardId] = (nonLandCardCounts[cardId] || 0) + toAdd;
            }
        }

        function getNonLandCount() {
            return Object.keys(nonLandCardCounts).reduce((sum, id) => sum + (nonLandCardCounts[id] || 0), 0);
        }

        function getManaValue(card) {
            return Object.values(card.cost || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        }

        function sortStarterPool(pool) {
            return [...pool].sort((a, b) => {
                const manaDiff = getManaValue(a) - getManaValue(b);
                if (manaDiff !== 0) return manaDiff;

                const rarityDiff = (rarityWeight[a.__rarity] ?? 10) - (rarityWeight[b.__rarity] ?? 10);
                if (rarityDiff !== 0) return rarityDiff;

                return a.__id.localeCompare(b.__id);
            });
        }

        function addFromPool(pool, targetCount) {
            if (!Array.isArray(pool) || pool.length === 0 || targetCount <= 0) return;

            const orderedPool = sortStarterPool(pool);
            while (getNonLandCount() < NON_LAND_COUNT && targetCount > 0) {
                let addedInPass = false;

                for (const card of orderedPool) {
                    if (targetCount <= 0 || getNonLandCount() >= NON_LAND_COUNT) break;

                    const before = nonLandCardCounts[card.__id] || 0;
                    addCardById(card.__id, 1);
                    const after = nonLandCardCounts[card.__id] || 0;
                    if (after > before) {
                        targetCount -= 1;
                        addedInPass = true;
                    }
                }

                if (!addedInPass) break;
            }
        }

        if (colors.length === 1) {
            const monoLand = __CARD_BY_ID[getCardId(CARD_DATABASE.lands[colors[0]])];
            if (monoLand) {
                for (let i = 0; i < LAND_COUNT; i++) {
                    cardIds.push(monoLand.__id);
                }
            }
        } else {
            const firstCount = landCaps.maxPerColor[colors[0]] || Math.ceil(LAND_COUNT / 2);
            const secondCount = landCaps.maxPerColor[colors[1]] || (LAND_COUNT - firstCount);
            const firstLand = __CARD_BY_ID[getCardId(CARD_DATABASE.lands[colors[0]])];
            const secondLand = __CARD_BY_ID[getCardId(CARD_DATABASE.lands[colors[1]])];
            if (firstLand) {
                for (let i = 0; i < firstCount; i++) {
                    cardIds.push(firstLand.__id);
                }
            }
            if (secondLand) {
                for (let i = 0; i < secondCount; i++) {
                    cardIds.push(secondLand.__id);
                }
            }
        }

        const eligibleNonLands = __ALL_CARDS
            .filter(card => card.type !== 'land')
            .filter(card => {
                const costElements = Object.keys(card.cost || {});
                return costElements.every(element => element === 'colorless' || colors.includes(element));
            });

        const creaturePool = eligibleNonLands.filter(card => card.type === 'creature');
        const spellPool = eligibleNonLands.filter(card => card.type === 'instant');
        const artifactPool = eligibleNonLands.filter(card => card.type === 'artifact');

        addFromPool(creaturePool, STARTER_TYPE_TARGETS.creature);
        addFromPool(spellPool, STARTER_TYPE_TARGETS.instant);
        addFromPool(artifactPool, STARTER_TYPE_TARGETS.artifact);

        if (getNonLandCount() < NON_LAND_COUNT) {
            addFromPool(eligibleNonLands, NON_LAND_COUNT - getNonLandCount());
        }

        return {
            deckKey,
            colors: [...colors],
            starterCardIds: [...cardIds],
            cardIds
        };
    }

    function createInitialMeta() {
        const decks = {};
        const collection = {};
        STARTER_MONO_DECK_KEYS.forEach(deckKey => {
            const starterDeck = buildStarterDeckFromColors(deckKey, getDeckColorsFromKey(deckKey));
            decks[deckKey] = starterDeck;
            starterDeck.cardIds.forEach(cardId => {
                collection[cardId] = (collection[cardId] || 0) + 1;
            });
        });

        // Dual starters only use cards the mono starters already gave you, so every starter deck is owned.
        STARTER_DUAL_DECK_KEYS.forEach(deckKey => {
            decks[deckKey] = buildStarterDeckFromColors(deckKey, getDeckColorsFromKey(deckKey), collection);
        });

        return {
            version: 1,
            initialized: true,
            collection,
            decks,
            selectedDeckKey: 'FIRE',
            stats: { wins: 0, losses: 0, packsOpened: 0 },
            wallet: { credits: STARTER_CREDITS },
            lastPack: null
        };
    }

    function clampDeckCardIdsToOwned(cardIds, collection) {
        const ownedRemaining = { ...(collection || {}) };
        const usageCount = {};
        const output = [];

        (Array.isArray(cardIds) ? cardIds : []).forEach(cardId => {
            const card = __CARD_BY_ID[cardId];
            if (!card) return;
            if (!Number.isFinite(ownedRemaining[cardId]) || ownedRemaining[cardId] <= 0) return;
            const limit = getDeckCardCopyLimit(card);
            const used = usageCount[cardId] || 0;
            if (used >= limit) return;
            output.push(cardId);
            usageCount[cardId] = used + 1;
            ownedRemaining[cardId] -= 1;
        });

        return output;
    }


    function getDeckTargetSize(deck) {
        if (Array.isArray(deck?.starterCardIds) && deck.starterCardIds.length > 0) {
            return deck.starterCardIds.length;
        }
        return STANDARD_DECK_SIZE;
    }

    function inferCardElements(card) {
        if (!card) return [];

        const explicitElements = new Set();
        if (Array.isArray(card.elements)) {
            card.elements.forEach(element => {
                if (element === 'colorless' || ELEMENTS[element]) explicitElements.add(element);
            });
        }
        if (card.element && (card.element === 'colorless' || ELEMENTS[card.element])) {
            explicitElements.add(card.element);
        }
        Object.keys(card.cost || {}).forEach(element => {
            if (element === 'colorless' || ELEMENTS[element]) explicitElements.add(element);
        });
        if (explicitElements.size > 0) return [...explicitElements];

        const keywordMap = {
            fire: ['fire', 'flame', 'ember', 'lava', 'magma', 'infernal', 'volcanic', 'blaze', 'burning'],
            water: ['water', 'aqua', 'ocean', 'river', 'wave', 'frost', 'ice', 'mist', 'tidal'],
            earth: ['earth', 'forest', 'stone', 'rock', 'nature', 'grove', 'bloom', 'vine', 'bamboo'],
            swamp: ['swamp', 'shadow', 'dark', 'cursed', 'undead', 'venom', 'poison', 'bog', 'necro'],
            light: ['light', 'holy', 'sun', 'angel', 'radiant', 'sacred', 'dawn', 'solar']
        };

        const haystack = `${card._category || ''} ${card.name || ''} ${card.desc || ''} ${card.cardType || ''} ${card.theme || ''}`.toLowerCase();
        const inferred = Object.entries(keywordMap)
            .filter(([, keywords]) => keywords.some(keyword => haystack.includes(keyword)))
            .map(([color]) => color);

        return inferred.length > 0 ? inferred : ['colorless'];
    }

    function isCardEligibleForDeck(card, deckColors) {
        if (!card || !Array.isArray(deckColors) || deckColors.length === 0) return false;
        if (card.type === 'land') {
            // Same rule validateDeckBuild applies on save: the land must produce at least one deck colour.
            return inferLandElements(card).some(element => deckColors.includes(element));
        }
        const cardElements = inferCardElements(card);
        return cardElements.every(element => element === 'colorless' || deckColors.includes(element));
    }

    function validateMeta(meta) {
        try {
            const loaded = meta && typeof meta === 'object' ? meta : {};
            const shouldSeedStarter = loaded.initialized !== true;
            const repaired = {
                version: 1,
                initialized: true,
                collection: {},
                decks: {},
                selectedDeckKey: typeof loaded.selectedDeckKey === 'string' ? loaded.selectedDeckKey : 'FIRE',
                stats: {
                    wins: readStoredNumber(loaded?.stats?.wins) ?? 0,
                    losses: readStoredNumber(loaded?.stats?.losses) ?? 0,
                    packsOpened: readStoredNumber(loaded?.stats?.packsOpened) ?? 0
                },
                wallet: {
                    credits: readStoredNumber(loaded?.wallet?.credits) ?? STARTER_CREDITS
                },
                lastPack: Array.isArray(loaded.lastPack?.cardIds)
                    ? {
                        themeKey: typeof loaded.lastPack.themeKey === 'string' ? loaded.lastPack.themeKey : null,
                        cardIds: loaded.lastPack.cardIds.filter(id => __CARD_BY_ID[id]),
                        openedAt: typeof loaded.lastPack.openedAt === 'string' ? loaded.lastPack.openedAt : null,
                        ...(typeof loaded.lastPack.acquisitionId === 'string' ? { acquisitionId: loaded.lastPack.acquisitionId } : {})
                    }
                    : null
            };

            Object.entries(loaded.collection || {}).forEach(([cardId, count]) => {
                if (!__CARD_BY_ID[cardId]) return;
                const safeCount = readStoredNumber(count) ?? 0;
                if (safeCount > 0) {
                    repaired.collection[cardId] = safeCount;
                }
            });

            const seededMeta = createInitialMeta();
            const standardDeckKeys = [...STARTER_MONO_DECK_KEYS, ...STARTER_DUAL_DECK_KEYS];

            Object.entries(loaded.decks || {}).forEach(([deckKey, deckData]) => {
                const colors = Array.isArray(deckData?.colors)
                    ? deckData.colors.filter(color => Object.hasOwn(ELEMENTS, color))
                    : getDeckColorsFromKey(deckKey);
                if (colors.length === 0) return;
                const savedStarter = Array.isArray(deckData?.starterCardIds) ? deckData.starterCardIds.filter(id => __CARD_BY_ID[id]) : [];
                const currentStarter = seededMeta.decks[deckKey]?.starterCardIds;
                let cardIds = clampDeckCardIdsToOwned(deckData?.cardIds || [], repaired.collection);

                // A deck nobody edited (still its old starter list) follows the current starter list.
                if (currentStarter && savedStarter.length > 0 && !sameCardMultiset(savedStarter, currentStarter) &&
                    sameCardMultiset(cardIds, clampDeckCardIdsToOwned(savedStarter, repaired.collection))) {
                    cardIds = clampDeckCardIdsToOwned(currentStarter, repaired.collection);
                }

                repaired.decks[deckKey] = {
                    deckKey,
                    colors,
                    // Standard decks always carry the current starter list (the RESET TO STARTER target).
                    starterCardIds: currentStarter ? [...currentStarter] : savedStarter,
                    cardIds
                };
            });

            standardDeckKeys.forEach(deckKey => {
                if (!repaired.decks[deckKey]) {
                    const seeded = seededMeta.decks[deckKey];
                    repaired.decks[deckKey] = { ...seeded, colors: [...seeded.colors], starterCardIds: [...seeded.starterCardIds], cardIds: [...seeded.cardIds] };
                }
            });

            STARTER_MONO_DECK_KEYS.forEach(deckKey => {
                if (!shouldSeedStarter) return;

                const requiredCounts = {};
                (repaired.decks[deckKey].cardIds || []).forEach(cardId => {
                    requiredCounts[cardId] = (requiredCounts[cardId] || 0) + 1;
                });

                Object.entries(requiredCounts).forEach(([cardId, needed]) => {
                    const owned = repaired.collection[cardId] || 0;
                    if (owned < needed) {
                        repaired.collection[cardId] = needed;
                    }
                });
            });

            // Decks only hold owned copies; no cards are granted to an existing profile.
            Object.values(repaired.decks).forEach(deck => {
                deck.cardIds = clampDeckCardIdsToOwned(deck.cardIds, repaired.collection);
            });

            if (!Object.hasOwn(repaired.decks, repaired.selectedDeckKey)) {
                repaired.selectedDeckKey = 'FIRE';
            }

            return repaired;
        } catch (error) {
            console.warn('Meta validation failed. Rebuilding starter meta.', error);
            try {
                return createInitialMeta();
            } catch (seedError) {
                console.warn('Starter meta rebuild failed. Falling back to minimal safe meta.', seedError);
                return {
                    version: 1,
                    initialized: true,
                    collection: {},
                    decks: {},
                    selectedDeckKey: 'FIRE',
                    stats: { wins: 0, losses: 0, packsOpened: 0 },
                    wallet: { credits: STARTER_CREDITS },
                    lastPack: null
                };
            }
        }
    }

    function metaEnsureInitialized({ importLegacy = true } = {}) {
        if (!isMetaRuntimeEnabled()) {
            return createInitialMeta();
        }

        let raw = null;
        try {
            raw = localStorage.getItem(META_STORAGE_KEY);
        } catch (error) {
            console.warn('Could not read the saved profile.', error);
        }

        if (raw === null) {
            const seeded = createInitialMeta();
            if (importLegacy) importLegacyStats(seeded);
            metaSave(seeded);
            return seeded;
        }

        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            parsed = null;
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            // Unreadable: keep its text, then start a new profile.
            const backedUp = backupMetaRaw(raw, 'corrupt');
            const seeded = createInitialMeta();
            if (backedUp) metaSave(seeded);
            return seeded;
        }

        // Any readable profile is repaired, never replaced (PROGRESSION.md §7).
        const meta = validateMeta(parsed);
        if (JSON.stringify(meta) !== raw) {
            if (backupMetaRaw(raw, parsed.version === undefined || parsed.version === 1 ? 'repair' : 'unsupported-version')) metaSave(meta);
        }
        return meta;
    }

    let deckBuilderState = {
        deckKey: null,
        workingCardIds: [],
        debugWarning: '',
        validationErrors: []
    };

    let gameMeta;
    try {
        gameMeta = metaEnsureInitialized();
    } catch (error) {
        console.warn('Meta initialization failed. Falling back to in-memory starter meta.', error);
        gameMeta = createInitialMeta();
    }
    gameStats = {
        wins: Number.isFinite(gameMeta?.stats?.wins) ? gameMeta.stats.wins : 0,
        losses: Number.isFinite(gameMeta?.stats?.losses) ? gameMeta.stats.losses : 0,
        total: (Number.isFinite(gameMeta?.stats?.wins) ? gameMeta.stats.wins : 0) + (Number.isFinite(gameMeta?.stats?.losses) ? gameMeta.stats.losses : 0)
    };

    let achievementsRecognised = [];
    // Holding a Web Lock for the page lifetime avoids a non-atomic localStorage read/write race.
    // No expiring leases: a suspended tab cannot regain a stale write permission.
    const profileReady = (async () => {
        if (!navigator.locks) {
            profileWriteState = 'unsupported';
            persistenceNotice('Saving requires a browser with Web Locks on HTTPS. Progress here is not saved.');
            initializeAchievements(); return;
        }
        await new Promise(resolve => {
            navigator.locks.request(`emoji-elements-writer:${META_STORAGE_KEY}`, { ifAvailable: true }, async lock => {
                if (!lock) {
                    profileWriteState = 'reader'; canSaveProfile(); initializeAchievements(); resolve(); return;
                }
                profileWriteState = 'writer';
                try {
                    profileSavedRaw = localStorage.getItem(META_STORAGE_KEY);
                    gameMeta = metaEnsureInitialized();
                    gameStats = { wins: gameMeta.stats.wins, losses: gameMeta.stats.losses,
                        total: gameMeta.stats.wins + gameMeta.stats.losses };
                } catch (_) {
                    profileWriteState = 'unavailable'; canSaveProfile();
                }
                initializeAchievements();
                resolve();
                await new Promise(() => {}); // browser releases this when the page closes/reloads
            }).catch(() => { profileWriteState = 'unavailable'; canSaveProfile(); initializeAchievements(); resolve(); });
        });
    })();

    window.addEventListener('pagehide', () => window.Achievements?.flush());
    // Achievements keep their own versioned key (achievements.js). Anything the saved profile already proves is
    // recognised now, quietly. QA sessions (?qa=1) never save, so QA tools can't award a real profile.
    function initializeAchievements() {
        try {
            achievementsRecognised = window.Achievements ? Achievements.init({
                game: () => gameState,
                meta: () => gameMeta,
                cards: () => __CARD_BY_ID,
                identity: getCardIdentity,
                rarity: getCardRarity,
                persist: !QA_MODE && profileWriteState === 'writer' && !profileRepairBlocked,
                canPersist: () => profileWriteState === 'writer' && !profileRepairBlocked,
                enabled: () => !QA_MODE && isMetaRuntimeEnabled(),
                onSaveError: () => persistenceNotice('Achievements could not be saved. Keep this tab open and retry saving.', true),
                currentTheme: document.documentElement.dataset.theme,
                debug: QA_DEBUG
            }) : [];
        } catch (error) {
            console.warn('Achievements could not start; the game plays without them.', error);
        }

    }

    if (QA_DEBUG) {
        window.__qaDumpMeta = function() {
            const meta = metaLoad() || gameMeta || {};
            const wins = Number.isFinite(meta?.stats?.wins) ? meta.stats.wins : 0;
            const losses = Number.isFinite(meta?.stats?.losses) ? meta.stats.losses : 0;
            const summary = {
                credits: Number.isFinite(meta?.wallet?.credits) ? meta.wallet.credits : STARTER_CREDITS,
                winsLosses: `${wins}/${losses}`,
                packsOpened: Number.isFinite(meta?.stats?.packsOpened) ? meta.stats.packsOpened : 0,
                selectedDeckKey: typeof meta?.selectedDeckKey === 'string' ? meta.selectedDeckKey : 'FIRE',
                collectionSize: Object.keys(meta?.collection || {}).length,
                deckKeysCount: Object.keys(meta?.decks || {}).length
            };
            console.log('[QA] Meta summary:', summary);
            return summary;
        };

        window.__qaResetMeta = function() {
            const confirmed = window.confirm('Reset persisted meta and reload page?');
            if (!confirmed || !canSaveProfile()) return false;
            try {
                if (!backupMetaRaw(localStorage.getItem(META_STORAGE_KEY), 'qa-reset')) return false;
                localStorage.removeItem(META_STORAGE_KEY);
                localStorage.removeItem(LEGACY_STATS_STORAGE_KEY);
            } catch (error) {
                console.warn('QA reset failed to clear meta storage key.', error);
            }
            window.location.reload();
            return true;
        };
    }

    if (QA_MODE) {
    window.__qaNavSmoke = function() {
        const qaPrefix = '[QA][NavSmoke]';
        const isElementVisible = (id) => {
            const el = document.getElementById(id);
            if (!el) return false;

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;

            if (el.classList.contains('show') || el.classList.contains('modal-visible')) return true;

            return style.display === 'block' || style.display === 'flex' || el.style.display === 'block' || el.style.display === 'flex';
        };

        const check = (label, expectedVisibleId) => {
            const pass = isElementVisible(expectedVisibleId);
            const marker = pass ? '✅ PASS' : '❌ FAIL';
            console.log(`${qaPrefix} ${marker} ${label} -> ${expectedVisibleId}`);
            return { label, expectedVisibleId, pass };
        };

        const callIfExists = (fnName, ...args) => {
            const fn = window[fnName];
            if (typeof fn !== 'function') {
                console.log(`${qaPrefix} ⚠️ SKIP ${fnName}() missing`);
                return false;
            }
            fn(...args);
            return true;
        };

        const results = [];

        if (!callIfExists('showMenu') && typeof window.backToMenu === 'function') {
            window.backToMenu();
        }
        results.push(check('showMenu()', 'mainMenu'));

        if (callIfExists('showHowToPlay')) {
            results.push(check('showHowToPlay()', 'howToPlayScreen'));
        }

        if (callIfExists('setHowToPlayPage', 1)) {
            const page1Visible = isElementVisible('howToPlayPage1') || !!document.querySelector('#howToPlayScreen .howto-page[data-page="1"]:not([style*="display: none"])');
            const pass = page1Visible;
            console.log(`${qaPrefix} ${pass ? '✅ PASS' : '❌ FAIL'} setHowToPlayPage(1)`);
            results.push({ label: 'setHowToPlayPage(1)', expectedVisibleId: 'howToPlayPage1', pass });
        }

        if (callIfExists('setHowToPlayPage', 2)) {
            const page2Visible = isElementVisible('howToPlayPage2') || !!document.querySelector('#howToPlayScreen .howto-page[data-page="2"]:not([style*="display: none"])');
            const pass = page2Visible;
            console.log(`${qaPrefix} ${pass ? '✅ PASS' : '❌ FAIL'} setHowToPlayPage(2)`);
            results.push({ label: 'setHowToPlayPage(2)', expectedVisibleId: 'howToPlayPage2', pass });
        }

        if (callIfExists('showDeckBuilder')) {
            results.push(check('showDeckBuilder()', 'deckBuilderScreen'));
        }

        if (typeof window.showBinder === 'function') {
            window.showBinder();
            results.push(check('showBinder()', 'binderScreen'));
        } else {
            console.log(`${qaPrefix} ⚠️ SKIP showBinder() missing`);
        }

        if (typeof window.showPackShop === 'function' && document.getElementById('packShopScreen')) {
            window.showPackShop();
            results.push(check('showPackShop()', 'packShopScreen'));
        } else {
            console.log(`${qaPrefix} ⚠️ SKIP showPackShop() missing`);
        }

        if (callIfExists('backToMenu')) {
            results.push(check('backToMenu()', 'mainMenu'));
        }

        const passed = results.filter(entry => entry.pass).length;
        const total = results.length;
        const failed = total - passed;
        console.log(`${qaPrefix} Summary: ${passed}/${total} passed, ${failed} failed.`);

        return {
            total,
            passed,
            failed,
            results
        };
    };


    window.__qaBuyPack = function(themeKey) {
        const qaPrefix = '[QA][BuyPack]';
        const normalizedTheme = String(themeKey || '').trim().toLowerCase();
        const beforeCredits = Number.isFinite(gameMeta?.wallet?.credits) ? Math.floor(gameMeta.wallet.credits) : 0;
        const beforeCollectionTotal = Object.values(gameMeta?.collection || {}).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);

        console.log(`${qaPrefix} credits(before)=${beforeCredits} theme=${normalizedTheme || 'auto'}`);
        const result = purchasePack(normalizedTheme);

        const afterCredits = Number.isFinite(gameMeta?.wallet?.credits) ? Math.floor(gameMeta.wallet.credits) : 0;
        const afterCollectionTotal = Object.values(gameMeta?.collection || {}).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
        console.log(`${qaPrefix} credits(after)=${afterCredits}`);

        if (!gameMeta?.lastPack || !Array.isArray(gameMeta.lastPack.cardIds) || gameMeta.lastPack.cardIds.length === 0) {
            throw new Error(`${qaPrefix} Assertion failed: meta.lastPack missing after purchase.`);
        }

        if (afterCollectionTotal <= beforeCollectionTotal) {
            throw new Error(`${qaPrefix} Assertion failed: collection did not increase (${beforeCollectionTotal} -> ${afterCollectionTotal}).`);
        }

        console.log(`${qaPrefix} ✅ PASS purchased=${result?.ok === true} cards=${gameMeta.lastPack.cardIds.length} collection=${beforeCollectionTotal}->${afterCollectionTotal}`);

        return {
            ok: true,
            result,
            creditsBefore: beforeCredits,
            creditsAfter: afterCredits,
            collectionBefore: beforeCollectionTotal,
            collectionAfter: afterCollectionTotal,
            lastPack: gameMeta.lastPack
        };
    };


    window.__qaDeckBuilderSmoke = function(deckKey) {
        const qaPrefix = '[QA][DeckBuilderSmoke]';
        const selectedDeckKey = deckKey || deckBuilderState.deckKey || gameMeta?.selectedDeckKey || Object.keys(gameMeta?.decks || {})[0];
        const deck = gameMeta?.decks?.[selectedDeckKey];
        if (!deck) {
            const reason = `Missing deck for key: ${selectedDeckKey}`;
            console.log(`${qaPrefix} ❌ FAIL ${reason}`);
            return { ok: false, failed: 1, passed: 0, results: [{ label: 'init deck', pass: false, reason }] };
        }

        const targetSize = getDeckTargetSize(deck);
        const baseDeck = Array.isArray(deck.starterCardIds) ? [...deck.starterCardIds] : [];
        const collection = gameMeta?.collection || {};
        const deckColors = Array.isArray(deck.colors) ? deck.colors : getDeckColorsFromKey(selectedDeckKey);

        const findCardId = (predicate) => Object.keys(__CARD_BY_ID).find(cardId => predicate(__CARD_BY_ID[cardId], cardId));
        const ownedEligibleId = findCardId((card, cardId) => card && card.type !== 'land' && (collection[cardId] || 0) > 0 && isCardEligibleForDeck(card, deckColors));
        const unownedEligibleId = findCardId((card, cardId) => card && card.type !== 'land' && (collection[cardId] || 0) === 0 && isCardEligibleForDeck(card, deckColors));

        const results = [];
        const test = (label, fn, expectedPass = true) => {
            let pass = false;
            let detail = '';
            try {
                pass = !!fn();
            } catch (error) {
                pass = false;
                detail = error?.message || String(error);
            }
            const finalPass = expectedPass ? pass : !pass;
            const marker = finalPass ? '✅ PASS' : '❌ FAIL';
            console.log(`${qaPrefix} ${marker} ${label}${detail ? ` (${detail})` : ''}`);
            results.push({ label, pass: finalPass, detail });
        };

        test('add unowned card should fail', () => {
            if (!unownedEligibleId) return true;
            return !validateDeckBuild(selectedDeckKey, [...baseDeck, unownedEligibleId], gameMeta).ok;
        });

        test('exceed copies should fail', () => {
            if (!ownedEligibleId) return true;
            const card = __CARD_BY_ID[ownedEligibleId];
            const limit = getDeckBuilderCopyLimit(card);
            return !validateDeckBuild(selectedDeckKey, new Array(limit + 1).fill(ownedEligibleId), gameMeta).ok;
        });

        test('save wrong size should fail', () => {
            deckBuilderState.deckKey = selectedDeckKey;
            deckBuilderState.workingCardIds = baseDeck.slice(0, Math.max(0, targetSize - 1));
            deckBuilderState.validationErrors = [];
            saveDeckBuilderDeck();
            const persisted = gameMeta?.decks?.[selectedDeckKey]?.cardIds || [];
            return persisted.length === targetSize && deckBuilderState.validationErrors.length > 0;
        });

        test('save correct size should pass', () => {
            deckBuilderState.deckKey = selectedDeckKey;
            deckBuilderState.workingCardIds = [...baseDeck];
            deckBuilderState.validationErrors = [];
            saveDeckBuilderDeck();
            const persisted = gameMeta?.decks?.[selectedDeckKey]?.cardIds || [];
            return validateDeckBuild(selectedDeckKey, persisted, gameMeta).ok;
        });

        const passed = results.filter(result => result.pass).length;
        const failed = results.length - passed;
        return {
            ok: failed === 0,
            passed,
            failed,
            results
        };
    };
    }

    // Packs for the Pack Shop and win rewards. Prices, pack size and the win-reward theme weights are the
    // same as before (PROGRESSION.md P3); the art colours for each key are in styles.css ("PACK SHOP").
    const PACK_THEMES = [
        { key: 'fantasy', label: 'Fantasy', weight: 24, icon: '🧙', tagline: 'Myth, magic and the wild creatures of the five elements' },
        { key: 'scifi', label: 'Science Fiction', weight: 18, icon: '🚀', tagline: 'Space, science and the future' },
        { key: 'tech', label: 'Tech', weight: 16, icon: '⚙️', tagline: 'Gadgets, machines and modern life' },
        { key: 'alien', label: 'Alien', weight: 14, icon: '👽', tagline: 'Aliens, spacecraft and the cosmos' },
        { key: 'robot', label: 'Robot', weight: 14, icon: '🤖', tagline: 'Robots, drones, mechs and machine minds' },
        { key: 'lands', label: 'Lands', weight: 14, icon: '🌍', tagline: 'Only lands: basic, dual and special' }
    ];

    const PACK_SHOP_COSTS = {
        fantasy: 60,
        scifi: 60,
        tech: 60,
        alien: 60,
        robot: 60,
        lands: 40
    };

    const PACK_THEME_KEYS = new Set(PACK_THEMES.map(theme => theme.key));
    const PACK_SIZE = 5;

    // Which packs each card can come from, reviewed card by card and keyed by card id (CARD_AUDIT.md §7).
    // A card may be in several packs. In short:
    // - fantasy: every Fantasy- and Nature-theme card (the elemental wildlife), plus City folklore
    //   (Santa Claus, Phantom Train, Dread Clown, Temple Cat, Holy Hamster, Grave Digger, War Horn);
    // - scifi: every Science Fiction card;
    // - tech: Science Fiction devices, machines, drones and gear, plus the other City (modern life) cards;
    // - alien: aliens, spacecraft, space travel and cosmic cards (Meteor Strike too);
    // - robot: robots, androids, cyborgs, mechs, drones, AI and machine parts;
    // - lands: all 8 lands and nothing else.
    // tests/card-audit.mjs fails if a card is missing, an id is unknown or a pack breaks these limits.
    const PACK_MEMBERSHIP = {
        // Lands
        'lands-volcanic-peak': ['lands'],
        'lands-mystic-springs': ['lands'],
        'lands-ancient-grove': ['lands'],
        'lands-cursed-bog': ['fantasy', 'lands'],
        'lands-sacred-temple': ['fantasy', 'lands'],
        'lands-crystal-wasteland': ['scifi', 'lands'],
        'lands-distant-planet': ['scifi', 'alien', 'lands'],
        'lands-rainbow': ['lands'],
        // Creatures
        'creatures-ancient-dragon': ['fantasy'],
        'creatures-phoenix': ['fantasy'],
        'creatures-infernal-demon': ['fantasy'],
        'creatures-blazing-tiger': ['fantasy'],
        'creatures-fire-fox': ['fantasy'],
        'creatures-fire-lion': ['fantasy'],
        'creatures-fire-salamander': ['fantasy'],
        'creatures-magma-monkey': ['fantasy'],
        'creatures-raging-bull': ['fantasy'],
        'creatures-flame-steed': ['fantasy'],
        'creatures-wild-boar': ['fantasy'],
        'creatures-fire-ram': ['fantasy'],
        'creatures-lava-scorpion': ['fantasy'],
        'creatures-magma-crab': ['fantasy'],
        'creatures-fire-lobster': ['fantasy'],
        'creatures-ember-beetle': ['fantasy'],
        'creatures-fire-ladybug': ['fantasy'],
        'creatures-raging-oni': ['fantasy'],
        'creatures-fire-djinn': ['fantasy'],
        'creatures-fireman': ['tech'],
        'creatures-phoenix-firebird': ['fantasy'],
        'creatures-leviathan-whale': ['fantasy'],
        'creatures-great-shark': ['fantasy'],
        'creatures-giant-octopus': ['fantasy'],
        'creatures-mystic-dolphin': ['fantasy'],
        'creatures-school-fish': ['fantasy'],
        'creatures-arctic-seal': ['fantasy'],
        'creatures-river-otter': ['fantasy'],
        'creatures-ice-penguin': ['fantasy'],
        'creatures-swamp-frog': ['fantasy'],
        'creatures-giant-squid': ['fantasy'],
        'creatures-mantis-shrimp': ['fantasy'],
        'creatures-swamp-croc': ['fantasy'],
        'creatures-ancient-turtle': ['fantasy'],
        'creatures-sea-horse': ['fantasy'],
        'creatures-stinging-jellyfish': ['fantasy'],
        'creatures-armored-snail': ['fantasy'],
        'creatures-crystal-swan': ['fantasy'],
        'creatures-enchanting-mermaid': ['fantasy'],
        'creatures-great-white-shark': ['fantasy'],
        'creatures-elder-elephant': ['fantasy'],
        'creatures-silverback-gorilla': ['fantasy'],
        'creatures-forest-bear': ['fantasy'],
        'creatures-swift-rabbit': ['fantasy'],
        'creatures-noble-deer': ['fantasy'],
        'creatures-pack-wolf': ['fantasy'],
        'creatures-armored-rhino': ['fantasy'],
        'creatures-river-hippo': ['fantasy'],
        'creatures-forest-squirrel': ['fantasy'],
        'creatures-spiky-hedgehog': ['fantasy'],
        'creatures-fierce-badger': ['fantasy'],
        'creatures-tall-giraffe': ['fantasy'],
        'creatures-striped-zebra': ['fantasy'],
        'creatures-desert-camel': ['fantasy'],
        'creatures-strong-ox': ['fantasy'],
        'creatures-bamboo-panda': ['fantasy'],
        'creatures-sleepy-koala': ['fantasy'],
        'creatures-wild-west-cowboy': ['tech'],
        'creatures-weightlifter': ['tech'],
        'creatures-bengal-tiger': ['fantasy'],
        'creatures-garden-ladybug': ['fantasy'],
        'creatures-ancient-vampire': ['fantasy'],
        'creatures-risen-zombie': ['fantasy'],
        'creatures-restless-ghost': ['fantasy'],
        'creatures-vampire-bat': ['fantasy'],
        'creatures-giant-spider': ['fantasy'],
        'creatures-skeleton-warrior': ['fantasy'],
        'creatures-dark-wizard': ['fantasy'],
        'creatures-swamp-witch': ['fantasy'],
        'creatures-plague-rat': ['fantasy'],
        'creatures-venom-snake': ['fantasy'],
        'creatures-death-scorpion': ['fantasy'],
        'creatures-death-crow': ['fantasy'],
        'creatures-werewolf': ['fantasy'],
        'creatures-stone-gargoyle': ['fantasy'],
        'creatures-ancient-mummy': ['fantasy'],
        'creatures-goblin-raider': ['fantasy'],
        'creatures-swamp-troll': ['fantasy'],
        'creatures-demonic-clown': ['fantasy'],
        'creatures-sacred-unicorn': ['fantasy'],
        'creatures-guardian-angel': ['fantasy'],
        'creatures-sky-eagle': ['fantasy'],
        'creatures-peace-dove': ['fantasy'],
        'creatures-light-butterfly': ['fantasy'],
        'creatures-winged-pegasus': ['fantasy'],
        'creatures-forest-fairy': ['fantasy'],
        'creatures-temple-cat': ['fantasy'],
        'creatures-loyal-hound': ['tech'],
        'creatures-wise-owl': ['fantasy'],
        'creatures-golden-bee': ['fantasy'],
        'creatures-holy-chicken': ['fantasy'],
        'creatures-sun-parrot': ['fantasy'],
        'creatures-pink-flamingo': ['fantasy'],
        'creatures-royal-peacock': ['fantasy'],
        'creatures-baby-chick': ['fantasy'],
        'creatures-holy-hamster': ['fantasy'],
        'creatures-combat-robot': ['scifi', 'robot'],
        'creatures-alien-invader': ['scifi', 'alien'],
        'creatures-pixel-monster': ['scifi', 'alien'],
        'creatures-ufo-saucer': ['scifi', 'alien'],
        'creatures-satellite-drone': ['scifi', 'tech', 'alien', 'robot'],
        'creatures-battle-rocket': ['scifi', 'tech', 'alien'],
        'creatures-space-marine': ['scifi', 'alien'],
        'creatures-cyborg-soldier': ['scifi', 'robot'],
        'creatures-android-guardian': ['scifi', 'robot'],
        'creatures-battle-mech': ['scifi', 'robot'],
        'creatures-attack-drone': ['scifi', 'tech', 'robot'],
        'creatures-ai-core': ['scifi', 'tech', 'robot'],
        'creatures-cyber-brain': ['scifi', 'tech', 'robot'],
        'creatures-gene-splice': ['scifi', 'tech'],
        'creatures-nano-virus': ['scifi', 'tech'],
        'creatures-med-capsule': ['scifi', 'tech', 'robot'],
        'creatures-bio-injector': ['scifi', 'tech'],
        'creatures-lab-scanner': ['scifi', 'tech'],
        'creatures-orbital-scanner': ['scifi', 'tech', 'alien'],
        'creatures-power-cell': ['scifi', 'tech'],
        'creatures-magnetic-trap': ['scifi', 'tech'],
        'creatures-signal-tower': ['scifi', 'tech'],
        'creatures-radar-array': ['scifi', 'tech'],
        'creatures-plasma-bomb': ['scifi', 'tech'],
        'creatures-mech-part': ['scifi', 'tech', 'robot'],
        'creatures-repair-bot': ['scifi', 'tech', 'robot'],
        'creatures-forge-hammer': ['scifi', 'tech'],
        'creatures-time-device': ['scifi', 'tech'],
        'creatures-alert-system': ['scifi', 'tech'],
        'creatures-chrono-watch': ['scifi', 'tech'],
        'creatures-data-disc': ['scifi', 'tech'],
        'creatures-comm-device': ['scifi', 'tech'],
        'creatures-spy-camera': ['scifi', 'tech'],
        'creatures-recorder-drone': ['scifi', 'tech', 'robot'],
        'creatures-men-in-black': ['scifi', 'alien'],
        'creatures-grey-alien': ['scifi', 'alien'],
        'creatures-astronaut-explorer': ['scifi', 'alien'],
        'creatures-poop': ['fantasy'],
        'creatures-santa-claus': ['fantasy'],
        'creatures-police-officer': ['tech'],
        'creatures-crooked-cop': ['tech'],
        'creatures-farmer': ['tech'],
        'creatures-welder': ['tech'],
        'creatures-sunflower': ['fantasy'],
        'creatures-lantern-koi': ['fantasy'],
        'creatures-hot-pepper-sprite': ['fantasy'],
        'creatures-torch-runner': ['tech'],
        'creatures-forge-hound': ['fantasy'],
        'creatures-comet-hawk': ['fantasy'],
        'creatures-volcano-golem': ['fantasy'],
        'creatures-rocket-imp': ['scifi', 'alien'],
        'creatures-ember-chef': ['tech'],
        'creatures-war-drummer': ['tech'],
        'creatures-neon-panther': ['scifi', 'tech'],
        'creatures-jelly-knight': ['fantasy'],
        'creatures-otter-scout': ['fantasy'],
        'creatures-moonfish': ['fantasy'],
        'creatures-tidal-turtle': ['fantasy'],
        'creatures-snow-owl': ['fantasy'],
        'creatures-harbor-mage': ['fantasy'],
        'creatures-dolphin-rider': ['fantasy'],
        'creatures-hydrobot': ['scifi', 'robot'],
        'creatures-ice-gargoyle': ['fantasy'],
        'creatures-wave-skater': ['tech'],
        'creatures-mole-engineer': ['fantasy'],
        'creatures-bison-guard': ['fantasy'],
        'creatures-stone-serpent': ['fantasy'],
        'creatures-garden-giant': ['fantasy'],
        'creatures-lumber-mammoth': ['fantasy'],
        'creatures-cactus-guardian': ['fantasy'],
        'creatures-trail-hiker': ['tech'],
        'creatures-badlands-boar': ['fantasy'],
        'creatures-mountain-ram': ['fantasy'],
        'creatures-temple-keeper': ['fantasy'],
        'creatures-grim-crow': ['fantasy'],
        'creatures-blood-leech': ['fantasy'],
        'creatures-bone-hound': ['fantasy'],
        'creatures-grave-digger': ['fantasy'],
        'creatures-witch-cat': ['fantasy'],
        'creatures-night-reaper': ['fantasy'],
        'creatures-toxic-frog': ['fantasy'],
        'creatures-phantom-train': ['fantasy', 'tech'],
        'creatures-dread-clown': ['fantasy'],
        'creatures-night-moth': ['fantasy'],
        'creatures-sun-monk': ['fantasy'],
        'creatures-lantern-guard': ['tech'],
        'creatures-dove-rider': ['fantasy'],
        'creatures-paladin-captain': ['fantasy'],
        'creatures-choir-angel': ['fantasy'],
        'creatures-healer-bot': ['scifi', 'robot'],
        'creatures-beacon-keeper': ['tech'],
        'creatures-solar-drake': ['fantasy'],
        'creatures-daybreak-stag': ['fantasy'],
        'creatures-mirror-knight': ['fantasy'],
        // Instants
        'spells-fireball': ['fantasy'],
        'spells-explosion': ['fantasy'],
        'spells-inferno': ['fantasy'],
        'spells-meteor-strike': ['fantasy', 'alien'],
        'spells-flame-jet': ['fantasy'],
        'spells-anger': ['tech'],
        'spells-freeze': ['fantasy'],
        'spells-tsunami': ['fantasy'],
        'spells-bubble-shield': ['fantasy'],
        'spells-healing-rain': ['fantasy'],
        'spells-whirlpool': ['fantasy'],
        'spells-deep-freeze': ['fantasy'],
        'spells-surf': ['tech'],
        'spells-coral-shield': ['fantasy'],
        'spells-earthquake': ['fantasy'],
        'spells-growth': ['fantasy'],
        'spells-tangling-roots': ['fantasy'],
        'spells-avalanche': ['fantasy'],
        'spells-harvest': ['fantasy'],
        'spells-wrestle': ['tech'],
        'spells-mushroom-power': ['fantasy'],
        'spells-curse': ['fantasy'],
        'spells-drain-life': ['fantasy'],
        'spells-poison': ['fantasy'],
        'spells-necromancy': ['fantasy'],
        'spells-terror': ['fantasy'],
        'spells-heal': ['fantasy'],
        'spells-divine-smite': ['fantasy'],
        'spells-blessing': ['fantasy'],
        'spells-light-beam': ['fantasy'],
        'spells-resurrection': ['fantasy'],
        'spells-in-the-clouds': ['fantasy'],
        'spells-meditate': ['tech'],
        'spells-feather': ['fantasy'],
        'spells-summon-spirits': ['fantasy'],
        'spells-raise-army': ['fantasy'],
        'spells-call-of-the-forest': ['fantasy'],
        'spells-web-trap': ['fantasy'],
        'spells-comet-strike': ['scifi', 'alien'],
        'spells-mind-rot': ['fantasy'],
        'spells-thought-steal': ['fantasy'],
        // Artifacts
        'artifacts-flaming-sword': ['fantasy'],
        'artifacts-earth-shield': ['fantasy'],
        'artifacts-crown-of-power': ['fantasy'],
        'artifacts-mana-gem': ['fantasy'],
        'artifacts-bomb': ['tech'],
        'artifacts-holy-chalice': ['fantasy'],
        'artifacts-dark-scroll': ['fantasy'],
        'artifacts-cursed-orb': ['fantasy'],
        'artifacts-war-horn': ['fantasy'],
        'artifacts-protective-amulet': ['fantasy'],
        'artifacts-magic-ring': ['fantasy'],
        'artifacts-heavy-armor': ['tech'],
        'artifacts-battle-axe': ['fantasy'],
        'artifacts-elven-bow': ['fantasy'],
        'artifacts-magic-wand': ['fantasy'],
        'artifacts-halo': ['fantasy'],
        'artifacts-dna-sequence': ['scifi', 'tech'],
        'artifacts-fingerprint-scanner': ['scifi', 'tech'],
        'artifacts-footsteps': ['scifi'],
        'artifacts-prism-core': ['scifi', 'tech'],
        'artifacts-gravity-boots': ['scifi', 'tech'],
        'artifacts-chrono-watch': ['scifi', 'tech'],
        'artifacts-nano-shield': ['scifi', 'tech'],
        'artifacts-signal-tower': ['scifi', 'tech'],
        'artifacts-mech-claw': ['scifi', 'tech', 'robot'],
        'artifacts-aether-lens': ['scifi', 'tech', 'alien'],
        'artifacts-repair-drone': ['scifi', 'tech', 'alien', 'robot'],
        'artifacts-void-compass': ['scifi', 'tech', 'alien'],
        'artifacts-relic-cache': ['fantasy']
    };

    function getPackMemberships(cardOrId) {
        const id = typeof cardOrId === 'string' ? cardOrId : cardOrId?.__id;
        return PACK_MEMBERSHIP[id] || [];
    }

    // Every card a pack can contain, in catalog order
    function getThemePool(themeKey) {
        const key = String(themeKey || '').trim().toLowerCase();
        return __ALL_CARDS.filter(card => getPackMemberships(card).includes(key));
    }

    // Pack slots use three rarity tiers. Rarities are unchanged (inferRarity has no uncommon, so Rare fills
    // the second-best slot, as before).
    const PACK_TIER_OF_RARITY = { common: 'common', uncommon: 'rare', rare: 'rare', epic: 'epic+', legendary: 'epic+' };
    const PACK_TIER_LABELS = { common: 'Common', rare: 'Rare', 'epic+': 'Epic/Legendary' };
    // Each slot's tiers in order of preference: three Common, one Rare, one Epic or Legendary (as before)
    const PACK_SLOT_TIERS = [
        ['common', 'rare', 'epic+'],
        ['common', 'rare', 'epic+'],
        ['common', 'rare', 'epic+'],
        ['rare', 'common', 'epic+'],
        ['epic+', 'rare', 'common']
    ];
    // A tier with fewer cards than this in a pack is merged with the next tier for that slot, so no card
    // turns up in every pack (the Robot pack has a single Epic, Battle Mech).
    const PACK_MIN_TIER_CHOICES = 2;

    const packTierOf = card => PACK_TIER_OF_RARITY[card?.__rarity] || 'common';

    // A pack's pool, its tier counts, and for each slot the groups of tiers it tries in order. A slot takes
    // one card, uniformly, from the first group that still has cards left in this pack.
    function getPackSlotPlan(themeKey) {
        const pool = getThemePool(themeKey);
        const counts = { common: 0, rare: 0, 'epic+': 0 };
        pool.forEach(card => { counts[packTierOf(card)]++; });
        const slots = PACK_SLOT_TIERS.map(tiers => {
            const groups = [];
            let group = [];
            tiers.forEach((tier, i) => {
                group.push(tier);
                const size = group.reduce((sum, t) => sum + counts[t], 0);
                if (size >= PACK_MIN_TIER_CHOICES || i === tiers.length - 1) {
                    groups.push(group);
                    group = [];
                }
            });
            return groups;
        });
        return { themeKey: String(themeKey || '').trim().toLowerCase(), pool, counts, slots };
    }

    function choosePackThemeByWeight() {
        const totalWeight = PACK_THEMES.reduce((sum, theme) => sum + Math.max(0, Number(theme.weight) || 0), 0);
        if (totalWeight <= 0) {
            return PACK_THEMES[0]?.key || 'fantasy';
        }

        let roll = gameplayRandom() * totalWeight;
        for (const theme of PACK_THEMES) {
            roll -= Math.max(0, Number(theme.weight) || 0);
            if (roll <= 0) {
                return theme.key;
            }
        }

        return PACK_THEMES[PACK_THEMES.length - 1]?.key || 'fantasy';
    }

    // Five different cards. If a pack's pool ever ran out (fewer than PACK_SIZE cards), the rest would come
    // from the whole catalog in the same tier order; the card audit keeps every pool large enough.
    function generatePack(themeKey) {
        const plan = getPackSlotPlan(themeKey);
        const remaining = [...plan.pool];
        const picked = [];
        const pickOne = candidates => candidates[Math.floor(gameplayRandom() * candidates.length)];

        plan.slots.forEach((groups, slot) => {
            for (const group of groups) {
                const candidates = remaining.filter(card => group.includes(packTierOf(card)));
                if (candidates.length) {
                    const pick = pickOne(candidates);
                    remaining.splice(remaining.indexOf(pick), 1);
                    picked.push(pick.__id);
                    return;
                }
            }
            for (const tier of PACK_SLOT_TIERS[slot]) {
                const candidates = __ALL_CARDS.filter(card => !picked.includes(card.__id) && packTierOf(card) === tier);
                if (candidates.length) {
                    picked.push(pickOne(candidates).__id);
                    return;
                }
            }
        });

        return picked;
    }

    // Exact odds for a pack, following generatePack slot by slot: the expected number of cards from each
    // tier, and the chance that one given card of that tier is in a pack. Used by the shop preview.
    function getPackOdds(themeKey) {
        const plan = getPackSlotPlan(themeKey);
        const expected = { common: 0, rare: 0, 'epic+': 0 };
        const walk = (slot, left, p) => {
            if (slot === plan.slots.length) return;
            for (const group of plan.slots[slot]) {
                const total = group.reduce((sum, t) => sum + left[t], 0);
                if (!total) continue;
                group.forEach(tier => {
                    if (!left[tier]) return;
                    const q = p * left[tier] / total;
                    expected[tier] += q;
                    walk(slot + 1, { ...left, [tier]: left[tier] - 1 }, q);
                });
                return;
            }
            walk(slot + 1, left, p); // the catalog fallback: never reached while pools hold 5+ cards
        };
        walk(0, { ...plan.counts }, 1);
        const perCard = {};
        Object.keys(expected).forEach(tier => { perCard[tier] = plan.counts[tier] ? expected[tier] / plan.counts[tier] : 0; });
        return { ...plan, expected, perCard };
    }

    // What each slot gives, for the shop: consecutive slots with the same first group are merged
    // ("3 × Common"). A merged tier (see PACK_MIN_TIER_CHOICES) is explained in `notes`.
    function describePackSlots(themeKey) {
        const plan = getPackSlotPlan(themeKey);
        const slots = [];
        const notes = [];
        plan.slots.forEach((groups, i) => {
            const group = groups[0];
            const label = group.map(tier => PACK_TIER_LABELS[tier]).join(' or ');
            const last = slots[slots.length - 1];
            if (last && last.label === label) last.count++;
            else slots.push({ label, tiers: group, count: 1 });
            const wanted = PACK_SLOT_TIERS[i][0];
            if (group.length > 1) {
                const n = plan.counts[wanted];
                notes.push(`Card ${i + 1}: this pack has ${n === 0 ? 'no' : `only ${n}`} ${PACK_TIER_LABELS[wanted]} card${n === 1 ? '' : 's'}, so it can also be ${group.slice(1).map(t => PACK_TIER_LABELS[t]).join(' or ')}.`);
            }
        });
        return { slots, notes };
    }

    // Copies of each card owned just before the latest pack was added. Kept in memory only (the save format is
    // unchanged), so the reveal can mark NEW cards and show "had N".
    let lastPackOwnedBefore = null;

    // A pack counts for achievements when its cards are seen (torn open), so an unlock never spoils the reveal.
    // Closing the pack screen without tearing it counts too: the cards are yours either way.
    let packReportedFor = null;
    function reportPackOpened() {
        const pack = gameMeta?.lastPack;
        if (!pack?.openedAt) return;
        const acquisitionId = pack.acquisitionId || JSON.stringify([pack.openedAt, pack.themeKey, pack.cardIds]);
        if (packReportedFor === acquisitionId) return;
        packReportedFor = acquisitionId;
        reportAchievement('pack:opened', {
            acquisitionId,
            themeKey: pack.themeKey,
            cards: (pack.cardIds || []).map(id => ({ id, rarity: getCardRarity(__CARD_BY_ID[id] || {}), isNew: getPackOwnedBefore(id) === 0 }))
        });
        reportAchievement('collection', {});
    }

    function addPackToCollection(cardIds, openedAt) {
        const before = {};
        cardIds.forEach(cardId => { before[cardId] = gameMeta.collection[cardId] || 0; });
        cardIds.forEach(cardId => {
            gameMeta.collection[cardId] = (gameMeta.collection[cardId] || 0) + 1;
        });
        lastPackOwnedBefore = { openedAt, counts: before };
    }

    // Copies owned before the shown pack: recorded at acquisition, or (for a pack from before a reload) the
    // current count minus that pack's copy, as a pack never holds a card twice.
    function getPackOwnedBefore(cardId) {
        const owned = gameMeta?.collection?.[cardId] || 0;
        if (lastPackOwnedBefore && lastPackOwnedBefore.openedAt === gameMeta?.lastPack?.openedAt && cardId in lastPackOwnedBefore.counts) {
            return lastPackOwnedBefore.counts[cardId];
        }
        const inPack = (gameMeta?.lastPack?.cardIds || []).filter(id => id === cardId).length;
        return Math.max(0, owned - inPack);
    }

    let openModalCount = 0;

    function getSafeFocusTarget() {
        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer?.style.display === 'flex') {
            const gameplayTargets = ['endTurnBtn', 'attackBtn', 'graveyardBtn'];
            for (const id of gameplayTargets) {
                const element = document.getElementById(id);
                if (element && !element.disabled && element.offsetParent !== null) {
                    return element;
                }
            }

            const pauseButton = document.querySelector('#gameContainer .menu-icon-btn');
            if (pauseButton && pauseButton.offsetParent !== null) {
                return pauseButton;
            }
        }

        // The entry that opened the screen we just left, else NEW GAME
        const returnButton = menuReturnTarget && document.querySelector(`#mainMenu [data-menu-target="${menuReturnTarget}"]`);
        if (returnButton && returnButton.offsetParent !== null) {
            return returnButton;
        }

        const mainMenuButton = document.querySelector('#mainMenu .menu-btn');
        if (mainMenuButton && mainMenuButton.offsetParent !== null) {
            return mainMenuButton;
        }

        const activeStartScreenButton = document.querySelector('#startModal [style*="display: block"] .menu-btn, #startModal [style*="display: flex"] .menu-btn');
        if (activeStartScreenButton && activeStartScreenButton.offsetParent !== null) {
            return activeStartScreenButton;
        }

        return null;
    }

    function focusSafeElement() {
        const target = getSafeFocusTarget();
        if (target && typeof target.focus === 'function') {
            target.focus();
        }
    }

    function showModal(modalEl) {
        if (!modalEl) return;

        const wasOpen = modalEl.classList.contains('show');
        modalEl.style.display = 'flex';
        modalEl.classList.add('show');

        if (!wasOpen && modalEl.dataset.lockScroll !== 'false') {
            openModalCount++;
            document.body.classList.add('no-scroll');
        }
    }

    function hideModal(modalEl) {
        if (!modalEl) return;

        const wasOpen = modalEl.classList.contains('show');
        modalEl.classList.remove('show');
        modalEl.style.display = 'none';

        if (wasOpen && modalEl.dataset.lockScroll !== 'false') {
            openModalCount = Math.max(0, openModalCount - 1);
            if (openModalCount === 0) {
                document.body.classList.remove('no-scroll');
            }
        }
    }

    const packOpeningState = {
        active: false,
        cards: [],
        currentIndex: 0,
        isDragging: false,
        dragStartX: 0,
        maxDistance: 0,
        progress: 0,
        stage: 'sealed',
        cardRevealed: false
    };

    let pendingMatchResultOverlay = null;
    let pendingMatchRewardSummary = null;

    function showMatchResultOverlay(result) {
        const normalizedResult = result === 'win' ? 'win' : 'loss';
        const overlayId = normalizedResult === 'win' ? 'victoryOverlay' : 'loseOverlay';
        const overlay = document.getElementById(overlayId);

        if (overlay) {
            overlay.classList.add('show');
            pendingMatchResultOverlay = null;
        }
    }


    function showMatchRewardOverlay(summary) {
        const overlay = document.getElementById('matchRewardOverlay');
        const creditsEl = document.getElementById('rewardCreditsAmount');
        const packEl = document.getElementById('rewardPackAmount');

        if (!overlay) {
            pendingMatchResultOverlay = 'win';
            openPackOpeningOverlayFromMeta('win');
            return;
        }

        pendingMatchRewardSummary = {
            creditsAwarded: Number.isFinite(summary?.creditsAwarded) ? summary.creditsAwarded : BASE_WIN_CREDITS,
            packCount: Number.isFinite(summary?.packCount) ? summary.packCount : 1
        };

        if (creditsEl) creditsEl.textContent = `+${pendingMatchRewardSummary.creditsAwarded}`;
        if (packEl) packEl.textContent = `${pendingMatchRewardSummary.packCount}`;

        overlay.classList.add('show');
    }

    function proceedFromMatchRewards() {
        const overlay = document.getElementById('matchRewardOverlay');
        overlay?.classList.remove('show');
        pendingMatchResultOverlay = 'win';
        openPackOpeningOverlayFromMeta('win');
    }

    function updatePackOpeningDebug() {
        const debugEl = document.getElementById('packQaDebug');
        if (!debugEl) return;

        if (!QA_MODE || !window.__qaShowPackDebug) {
            debugEl.textContent = '';
            debugEl.style.display = 'none';
            return;
        }

        debugEl.style.display = 'block';
        const total = packOpeningState.cards.length;
        const index = total ? packOpeningState.currentIndex + 1 : 0;
        const progress = Math.round(packOpeningState.progress * 100);
        debugEl.textContent = `stage=${packOpeningState.stage} progress=${progress}% index=${index} total=${total}`;
    }

    function getClientXFromEvent(event) {
        if (typeof event.clientX === 'number') {
            return event.clientX;
        }
        const touch = event.touches?.[0] || event.changedTouches?.[0];
        return touch?.clientX ?? 0;
    }

    function fallbackPackReveal(cards) {
        const safeCards = Array.isArray(cards) ? cards : [];
        const lines = safeCards.length
            ? safeCards.map(card => `• ${card.emoji} ${card.name}`).join('\n')
            : '• Pack data unavailable';

        alert(`You won a pack!\n\n${lines}`);
        const victoryOverlay = document.getElementById('victoryOverlay');
        if (victoryOverlay) {
            victoryOverlay.classList.add('show');
        }
    }

    function setPackCardRevealState(isRevealed) {
        const viewport = document.getElementById('packCardViewport');
        const cover = document.getElementById('packCardCover');
        packOpeningState.cardRevealed = Boolean(isRevealed);

        if (viewport) {
            viewport.classList.toggle('is-revealed', packOpeningState.cardRevealed);
        }

        if (cover) {
            cover.textContent = packOpeningState.cardRevealed ? '' : 'Tap to reveal';
        }
    }

    function revealCurrentPackCard() {
        if (packOpeningState.stage !== 'reveal' || packOpeningState.cardRevealed) return;
        setPackCardRevealState(true);
        const revealed = packOpeningState.cards[packOpeningState.currentIndex];
        const rarity = revealed ? getCardRarity(revealed) : 'common';
        GameFeedback.play('reveal', { rarity });
        if (['rare', 'epic', 'legendary'].includes(rarity)) haptic('revealRare');

        const viewport = document.getElementById('packCardViewport');
        if (viewport) {
            applyJuice(viewport, 'juice-pop', 320);
        }
    }

    // The rest of a revealed card: keywords and rules, as in card details
    function renderPackCardText(card) {
        if (card.type === 'land') {
            const colours = Array.isArray(card.elements) ? card.elements : [card.element];
            return `<p class="pack-card-rules">Tap to add ${colours.map(e => `${ELEMENTS[e]?.emoji || '◇'} ${ELEMENT_LABELS[e] || e}`).join(' or ')} mana</p>`;
        }
        if (card.type === 'creature') {
            const keywords = (card.abilities || []).map(a => {
                const rule = KEYWORD_RULES[a];
                return `<span class="pack-card-keyword${a === 'flash' ? ' is-inactive' : ''}" title="${describeKeyword(a)}">${rule?.badge || ''} ${rule?.label || a}</span>`;
            }).join('');
            return (keywords ? `<div class="pack-card-keywords">${keywords}</div>` : '')
                + `<p class="pack-card-flavour">${card.desc || ''}</p>`;
        }
        return `<p class="pack-card-rules">${describeEffect(card)}</p>`;
    }

    // NEW when you had none before this pack; otherwise how many you have now
    function renderPackOwned(card) {
        const before = getPackOwnedBefore(card.__id);
        const now = gameMeta?.collection?.[card.__id] || 0;
        return before === 0
            ? `<span class="pack-new-badge">✨ NEW</span> <span>First copy</span>`
            : `<span>You own ${now} <span class="pack-owned-before">(had ${before})</span></span>`;
    }

    function setPackStage(stage) {
        packOpeningState.stage = stage;
        const stages = { sealed: 'packSealedStage', opening: 'packSealedStage', reveal: 'packRevealStage', summary: 'packSummaryStage' };
        ['packSealedStage', 'packRevealStage', 'packSummaryStage'].forEach(id => {
            document.getElementById(id)?.classList.toggle('pack-stage-active', stages[stage] === id);
        });
    }

    // The whole pack at a glance once the cards are revealed
    function showPackSummary() {
        if (packOpeningState.stage !== 'reveal' || !packOpeningState.cards.length) return;
        setPackStage('summary');
        const cards = packOpeningState.cards;
        const grid = document.getElementById('packSummaryGrid');
        grid.innerHTML = '';
        cards.forEach((card, index) => {
            const rarity = getCardRarity(card);
            const isNew = getPackOwnedBefore(card.__id) === 0;
            const owned = gameMeta?.collection?.[card.__id] || 0;
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `pack-summary-card rarity-${rarity}${isNew ? ' is-new' : ''}`;
            button.dataset.index = String(index);
            const art = createCardRowArt(card);
            art.classList.add('pack-summary-art');
            button.appendChild(art);
            const body = document.createElement('span');
            body.className = 'pack-summary-body';
            body.innerHTML = `<span class="pack-summary-name">${card.name}</span>`
                + `<span class="pack-summary-rarity rarity-${rarity}">${RARITY_INFO[rarity].glyph} ${RARITY_INFO[rarity].label}</span>`
                + `<span class="pack-summary-owned">${isNew ? '<span class="pack-new-badge">✨ NEW</span>' : `Own ${owned}`}</span>`;
            button.appendChild(body);
            button.setAttribute('aria-label', `${card.name}, ${RARITY_INFO[rarity].label}${isNew ? ', new' : `, you own ${owned}`}. Show this card`);
            button.addEventListener('click', () => {
                setPackStage('reveal');
                setPackOpeningCard(index);
                revealCurrentPackCard();
                document.getElementById('packNextBtn')?.focus({ preventScroll: true });
            });
            li.appendChild(button);
            grid.appendChild(li);
        });
        const newCount = cards.filter(card => getPackOwnedBefore(card.__id) === 0).length;
        const rank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
        const best = cards.reduce((a, b) => (rank[getCardRarity(b)] > rank[getCardRarity(a)] ? b : a));
        document.getElementById('packSummaryTitle').textContent = `Your ${cards.length} cards`;
        document.getElementById('packSummaryStats').textContent =
            `${newCount ? `${newCount} new to your collection` : 'No new cards: all duplicates'} · Best: ${best.name} (${RARITY_INFO[getCardRarity(best)].label})`;
        document.getElementById('packDoneBtn')?.focus({ preventScroll: true });
        updatePackOpeningDebug();
    }

    function setPackOpeningCard(index) {
        if (!packOpeningState.cards.length) return;

        const boundedIndex = Math.max(0, Math.min(index, packOpeningState.cards.length - 1));
        packOpeningState.currentIndex = boundedIndex;

        const card = packOpeningState.cards[boundedIndex];
        const rarity = getCardRarity(card);
        const packCardEmoji = document.getElementById('packCardEmoji');
        const packCardName = document.getElementById('packCardName');
        const packCardType = document.getElementById('packCardType');
        const packCardCounter = document.getElementById('packCardCounter');
        const packPrevBtn = document.getElementById('packPrevBtn');
        const packNextBtn = document.getElementById('packNextBtn');
        const packOverlay = document.getElementById('packOpeningOverlay');
        const packViewport = document.getElementById('packCardViewport');

        if (packCardEmoji) packCardEmoji.textContent = card.emoji || '✨';
        if (packCardName) packCardName.textContent = card.name || 'Unknown Card';
        if (packCardType) packCardType.textContent = card.cardType || card.type || '';
        const packCardMeta = document.getElementById('packCardMeta');
        if (packCardMeta) {
            const parts = [`<span class="detail-tag detail-tag-rarity rarity-${rarity}">${RARITY_INFO[rarity].glyph} ${RARITY_INFO[rarity].label}</span>`];
            if (card.type !== 'land') parts.push(`<span class="pack-card-cost">${renderCostPips(card.cost)}</span>`);
            if (card.type === 'creature') parts.push(`<span class="card-power pack-card-power">${card.power}/${card.toughness}</span>`);
            packCardMeta.innerHTML = parts.join('');
        }
        const packCardText = document.getElementById('packCardText');
        if (packCardText) packCardText.innerHTML = renderPackCardText(card);
        const packCardOwned = document.getElementById('packCardOwned');
        if (packCardOwned) packCardOwned.innerHTML = renderPackOwned(card);
        if (packViewport) {
            packViewport.scrollTop = 0;
            applyCardIdentity(packViewport, card);
            packViewport.dataset.rarity = rarity;
            packViewport.classList.toggle('is-new', getPackOwnedBefore(card.__id) === 0);
        }
        if (packCardCounter) packCardCounter.textContent = `Card ${boundedIndex + 1} of ${packOpeningState.cards.length}`;
        const packSummaryBtn = document.getElementById('packSummaryBtn');
        packSummaryBtn?.classList.toggle('is-ready', boundedIndex === packOpeningState.cards.length - 1);
        if (packPrevBtn) packPrevBtn.disabled = boundedIndex === 0;
        if (packNextBtn) packNextBtn.disabled = boundedIndex === packOpeningState.cards.length - 1;

        const flashClass = `pack-flash-${rarity}`;
        const glowClass = `juice-glow-${rarity}`;
        const allFlashClasses = ['pack-flash-common', 'pack-flash-uncommon', 'pack-flash-rare', 'pack-flash-epic', 'pack-flash-legendary'];
        const allGlowClasses = ['juice-glow-common', 'juice-glow-uncommon', 'juice-glow-rare', 'juice-glow-epic', 'juice-glow-legendary'];

        try {
            if (packOverlay) {
                packOverlay.classList.remove(...allFlashClasses);
                packOverlay.classList.add(flashClass);
                setTimeout(() => {
                    try {
                        packOverlay.classList.remove(flashClass);
                    } catch (_) {
                        // no-op
                    }
                }, 320);
            }

            if (packViewport) {
                packViewport.classList.remove(...allGlowClasses);
                packViewport.classList.add(glowClass);
            }
        } catch (_) {
            // no-op
        }

        setPackCardRevealState(false);
        updatePackOpeningDebug();
    }

    function showPackRevealStage() {
        const overlay = document.getElementById('packOpeningOverlay');
        const focusWasOnSealed = document.getElementById('packSealedStage')?.contains(document.activeElement);
        setPackStage('reveal');
        setPackOpeningCard(0);
        // The OPEN PACK button is gone now: keep keyboard focus in the dialog
        if (focusWasOnSealed || document.activeElement === document.body) {
            if (overlay?.classList.contains('show')) document.getElementById('packNextBtn')?.focus({ preventScroll: true });
        }
        setTimeout(() => revealCurrentPackCard(), 200);
        updatePackOpeningDebug();
    }

    function closePackOpeningOverlay() {
        const overlay = document.getElementById('packOpeningOverlay');
        if (overlay?.classList.contains('show')) reportPackOpened();
        const shouldUnlockScroll = overlay?.dataset.lockScroll !== 'false' && overlay?.classList.contains('show');
        let scrollReleased = false;

        try {
            hideModal(overlay);
            scrollReleased = true;

            packOpeningState.active = false;
            packOpeningState.cards = [];
            packOpeningState.currentIndex = 0;
            packOpeningState.isDragging = false;
            packOpeningState.dragStartX = 0;
            packOpeningState.maxDistance = 0;
            packOpeningState.progress = 0;
            packOpeningState.stage = 'sealed';
            packOpeningState.cardRevealed = false;

            const sealedStage = document.getElementById('packSealedStage');
            const revealStage = document.getElementById('packRevealStage');
            const shell = document.getElementById('packTearSurface');
            const instruction = document.getElementById('packInstruction');
            const progress = document.getElementById('packProgressFill');
            const tearLine = document.getElementById('packTearLine');

            sealedStage?.classList.add('pack-stage-active');
            revealStage?.classList.remove('pack-stage-active');
            document.getElementById('packSummaryStage')?.classList.remove('pack-stage-active');
            shell?.classList.remove('opened');
            if (instruction) instruction.textContent = 'Slide to rip open';
            updatePackShopTiles();
            if (progress) progress.style.width = '0%';
            if (tearLine) tearLine.style.left = '0%';

            if (pendingMatchResultOverlay) {
                showMatchResultOverlay(pendingMatchResultOverlay);
            }

            updatePackOpeningDebug();
            focusSafeElement();
        } finally {
            if (shouldUnlockScroll && !scrollReleased) {
                openModalCount = Math.max(0, openModalCount - 1);
                if (openModalCount === 0) {
                    document.body.classList.remove('no-scroll');
                }
            }
        }
    }

    function triggerPackOpenAnimation() {
        if (packOpeningState.stage !== 'sealed') return;

        packOpeningState.stage = 'opening';
        reportPackOpened();
        GameFeedback.play('packRip');
        haptic('reveal');
        const instruction = document.getElementById('packInstruction');
        const shell = document.getElementById('packTearSurface');
        if (instruction) {
            instruction.textContent = 'Pack opening...';
        }
        shell.classList.add('opened');
        updatePackOpeningDebug();

        setTimeout(() => {
            showPackRevealStage();
        }, 420);
    }

    function updatePackRipProgress(clientX) {
        if (!packOpeningState.isDragging || packOpeningState.stage !== 'sealed') return;

        const tearSurface = document.getElementById('packTearSurface');
        const targetDistance = Math.max((tearSurface?.clientWidth || window.innerWidth) * 0.45, 120);
        const dragDistance = Math.abs(clientX - packOpeningState.dragStartX);
        packOpeningState.maxDistance = Math.max(packOpeningState.maxDistance, dragDistance);
        packOpeningState.progress = Math.min(1, packOpeningState.maxDistance / targetDistance);

        const progressPercent = Math.round(packOpeningState.progress * 100);
        document.getElementById('packProgressFill').style.width = `${progressPercent}%`;
        document.getElementById('packTearLine').style.left = `${progressPercent}%`;
        updatePackOpeningDebug();

        if (packOpeningState.progress >= 1) {
            triggerPackOpenAnimation();
        }
    }

    function openPackOpeningOverlayFromMeta(source = 'win') {
        try {
            const overlay = document.getElementById('packOpeningOverlay');
            if (packOpeningState.active || overlay?.classList.contains('show')) {
                if (QA_DEBUG) {
                    console.log('[QA] pack opening trigger skipped (already active)');
                }
                return;
            }

            const cardIds = gameMeta?.lastPack?.cardIds;
            const cards = (Array.isArray(cardIds) ? cardIds : [])
                .map(cardId => __CARD_BY_ID[cardId])
                .filter(Boolean);

            if (!cards.length) {
                fallbackPackReveal([]);
                return;
            }

            packOpeningState.active = true;
            holdAchievementNotice();
            packOpeningState.cards = cards;
            packOpeningState.currentIndex = 0;
            packOpeningState.isDragging = false;
            packOpeningState.dragStartX = 0;
            packOpeningState.maxDistance = 0;
            packOpeningState.progress = 0;
            packOpeningState.stage = 'sealed';
            packOpeningState.cardRevealed = false;

            const sealedStage = document.getElementById('packSealedStage');
            const revealStage = document.getElementById('packRevealStage');
            const shell = document.getElementById('packTearSurface');
            const instruction = document.getElementById('packInstruction');
            const progress = document.getElementById('packProgressFill');
            const tearLine = document.getElementById('packTearLine');
            const title = overlay.querySelector('.pack-opening-title');
            const theme = getPackTheme(gameMeta?.lastPack?.themeKey);
            const themeLabel = theme?.label;
            if (title) title.textContent = source === 'shop' && themeLabel ? `🛒 ${themeLabel} Pack` : `🎁 Victory Pack${themeLabel ? ` · ${themeLabel}` : ''}`;
            // The sealed pack wears its theme's art (styles.css "PACK SHOP")
            overlay.dataset.theme = theme?.key || '';
            const sealedEmoji = document.getElementById('packSealedEmoji');
            if (sealedEmoji) sealedEmoji.textContent = theme?.icon || '📦';
            const sealedLabel = document.getElementById('packSealedLabel');
            if (sealedLabel) sealedLabel.textContent = themeLabel ? `${themeLabel} Pack` : 'Booster Pack';

            sealedStage.classList.add('pack-stage-active');
            revealStage.classList.remove('pack-stage-active');
            document.getElementById('packSummaryStage')?.classList.remove('pack-stage-active');
            shell.classList.remove('opened');
            instruction.textContent = 'Slide across the pack to rip it open, or press OPEN PACK';
            progress.style.width = '0%';
            tearLine.style.left = '0%';

            showModal(overlay);
            updatePackOpeningDebug();
        } catch (error) {
            console.warn('Pack opening overlay failed, using fallback.', error);
            closePackOpeningOverlay();
            fallbackPackReveal([]);
        }
    }


    function initializePackOpeningOverlay() {
        const overlay = document.getElementById('packOpeningOverlay');
        const tearSurface = document.getElementById('packTearSurface');
        const closeBtn = document.getElementById('packCloseBtn');
        const prevBtn = document.getElementById('packPrevBtn');
        const nextBtn = document.getElementById('packNextBtn');
        const viewport = document.getElementById('packCardViewport');

        if (!overlay || !tearSurface || !closeBtn || !prevBtn || !nextBtn || !viewport) {
            return;
        }

        const startDrag = (event) => {
            if (!packOpeningState.active || packOpeningState.stage !== 'sealed') return;
            event.preventDefault?.();
            packOpeningState.isDragging = true;
            packOpeningState.dragStartX = getClientXFromEvent(event);
            if (typeof event.pointerId === 'number') {
                tearSurface.setPointerCapture?.(event.pointerId);
            }
            updatePackOpeningDebug();
        };

        const moveDrag = (event) => {
            if (!packOpeningState.isDragging) return;
            event.preventDefault?.();
            updatePackRipProgress(getClientXFromEvent(event));
        };

        const stopDrag = (event) => {
            event?.preventDefault?.();
            packOpeningState.isDragging = false;
            updatePackOpeningDebug();
        };

        const pointerOptions = { passive: false };
        tearSurface.addEventListener('pointerdown', startDrag, pointerOptions);
        tearSurface.addEventListener('pointermove', moveDrag, pointerOptions);
        tearSurface.addEventListener('pointerup', stopDrag, pointerOptions);
        tearSurface.addEventListener('pointercancel', stopDrag, pointerOptions);
        tearSurface.addEventListener('touchstart', startDrag, { passive: false });
        tearSurface.addEventListener('touchmove', moveDrag, { passive: false });
        tearSurface.addEventListener('touchend', stopDrag, { passive: false });
        tearSurface.addEventListener('touchcancel', stopDrag, { passive: false });

        closeBtn.addEventListener('click', () => {
            closePackOpeningOverlay();
        });

        // Button alternatives to the gestures: open the pack, see all five cards, finish
        document.getElementById('packOpenBtn')?.addEventListener('click', () => {
            if (packOpeningState.active) triggerPackOpenAnimation();
        });
        document.getElementById('packSummaryBtn')?.addEventListener('click', () => showPackSummary());
        document.getElementById('packSummaryBackBtn')?.addEventListener('click', () => {
            setPackStage('reveal');
            setPackOpeningCard(packOpeningState.currentIndex);
            revealCurrentPackCard();
            document.getElementById('packNextBtn')?.focus({ preventScroll: true });
        });
        document.getElementById('packDoneBtn')?.addEventListener('click', () => closePackOpeningOverlay());

        prevBtn.addEventListener('click', () => {
            setPackOpeningCard(packOpeningState.currentIndex - 1);
            setTimeout(() => revealCurrentPackCard(), 180);
        });

        nextBtn.addEventListener('click', () => {
            setPackOpeningCard(packOpeningState.currentIndex + 1);
            setTimeout(() => revealCurrentPackCard(), 180);
        });

        viewport.addEventListener('click', revealCurrentPackCard);

        let swipeStartX = 0;
        let swiping = false;

        const startSwipe = (event) => {
            if (packOpeningState.stage !== 'reveal') return;
            event.preventDefault?.();
            swiping = true;
            swipeStartX = getClientXFromEvent(event);
            if (typeof event.pointerId === 'number') {
                viewport.setPointerCapture?.(event.pointerId);
            }
        };

        const moveSwipe = (event) => {
            if (!swiping || packOpeningState.stage !== 'reveal') return;
            event.preventDefault?.();
            const clientX = getClientXFromEvent(event);
            const deltaX = clientX - swipeStartX;
            if (Math.abs(deltaX) < 55) return;

            if (deltaX < 0) {
                setPackOpeningCard(packOpeningState.currentIndex + 1);
            } else {
                setPackOpeningCard(packOpeningState.currentIndex - 1);
            }

            setTimeout(() => revealCurrentPackCard(), 180);
            swiping = false; // one card per swipe; lift and swipe again for the next
            swipeStartX = clientX;
        };

        const stopSwipe = (event) => {
            event?.preventDefault?.();
            swiping = false;
        };
        viewport.addEventListener('pointerdown', startSwipe, pointerOptions);
        viewport.addEventListener('pointermove', moveSwipe, pointerOptions);
        viewport.addEventListener('pointerup', stopSwipe, pointerOptions);
        viewport.addEventListener('pointercancel', stopSwipe, pointerOptions);
        viewport.addEventListener('touchstart', startSwipe, { passive: false });
        viewport.addEventListener('touchmove', moveSwipe, { passive: false });
        viewport.addEventListener('touchend', stopSwipe, { passive: false });
        viewport.addEventListener('touchcancel', stopSwipe, { passive: false });
    }


    function finalizeMatch(result) {
        if (gameState.matchFinalized) {
            if (QA_DEBUG) {
                console.log('[QA] finalizeMatch skipped (already finalized)');
            }
            return;
        }
        gameState.matchFinalized = true;
        cancelMatchWork();

        const normalizedResult = result === 'win' ? 'win' : 'loss';
        recordHistory(normalizedResult === 'win' ? 'player' : 'enemy', normalizedResult === 'win' ? '🏆 Victory: the enemy is defeated' : '💀 Defeat');

        if (normalizedResult === 'win') {
            if (isMetaRuntimeEnabled()) { gameStats.wins++; gameStats.total++; }

            const awardedFreePack = true;
            const themeKey = choosePackThemeByWeight();
            const cardIds = generatePack(themeKey);
            const openedAt = new Date().toISOString();

            if (isMetaRuntimeEnabled()) {
                try {
                    if (!gameMeta.stats) {
                        gameMeta.stats = { wins: 0, losses: 0, packsOpened: 0 };
                    }
                    if (!gameMeta.wallet || !Number.isFinite(gameMeta.wallet.credits)) {
                        gameMeta.wallet = { credits: STARTER_CREDITS };
                    }
                    gameMeta.stats.wins = Number.isFinite(gameMeta.stats.wins) ? gameMeta.stats.wins + 1 : 1;
                    gameMeta.wallet.credits = Math.max(0, Math.floor(gameMeta.wallet.credits + BASE_WIN_CREDITS));

                    gameMeta.stats.packsOpened = Number.isFinite(gameMeta.stats.packsOpened) ? gameMeta.stats.packsOpened + 1 : 1;

                    addPackToCollection(cardIds, openedAt);

                    gameMeta.lastPack = { themeKey, cardIds, openedAt, acquisitionId: globalThis.crypto?.randomUUID?.() || `pack-${Date.now()}-${nextCardInstanceId()}` };
                    metaSave(gameMeta);
                } catch (error) {
                    console.warn('Meta reward hook failed after win. Continuing with baseline victory flow.', error);
                }
            }
            saveStats();

            const lastPack = gameMeta?.lastPack || { themeKey, cardIds, openedAt };
            const credits = Number.isFinite(gameMeta?.wallet?.credits) ? gameMeta.wallet.credits : null;
            if (QA_DEBUG) {
                console.log('[QA] finalizeMatch', normalizedResult, 'awardedPack=', Boolean(lastPack), 'credits=', credits);
                console.log(`[QA] finalizeMatch result=WIN awardedPack=${awardedFreePack} theme=${themeKey || 'none'}`);
                console.log('🏆 Match reward granted:', {
                    creditsAwarded: BASE_WIN_CREDITS,
                    freePackAwarded: true,
                    lastPack: gameMeta.lastPack
                });
            }

            stopBattleMusic();
            playSFX('gameVictory');
            haptic('victory');
            reportAchievement('wallet', {});
            reportAchievement('match:end', { result: 'win', reason: gameState.enemyDeckedOut ? 'decked' : 'life' });
            showMatchRewardOverlay({
                creditsAwarded: BASE_WIN_CREDITS,
                packCount: 1
            });
            return;
        }

        if (isMetaRuntimeEnabled()) { gameStats.losses++; gameStats.total++; }

        if (isMetaRuntimeEnabled()) {
            try {
                if (!gameMeta.stats) {
                    gameMeta.stats = { wins: 0, losses: 0, packsOpened: 0 };
                }
                if (!gameMeta.wallet || !Number.isFinite(gameMeta.wallet.credits)) {
                    gameMeta.wallet = { credits: STARTER_CREDITS };
                }
                gameMeta.stats.losses = Number.isFinite(gameMeta.stats.losses) ? gameMeta.stats.losses + 1 : 1;
                gameMeta.wallet.credits = Math.max(0, Math.floor(gameMeta.wallet.credits + BASE_LOSS_CREDITS));
                metaSave(gameMeta);
            } catch (error) {
                console.warn('Meta loss hook failed. Continuing with baseline loss flow.', error);
            }
        }
        saveStats();

        const lastPack = null;
        const credits = Number.isFinite(gameMeta?.wallet?.credits) ? gameMeta.wallet.credits : null;
        if (QA_DEBUG) {
            console.log('[QA] finalizeMatch', normalizedResult, 'awardedPack=', Boolean(lastPack), 'credits=', credits);
            console.log('[QA] finalizeMatch result=LOSS awardedPack=false');
        }

        stopBattleMusic();
        playSFX('gameLose');
        haptic('defeat');
        reportAchievement('wallet', {});
        reportAchievement('match:end', { result: 'loss', reason: gameState.playerDeckedOut ? 'decked' : 'life' });
        const lossReward = document.getElementById('lossRewardLine');
        if (lossReward) lossReward.textContent = `💳 +${BASE_LOSS_CREDITS} Credits`;
        showMatchResultOverlay('loss');
    }

    // Particle System - OPTIMIZED for better performance on mobile and desktop
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let particles = [];

    // Performance optimization: Reduce particles on mobile devices
    const particleMultiplier = isMobile ? 0.5 : 1;
    const maxParticles = isMobile ? 100 : 200; // Limit total particles for performance

    class Particle {
        constructor(x, y, color, type = 'default') {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 4;
            this.vy = (Math.random() - 0.5) * 4;
            this.life = 1;
            this.decay = isMobile ? 0.025 : 0.02; // Faster decay on mobile
            this.color = color;
            this.size = Math.random() * 4 + 2;
            this.type = type;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.vy += 0.1; // gravity
            this.life -= this.decay;
            this.size *= 0.98;
        }

        draw() {
            ctx.globalAlpha = this.life;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function createParticles(x, y, color, count = 20) {
        if (gamePaused || gameState.matchFinalized || prefersReducedMotion()) return;
        // Apply mobile optimization
        const adjustedCount = Math.floor(count * particleMultiplier);

        for (let i = 0; i < adjustedCount; i++) {
            // Limit total particle count for performance
            if (particles.length < maxParticles) {
                particles.push(new Particle(x, y, color));
            }
        }
        startParticleLoop();
    }

    // Performance: Use requestAnimationFrame more efficiently. The loop runs only while particles are alive;
    // it used to clear the full-screen canvas 60 times a second forever, menus included.
    let lastParticleFrame = 0;
    const particleFPS = 60;
    const particleFrameInterval = 1000 / particleFPS;
    let particleLoopRunning = false;
    let particleRafId = 0;

    function startParticleLoop() {
        if (particleLoopRunning) return;
        particleLoopRunning = true;
        particleRafId = requestAnimationFrame(animateParticles);
    }

    function animateParticles(currentTime) {
        if (!particles.length) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particleLoopRunning = false;
            particleRafId = 0;
            return;
        }
        particleRafId = requestAnimationFrame(animateParticles);

        // Throttle particle updates for better performance
        if (currentTime - lastParticleFrame < particleFrameInterval) {
            return;
        }
        lastParticleFrame = currentTime;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles = particles.filter(p => p.life > 0);

        particles.forEach(p => {
            p.update();
            p.draw();
        });
    }

    // Game Log System
    // One message at a time. A message shown with `hold` (combat reports) stays up for that long; messages
    // that arrive meanwhile wait and then show in order (the latest 3), so a report is never wiped at once.
    let gameLogHoldUntil = 0;
    let gameLogQueue = [];
    let gameLogFlushTimer = null;
    let gameLogHideTimer = null;

    function showGameLog(message, isEnemy = false, isScifi = false, { hold = 0 } = {}) {
        const now = Date.now();
        if (!hold && now < gameLogHoldUntil) {
            gameLogQueue = [...gameLogQueue, { message, isEnemy, isScifi }].slice(-3);
            clearMatchDelay(gameLogFlushTimer);
            gameLogFlushTimer = matchDelay(flushGameLog, gameLogHoldUntil - now);
            return;
        }
        if (hold) {
            gameLogQueue = [];
            gameLogHoldUntil = now + hold;
        }

        const log = document.getElementById('gameLog');
        if (message.startsWith('⚠️')) GameFeedback.play('deny');
        // During a match the toast sits on the turn banner, above the board, so it never covers cards
        const banner = document.getElementById('turnBanner');
        const inMatch = document.getElementById('gameContainer')?.style.display === 'flex';
        const host = inMatch && banner ? banner : document.body;
        if (log.parentElement !== host) host.appendChild(log);
        log.textContent = message;
        log.className = `game-log show${inMatch ? ' is-docked' : ''}`;

        if (isEnemy) {
            log.classList.add('enemy');
        }
        if (isScifi) {
            log.classList.add('scifi');
        }

        clearMatchDelay(gameLogHideTimer);
        gameLogHideTimer = matchDelay(() => {
            log.classList.remove('show');
        }, hold || 2000);
    }

    // Effects (Web Audio) start only after the player touches the page; each later gesture also resumes audio the
    // browser suspended or interrupted (a call, a background tab)
    ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'].forEach(type =>
        document.addEventListener(type, event => {
            if (event.isTrusted) GameFeedback.unlock();
        }, { capture: true, passive: true }));

    // Leaving a match drops its pending toasts, so a menu message isn't held behind a combat report
    function resetGameLog() {
        gameLogQueue = [];
        gameLogHoldUntil = 0;
        clearMatchDelay(gameLogFlushTimer);
        clearMatchDelay(gameLogHideTimer);
        const log = document.getElementById('gameLog');
        log?.classList.remove('show');
        if (log && log.parentElement !== document.body) document.body.appendChild(log);
    }

    function flushGameLog() {
        const next = gameLogQueue.shift();
        if (!next) return;
        gameLogHoldUntil = 0;
        showGameLog(next.message, next.isEnemy, next.isScifi);
        if (gameLogQueue.length) {
            gameLogHoldUntil = Date.now() + 900;
            gameLogFlushTimer = matchDelay(flushGameLog, 900);
        }
    }

    // After combat: who blocked whom and what died, in one message (blocks are automatic, so this is the
    // only place the player sees them).
    // ---- Match history: a bounded record of what happened this match, for review after the temporary messages
    // are gone. Events are recorded once, where the game acts (never while rendering), and only say what both
    // players can see: cards are named once they are played, revealed or in a graveyard; draws are counted.
    const MATCH_HISTORY_LIMIT = 80;
    let matchHistory = [];
    let matchHistorySeq = 0;
    let matchHistoryDropped = 0;
    let matchHistoryUnread = 0;

    const cardLabel = card => `${card.emoji} ${card.name}`;
    const sideName = side => (side === 'player' ? 'You' : 'Enemy');

    function resetMatchHistory() {
        matchHistory = [];
        matchHistorySeq = 0;
        matchHistoryDropped = 0;
        matchHistoryUnread = 0;
        updateHistoryButton();
    }

    function recordHistory(side, text, details = []) {
        matchHistory.push({ seq: ++matchHistorySeq, round: gameState.round || 1, side, text, details: details.filter(Boolean) });
        if (matchHistory.length > MATCH_HISTORY_LIMIT) {
            matchHistoryDropped += matchHistory.length - MATCH_HISTORY_LIMIT;
            matchHistory.splice(0, matchHistory.length - MATCH_HISTORY_LIMIT);
        }
        const modal = document.getElementById('historyModal');
        if (modal?.classList.contains('show')) {
            renderMatchHistory();
        } else {
            matchHistoryUnread++;
        }
        updateHistoryButton();
    }

    // What is visible before an action, so its results can be described afterwards
    function snapshotForHistory() {
        const board = list => new Map(list.map(c => [c.id, { card: c, power: c.power, toughness: c.toughness, tapped: !!c.tapped }]));
        return {
            life: { player: gameState.playerLife, enemy: gameState.enemyLife },
            boards: { player: board(gameState.playerBoard), enemy: board(gameState.enemyBoard) },
            hands: { player: gameState.playerHand.length, enemy: gameState.enemyHand.length },
            graves: { player: gameState.playerGraveyard.length, enemy: gameState.enemyGraveyard.length }
        };
    }

    // The visible results of an action since a snapshot: life, cards destroyed, returned to hand, created or
    // changed, cards drawn (counted) and discarded (named: the graveyard is public). playedFrom: the side whose
    // hand the action's own card came from, and that card's id, so playing it isn't reported twice.
    function describeChangesSince(snap, { playedFrom = null, playedId = null } = {}) {
        const out = [];
        ['player', 'enemy'].forEach(side => {
            const now = side === 'player' ? gameState.playerLife : gameState.enemyLife;
            if (now !== snap.life[side]) out.push(`${sideName(side)}: ❤️ ${snap.life[side]} → ${now}`);
        });
        ['player', 'enemy'].forEach(side => {
            const board = side === 'player' ? gameState.playerBoard : gameState.enemyBoard;
            const hand = side === 'player' ? gameState.playerHand : gameState.enemyHand;
            const grave = side === 'player' ? gameState.playerGraveyard : gameState.enemyGraveyard;
            const owner = side === 'player' ? '' : 'enemy ';
            const ids = new Set(board.map(c => c.id));
            snap.boards[side].forEach(({ card }, id) => {
                if (ids.has(id) || card.type === 'land') return;
                if (hand.some(c => c.id === id)) out.push(`↩️ ${owner}${cardLabel(card)} returns to hand`);
                else if (card.type === 'artifact') out.push(`⚙️ ${owner}${cardLabel(card)} is used up`);
                else out.push(`💀 ${owner}${cardLabel(card)} is destroyed`);
            });
            board.forEach(card => {
                const before = snap.boards[side].get(card.id);
                if (!before) {
                    if (card.id !== playedId && card.type !== 'land') out.push(`✨ ${owner}${cardLabel(card)} enters the battlefield`);
                    return;
                }
                if (card.type === 'creature' && (card.power !== before.power || card.toughness !== before.toughness)) {
                    out.push(`${owner}${cardLabel(card)} becomes ${card.power}/${card.toughness}`);
                }
                if (card.type === 'creature' && card.tapped && !before.tapped) out.push(`${owner}${cardLabel(card)} is tapped`);
            });
            const handChange = hand.length - (snap.hands[side] - (playedFrom === side ? 1 : 0));
            const graveGain = grave.length - snap.graves[side];
            if (handChange > 0) out.push(`${sideName(side)} ${side === 'player' ? 'draw' : 'draws'} ${handChange} card${handChange === 1 ? '' : 's'}`);
            if (handChange < 0 && graveGain > 0) {
                const discarded = grave.slice(-Math.min(graveGain, -handChange)).map(cardLabel).join(', ');
                out.push(`${sideName(side)} ${side === 'player' ? 'discard' : 'discards'} ${discarded}`);
            }
        });
        return out;
    }

    // One attacker's combat, in words. Used for the live result (history, from the real totals) and for the
    // preview (from previewCombat), so both read the same way.
    function describeCombatPair({ attacker, blockers, attackerDies, blockersDie, lifeChange }, isPlayerAttacking) {
        const defender = isPlayerAttacking ? 'enemy' : 'player';
        const attackerSide = isPlayerAttacking ? 'player' : 'enemy';
        const parts = [];
        if (blockers.length) {
            parts.push(`blocked by ${blockers.map(cardLabel).join(' + ')}`);
            const dead = blockers.filter(b => blockersDie.includes(b.id));
            if (dead.length) parts.push(`${dead.map(b => b.name).join(' and ')} ${dead.length === 1 ? 'dies' : 'die'}`);
            parts.push(attackerDies ? `${attacker.name} dies` : `${attacker.name} survives`);
        } else {
            parts.push('unblocked');
        }
        if (lifeChange[defender]) parts.push(`${sideName(defender)} ❤️ ${lifeChange[defender] > 0 ? '+' : ''}${lifeChange[defender]}`);
        if (lifeChange[attackerSide]) parts.push(`${sideName(attackerSide)} ❤️ ${lifeChange[attackerSide] > 0 ? '+' : ''}${lifeChange[attackerSide]}`);
        return `${cardLabel(attacker)}: ${parts.join(' · ')}`;
    }

    // Resolves one side's attack with the live rules, recording each attacker's real result once
    function resolveAttackersWithHistory(attackers, blockersFor, isPlayerAttacking) {
        const untappedDefenders = (isPlayerAttacking ? gameState.enemyBoard : gameState.playerBoard)
            .filter(c => c.type === 'creature' && !c.tapped).length;
        const results = withLifeSource('combat', () => attackers.map(attacker => {
            const blockers = blockersFor(attacker);
            const before = { player: gameState.playerLife, enemy: gameState.enemyLife };
            if (!hasAbility(attacker, 'vigilance')) {
                attacker.tapped = true;
            }
            if (blockers.length > 0) {
                applyDamage(attacker, blockers, isPlayerAttacking);
            } else {
                dealUnblockedDamage(attacker, isPlayerAttacking);
            }
            return { attacker, blockers, lifeChange: { player: gameState.playerLife - before.player, enemy: gameState.enemyLife - before.enemy } };
        }));
        checkStateBasedActions();
        const alive = new Set([...gameState.playerBoard, ...gameState.enemyBoard].map(c => c.id));
        const side = isPlayerAttacking ? 'player' : 'enemy';
        const details = results.map(r => describeCombatPair({
            ...r,
            attackerDies: !alive.has(r.attacker.id),
            blockersDie: r.blockers.filter(b => !alive.has(b.id)).map(b => b.id)
        }, isPlayerAttacking));
        recordHistory(side, `⚔️ ${sideName(side)} ${isPlayerAttacking ? 'attack' : 'attacks'} with ${attackers.length} creature${attackers.length === 1 ? '' : 's'}`, details);
        reportAchievement('combat', {
            side,
            untappedDefenders,
            pairs: results.map(r => ({
                attacker: r.attacker,
                blockers: r.blockers,
                attackerDies: !alive.has(r.attacker.id),
                blockersDie: r.blockers.filter(b => !alive.has(b.id)).map(b => b.id),
                lifeChange: r.lifeChange
            }))
        });
        return results;
    }

    // Why a hand card can't be played right now, or null. The same checks playCard makes, in the same order.
    function getPlayRestriction(card) {
        if (!card) return null;
        if (gameState.matchFinalized) return { code: 'over', text: 'The match is over' };
        if (gameState.turn !== 'player' || gameState.phase === 'enemy') return { code: 'turn', text: "Wait for your turn" };
        if (card.type === 'land') {
            return gameState.landsPlayedThisTurn >= 1 ? { code: 'land', text: 'One land per turn: you have played one' } : null;
        }
        if (canPayCost(card.cost || {}, gameState.playerMana)) return null;
        const missing = getMissingMana(card.cost || {}, gameState.playerMana);
        const untapped = gameState.playerBoard.filter(c => c.type === 'land' && !c.tapped).length;
        const need = Object.entries(missing).map(([el, n]) => `${n} ${ELEMENTS[el]?.emoji || '◇'}`).join(' + ') || 'more mana';
        return { code: 'mana', text: `Needs ${need} more in your mana pool${untapped ? ` (${untapped} untapped land${untapped === 1 ? '' : 's'})` : ''}` };
    }

    // What canPayCost finds short: coloured mana first (colourless in the pool can stand in), then the generic part
    function getMissingMana(cost, mana) {
        const missing = {};
        let spareColorless = mana.colorless || 0;
        let paid = 0;
        Object.entries(cost).forEach(([element, required]) => {
            if (element === 'colorless') return;
            const available = mana[element] || 0;
            const fromColour = Math.min(required, available);
            const fromColorless = Math.min(required - fromColour, spareColorless);
            spareColorless -= fromColorless;
            paid += fromColour + fromColorless;
            if (required - fromColour - fromColorless > 0) missing[element] = required - fromColour - fromColorless;
        });
        const total = Object.values(mana).reduce((sum, n) => sum + (n || 0), 0);
        const generic = cost.colorless || 0;
        const genericShort = generic - Math.max(0, total - paid);
        if (genericShort > 0) missing.colorless = genericShort;
        return missing;
    }

    // ---- Turn banner and AI status (what the AI is doing, in words; never what is in its hand)
    let aiStatusText = '';

    function setAiStatus(text) {
        aiStatusText = text;
        updateTurnBanner();
    }

    function updateTurnBanner() {
        const banner = document.getElementById('turnBanner');
        if (!banner) return;
        const enemyTurn = gameState.turn === 'enemy' || gameState.phase === 'enemy';
        const turn = enemyTurn ? 'enemy' : 'player';
        let phase;
        if (gameState.matchFinalized) phase = 'Match over';
        else if (enemyTurn) phase = aiStatusText || 'Thinking…';
        else if (attackPhase) phase = 'Choose attackers';
        else phase = gameState.hasAttackedThisTurn ? 'Main phase · attacked' : 'Main phase';
        const label = enemyTurn ? '🤖 Enemy turn' : '⚔️ Your turn';
        const text = `${label} · ${phase}`;
        if (banner.dataset.turn !== turn) {
            banner.dataset.turn = turn;
            banner.classList.remove('turn-changed');
            void banner.offsetWidth;
            banner.classList.add('turn-changed');
        }
        banner.querySelector('.turn-banner-round').textContent = `Turn ${gameState.round || 1}`;
        const textEl = banner.querySelector('.turn-banner-text');
        if (textEl.textContent !== text) textEl.textContent = text;
    }

    // ---- Attack preview. Kept outside gameState and recomputed (previewCombat) only when something it depends on
    // changes: the chosen attackers, any creature's stats, damage, tapped state or keywords, or a life total.
    let combatPreviewState = { key: '', preview: null };

    function combatPreviewKey() {
        const creature = c => [c.id, c.power, c.toughness, c.damage || 0, c.tapped ? 1 : 0, (c.abilities || []).join('+')].join(':');
        const creatures = board => board.filter(c => c.type === 'creature').map(creature);
        return JSON.stringify([gameState.attackers, creatures(gameState.playerBoard), creatures(gameState.enemyBoard), gameState.playerLife, gameState.enemyLife]);
    }

    function refreshCombatPreview() {
        if (!attackPhase || gameState.turn !== 'player' || gameState.matchFinalized) {
            combatPreviewState = { key: '', preview: null };
            return null;
        }
        const key = combatPreviewKey();
        if (key !== combatPreviewState.key) {
            const attackers = gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean);
            combatPreviewState = { key, preview: attackers.length ? previewCombat(attackers, gameState.enemyBoard, true) : null };
        }
        return combatPreviewState.preview;
    }

    // Marks a card with its predicted part in the attack (✓ survives, ☠ dies, 🛡 blocks); returns words for its name
    function markPreviewOutcome(cardEl, cardId) {
        const preview = combatPreviewState.preview;
        if (!preview) return '';
        const asAttacker = preview.pairs.find(p => p.attackerId === cardId);
        const asBlocker = preview.pairs.find(p => p.blockerIds.includes(cardId));
        if (!asAttacker && !asBlocker) return '';
        const dies = asAttacker ? asAttacker.attackerDies : asBlocker.blockersDie.includes(cardId);
        const mark = document.createElement('div');
        mark.className = `preview-mark ${dies ? 'preview-dies' : 'preview-survives'}`;
        mark.textContent = asBlocker ? (dies ? '🛡☠' : '🛡') : (dies ? '☠' : '✓');
        mark.setAttribute('aria-hidden', 'true');
        cardEl.appendChild(mark);
        cardEl.classList.add(asBlocker ? 'preview-blocker' : 'preview-attacker');
        if (asBlocker) {
            const attacker = gameState.playerBoard.find(c => c.id === asBlocker.attackerId);
            return `, preview: blocks ${attacker?.name || 'an attacker'}${dies ? ' and dies' : ''}`;
        }
        return dies ? ', preview: dies' : ', preview: survives';
    }

    function renderCombatPreviewPanel() {
        const panel = document.getElementById('combatPreview');
        if (!panel) return;
        const active = attackPhase && gameState.turn === 'player' && !gameState.matchFinalized;
        panel.hidden = !active;
        if (!active) {
            panel.dataset.previewKey = '';
            return;
        }
        if (panel.dataset.previewKey === combatPreviewState.key) return;
        panel.dataset.previewKey = combatPreviewState.key;
        const summary = panel.querySelector('.combat-preview-summary');
        const list = panel.querySelector('.combat-preview-list');
        const preview = combatPreviewState.preview;
        list.innerHTML = '';
        if (!preview) {
            summary.textContent = 'Tap creatures to attack. Blocks are automatic: each attacker meets the toughest creature that can block it.';
            panel.classList.remove('has-preview');
            return;
        }
        panel.classList.add('has-preview');
        const find = id => [...gameState.playerBoard, ...gameState.enemyBoard].find(c => c.id === id);
        const lost = board => preview.deaths.filter(id => board.some(c => c.id === id)).length;
        const parts = [`Enemy ❤️ ${gameState.enemyLife} → ${preview.life.enemy}`];
        if (preview.life.player !== gameState.playerLife) parts.push(`You ❤️ ${gameState.playerLife} → ${preview.life.player}`);
        parts.push(`Enemy loses ${lost(gameState.enemyBoard)}`, `You lose ${lost(gameState.playerBoard)}`);
        if (preview.result === 'win') parts.push('🏆 Wins the match');
        summary.textContent = parts.join(' · ');
        preview.pairs.forEach(pair => {
            const item = document.createElement('li');
            item.textContent = describeCombatPair({
                attacker: find(pair.attackerId),
                blockers: pair.blockerIds.map(find).filter(Boolean),
                attackerDies: pair.attackerDies,
                blockersDie: pair.blockersDie,
                lifeChange: pair.lifeChange
            }, true);
            list.appendChild(item);
        });
    }

    // ---- Match history dialog
    function updateHistoryButton() {
        const button = document.getElementById('historyBtn');
        const badge = document.getElementById('historyBadge');
        if (!button || !badge) return;
        badge.hidden = matchHistoryUnread === 0;
        badge.textContent = matchHistoryUnread > 9 ? '9+' : String(matchHistoryUnread);
        button.setAttribute('aria-label', matchHistoryUnread ? `Match history, ${matchHistoryUnread} new` : 'Match history');
    }

    function renderMatchHistory() {
        const list = document.getElementById('historyList');
        const note = document.getElementById('historyNote');
        if (!list) return;
        list.innerHTML = '';
        let round = null;
        matchHistory.forEach(entry => {
            if (entry.round !== round) {
                round = entry.round;
                const heading = document.createElement('li');
                heading.className = 'history-round';
                heading.textContent = `Turn ${round}`;
                list.appendChild(heading);
            }
            const item = document.createElement('li');
            item.className = `history-item history-${entry.side}`;
            const text = document.createElement('div');
            text.className = 'history-text';
            text.textContent = entry.text;
            item.appendChild(text);
            if (entry.details.length) {
                const details = document.createElement('ul');
                details.className = 'history-details';
                entry.details.forEach(line => {
                    const li = document.createElement('li');
                    li.textContent = line;
                    details.appendChild(li);
                });
                item.appendChild(details);
            }
            list.appendChild(item);
        });
        if (!matchHistory.length) {
            const empty = document.createElement('li');
            empty.className = 'history-item';
            empty.textContent = 'Nothing has happened yet.';
            list.appendChild(empty);
        }
        if (note) {
            note.textContent = matchHistoryDropped
                ? `The last ${MATCH_HISTORY_LIMIT} events of this match (${matchHistoryDropped} older not kept).`
                : `Everything that happened this match, oldest first (up to ${MATCH_HISTORY_LIMIT} events).`;
        }
        const scroller = document.getElementById('historyScroll');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }

    function showMatchHistory() {
        if (document.getElementById('gameContainer').style.display !== 'flex') return;
        matchHistoryUnread = 0;
        updateHistoryButton();
        renderMatchHistory();
        playSFX('menuOpen');
        document.getElementById('historyModal').classList.add('show');
    }

    function hideMatchHistory() {
        document.getElementById('historyModal').classList.remove('show');
    }

    function reportCombat(pairs, attackerSide) {
        if (!pairs.length) return;
        const alive = card => [...gameState.playerBoard, ...gameState.enemyBoard].some(c => c.id === card.id);
        const label = card => `${card.emoji} ${card.name}${alive(card) ? '' : ' 💀'}`;
        const yours = attackerSide === 'player';
        const lines = pairs.map(({ attacker, blockers }) => blockers.length
            ? `${label(attacker)} ⛔ blocked by ${blockers.map(label).join(' + ')}`
            : `${label(attacker)} ➜ unblocked (${attacker.power || 0})`);
        showGameLog(`${yours ? '⚔️ Your attack' : '🛡️ Enemy attack'}: ${lines.join(' · ')}`, !yours, false, { hold: 3500 });
    }

    // Visual Effects Functions
    function createSparkles(x, y, count = 15) {
        if (prefersReducedMotion()) return;
        const sparkleEmojis = ['✨', '💫', '⭐', '🌟', '💖'];
        for (let i = 0; i < count; i++) {
            matchDelay(() => {
                const sparkle = document.createElement('div');
                sparkle.className = 'sparkle';
                sparkle.textContent = sparkleEmojis[Math.floor(Math.random() * sparkleEmojis.length)];
                sparkle.style.left = (x + (Math.random() - 0.5) * 100) + 'px';
                sparkle.style.top = (y + (Math.random() - 0.5) * 100) + 'px';
                document.body.appendChild(sparkle);
                matchDelay(() => sparkle.remove(), 1000);
            }, i * 50);
        }
    }

    function createTrampleEffect(x, y) {
        if (prefersReducedMotion()) return;
        const trampleEmojis = ['💥', '⚡', '💢', '💨'];
        for (let i = 0; i < 5; i++) {
            matchDelay(() => {
                const effect = document.createElement('div');
                effect.className = 'trample-effect';
                effect.textContent = trampleEmojis[Math.floor(Math.random() * trampleEmojis.length)];
                effect.style.left = (x + (Math.random() - 0.5) * 80) + 'px';
                effect.style.top = (y + (Math.random() - 0.5) * 80) + 'px';
                document.body.appendChild(effect);
                matchDelay(() => effect.remove(), 800);
            }, i * 100);
        }
    }

    function shakeScreen() {
        if (prefersReducedMotion()) return;
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.classList.add('shake-board');
        matchDelay(() => {
            gameContainer.classList.remove('shake-board');
        }, 500);
    }

    function shakeElement(element) {
        element.classList.add('shake');
        matchDelay(() => {
            element.classList.remove('shake');
        }, 500);
    }

    // Menu Navigation
    function showElementSelection() {
        playSFX('menuOpen');
        setStartMenuScreen('elementSelectionScreen');
        resetElementSelection();
        restoreSavedDeckSelection();
        syncDifficultyUI();
    }

    function setHowToPlayPage(n) {
        const targetPage = n === 2 ? 2 : 1;
        const pages = document.querySelectorAll('#howToPlayScreen .howto-page');
        pages.forEach(page => {
            const pageNum = Number(page.dataset.page || 1);
            page.style.display = pageNum === targetPage ? 'block' : 'none';
        });

        const indicator = document.getElementById('howToPlayPageIndicator');
        if (indicator) {
            indicator.textContent = `Page ${targetPage}/2`;
        }
    }

    function renderKeywordGuide() {
        const list = document.getElementById('howToPlayKeywords');
        if (!list) return;
        list.innerHTML = Object.values(KEYWORD_RULES)
            .map(rule => `<li>${rule.badge} <strong>${rule.label}</strong> - ${rule.text}</li>`)
            .join('');
    }

    function showHowToPlay() {
        playSFX('menuOpen');
        renderKeywordGuide();
        setStartMenuScreen('howToPlayScreen');
        setHowToPlayPage(1);
    }

    function showStats() {
        playSFX('menuOpen');
        setStartMenuScreen('statsScreen');
        updateStatsDisplay();
    }


    function showDeckBuilder() {
        playSFX('menuOpen');
        setStartMenuScreen('deckBuilderScreen');
        initializeDeckBuilder();
    }

    function updatePackShopCreditsBadge() {
        const creditsEl = document.getElementById('shopCreditsBadge');
        if (!creditsEl) return;
        const credits = getShopCredits();
        creditsEl.textContent = `💳 Credits: ${credits}`;
        updatePackShopTiles();
    }

    const getShopCredits = () => (Number.isFinite(gameMeta?.wallet?.credits) ? Math.max(0, Math.floor(gameMeta.wallet.credits)) : 0);
    const getPackTheme = themeKey => PACK_THEMES.find(theme => theme.key === themeKey) || null;
    const formatPackChance = p => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

    // "3 × Common · 1 × Rare · 1 × Epic/Legendary", from the same slot plan generatePack uses
    function describePackSlotsShort(themeKey) {
        return describePackSlots(themeKey).slots.map(slot => `${slot.count} × ${slot.label}`).join(' · ');
    }

    // A few of a pack's rarest cards for its art, without repeating an emoji
    function getPackArtSample(themeKey, count = 4) {
        const order = { 'epic+': 0, rare: 1, common: 2 };
        const seen = new Set();
        return getThemePool(themeKey)
            .slice()
            .sort((a, b) => order[packTierOf(a)] - order[packTierOf(b)])
            .filter(card => !seen.has(card.emoji) && seen.add(card.emoji))
            .slice(0, count)
            .map(card => card.emoji);
    }

    // The shop tiles are built once; prices, affordability and owned counts are refreshed in place so focus
    // stays on the button that was pressed.
    function renderPackShop() {
        const grid = document.getElementById('packShopGrid');
        if (!grid) return;
        if (!grid.children.length) {
            PACK_THEMES.forEach(theme => {
                const key = theme.key;
                const cost = PACK_SHOP_COSTS[key];
                const tile = document.createElement('article');
                tile.className = 'shop-pack';
                tile.dataset.theme = key;
                tile.setAttribute('aria-labelledby', `shopPackName-${key}`);
                tile.innerHTML = `
                    <div class="shop-pack-art" aria-hidden="true">
                        <span class="shop-pack-art-icon">${theme.icon}</span>
                        <span class="shop-pack-art-strip">${getPackArtSample(key).map(e => `<span>${e}</span>`).join('')}</span>
                    </div>
                    <div class="shop-pack-body">
                        <div class="shop-pack-head">
                            <h3 class="shop-pack-name" id="shopPackName-${key}">${theme.label} Pack</h3>
                            <span class="shop-pack-price" id="shopPackPrice-${key}" aria-label="Price: ${cost} credits">💳 ${cost}</span>
                        </div>
                        <p class="shop-pack-tagline">${theme.tagline}</p>
                        <p class="shop-pack-slots">${describePackSlotsShort(key)}</p>
                        <p class="shop-pack-owned" data-role="owned"></p>
                        <div class="shop-pack-actions">
                            <button type="button" class="menu-btn shop-pack-btn" data-theme="${key}" aria-describedby="shopPackPrice-${key} shopPackAfford-${key}"></button>
                            <button type="button" class="shop-pack-info" data-theme="${key}" aria-haspopup="dialog">What’s inside</button>
                        </div>
                        <p class="shop-pack-afford" id="shopPackAfford-${key}" data-role="afford"></p>
                    </div>`;
                tile.querySelector('.shop-pack-btn').addEventListener('click', () => purchasePack(key));
                tile.querySelector('.shop-pack-info').addEventListener('click', () => showPackContents(key));
                grid.appendChild(tile);
            });
        }
        updatePackShopTiles();
    }

    function updatePackShopTiles() {
        const grid = document.getElementById('packShopGrid');
        if (!grid || !grid.children.length) return;
        const credits = getShopCredits();
        const collection = gameMeta?.collection || {};
        grid.querySelectorAll('.shop-pack').forEach(tile => {
            const key = tile.dataset.theme;
            const theme = getPackTheme(key);
            const cost = PACK_SHOP_COSTS[key];
            const pool = getThemePool(key);
            const owned = pool.filter(card => (collection[card.__id] || 0) > 0).length;
            const affordable = credits >= cost;
            const buy = tile.querySelector('.shop-pack-btn');
            tile.classList.toggle('is-unaffordable', !affordable);
            buy.textContent = affordable ? `BUY · 💳 ${cost}` : `NEED ${cost - credits} MORE`;
            buy.setAttribute('aria-label', affordable ? `Buy ${theme.label} Pack for ${cost} credits` : `${theme.label} Pack: you need ${cost - credits} more credits`);
            // Still pressable when short of credits: pressing says how many more are needed
            buy.classList.toggle('is-unaffordable', !affordable);
            tile.querySelector('[data-role="owned"]').textContent = `${pool.length} cards · you have ${owned}`;
            tile.querySelector('[data-role="afford"]').textContent = affordable
                ? `You have 💳 ${credits}`
                : `You have 💳 ${credits} of ${cost}. Win or play matches to earn more.`;
        });
    }

    // ---- What's inside a pack: every card it can contain, grouped by rarity tier, with exact odds
    let packContentsTheme = null;

    function renderPackContents(themeKey) {
        const theme = getPackTheme(themeKey);
        if (!theme) return false;
        const odds = getPackOdds(themeKey);
        const { notes } = describePackSlots(themeKey);
        const collection = gameMeta?.collection || {};
        const cost = PACK_SHOP_COSTS[themeKey];
        const credits = getShopCredits();

        document.getElementById('packContentsTitle').textContent = `${theme.icon} ${theme.label} Pack`;
        const chances = ['common', 'rare', 'epic+']
            .filter(tier => odds.counts[tier])
            .map(tier => `<li><span class="pack-odds-tier tier-${tier.replace('+', 'plus')}">${PACK_TIER_LABELS[tier]}</span>: ${odds.counts[tier]} card${odds.counts[tier] === 1 ? '' : 's'}, each in <strong>${formatPackChance(odds.perCard[tier])}</strong> of packs</li>`)
            .join('');
        document.getElementById('packContentsSummary').innerHTML = `
            <p class="pack-contents-tagline">${theme.tagline}.</p>
            <p><strong>${odds.pool.length} cards</strong> can be in this pack. Each pack has ${PACK_SIZE} different cards: ${describePackSlotsShort(themeKey)}.</p>
            <ul class="pack-odds">${chances}</ul>
            ${notes.map(note => `<p class="pack-contents-note">${note}</p>`).join('')}`;

        const order = ['epic+', 'rare', 'common'];
        const list = document.getElementById('packContentsList');
        list.innerHTML = '';
        order.forEach(tier => {
            const cards = odds.pool.filter(card => packTierOf(card) === tier);
            if (!cards.length) return;
            const section = document.createElement('section');
            section.className = 'pack-contents-group';
            section.innerHTML = `<h3 class="pack-contents-heading">${PACK_TIER_LABELS[tier]} <span>(${cards.length})</span></h3>`;
            const ul = document.createElement('ul');
            ul.className = 'pack-contents-rows';
            cards.forEach(card => {
                const n = collection[card.__id] || 0;
                const li = document.createElement('li');
                li.className = `pack-contents-row${n ? '' : ' is-unowned'}`;
                li.dataset.cardId = card.__id;
                li.appendChild(createCardRowArt(card));
                const body = document.createElement('span');
                body.className = 'pack-contents-body';
                body.innerHTML = `<span class="pack-contents-name">${card.name}</span><span class="card-row-meta">${renderCardRowMeta(card)}</span>`;
                li.appendChild(body);
                const ownedEl = document.createElement('span');
                ownedEl.className = 'pack-contents-owned';
                ownedEl.textContent = n ? `Owned ×${n}` : 'Not owned';
                li.appendChild(ownedEl);
                ul.appendChild(li);
            });
            section.appendChild(ul);
            list.appendChild(section);
        });

        const buy = document.getElementById('packContentsBuyBtn');
        const affordable = credits >= cost;
        buy.textContent = affordable ? `BUY · 💳 ${cost}` : `NEED ${cost - credits} MORE CREDITS`;
        buy.classList.toggle('is-unaffordable', !affordable);
        buy.onclick = () => {
            hidePackContents();
            purchasePack(themeKey);
        };
        return true;
    }

    function showPackContents(themeKey) {
        if (!renderPackContents(themeKey)) return;
        packContentsTheme = themeKey;
        playSFX('menuOpen');
        document.getElementById('packContentsScroll').scrollTop = 0;
        document.getElementById('packContentsModal').classList.add('show');
    }

    function hidePackContents() {
        packContentsTheme = null;
        document.getElementById('packContentsModal')?.classList.remove('show');
    }

    function setPackShopMessage(message = '', type = '') {
        const messageEl = document.getElementById('packShopMessage');
        if (!messageEl) return;
        messageEl.textContent = message;
        messageEl.classList.remove('error', 'success');
        if (type === 'error' || type === 'success') {
            messageEl.classList.add(type);
        }
    }

    function showPackShop() {
        playSFX('menuOpen');
        setStartMenuScreen('packShopScreen');
        renderPackShop();
        updatePackShopCreditsBadge();
        setPackShopMessage('Choose a pack to buy with credits.');
    }

    function hidePackShop() {
        playSFX('menuClose');
        setStartMenuScreen('mainMenu');
        focusSafeElement();
    }

    // ---- Card lists: search, combinable filters and sorting shared by the Binder and the Deck Builder pool.
    // Filters only change what is shown; they never touch the collection or a deck being edited.
    const CARD_FILTER_OPTIONS = {
        element: [['all', 'All elements'], ['fire', '🔥 Fire'], ['water', '💧 Water'], ['earth', '🌍 Earth'], ['swamp', '💀 Swamp'],
            ['light', '☀️ Light'], ['multicolor', 'Two or more colours'], ['colorless', '◇ Colorless']],
        type: [['all', 'All types'], ['creature', '🐾 Creatures'], ['instant', '✨ Instants'], ['artifact', '⚙️ Artifacts'], ['land', '⛰️ Lands']],
        cost: [['all', 'Any cost'], ['0', 'Cost 0'], ['1', 'Cost 1'], ['2', 'Cost 2'], ['3', 'Cost 3'], ['4', 'Cost 4'], ['5', 'Cost 5'], ['6+', 'Cost 6+']],
        rarity: [['all', 'Any rarity'], ['common', '● Common'], ['rare', '◆ Rare'], ['epic', '⬢ Epic'], ['legendary', '★ Legendary']],
        sort: [['name', 'Sort: name'], ['cost', 'Sort: mana value'], ['rarity', 'Sort: rarest first'], ['type', 'Sort: type'], ['owned', 'Sort: most owned']]
    };
    const CARD_OWNED_OPTIONS = {
        binderFilters: [['all', 'All cards'], ['owned', 'Owned'], ['unowned', 'Not owned']],
        deckBuilderFilters: [['owned', 'Owned cards'], ['all', 'All legal cards'], ['unowned', 'Not owned']]
    };
    const CARD_FILTER_DEFAULTS = {
        binderFilters: { query: '', element: 'all', type: 'all', cost: 'all', rarity: 'all', owned: 'all', sort: 'name' },
        deckBuilderFilters: { query: '', element: 'all', type: 'all', cost: 'all', rarity: 'all', owned: 'owned', sort: 'name' }
    };
    const cardFilterState = {
        binderFilters: { ...CARD_FILTER_DEFAULTS.binderFilters },
        deckBuilderFilters: { ...CARD_FILTER_DEFAULTS.deckBuilderFilters }
    };
    const CARD_TYPE_ORDER = ['creature', 'instant', 'artifact', 'land'];

    const getCardManaValue = card => Object.values(card?.cost || {}).reduce((sum, n) => sum + n, 0);

    function cardMatchesFilters(card, filters, ownedCount) {
        const identity = getCardIdentity(card);
        if (filters.query) {
            const keywords = (card.abilities || []).map(a => KEYWORD_RULES[a]?.label || a).join(' ');
            if (!`${card.name} ${card.desc || ''} ${keywords}`.toLowerCase().includes(filters.query.toLowerCase())) return false;
        }
        if (filters.element === 'multicolor' && identity.length < 2) return false;
        if (filters.element !== 'all' && filters.element !== 'multicolor' && !identity.includes(filters.element)) return false;
        if (filters.type !== 'all' && card.type !== filters.type) return false;
        if (filters.cost !== 'all') {
            const mv = getCardManaValue(card);
            if (filters.cost === '6+' ? mv < 6 : mv !== Number(filters.cost)) return false;
        }
        if (filters.rarity !== 'all' && getCardRarity(card) !== filters.rarity) return false;
        if (filters.owned === 'owned' && ownedCount <= 0) return false;
        if (filters.owned === 'unowned' && ownedCount > 0) return false;
        return true;
    }

    function sortCardsForList(cards, sort, ownedOf) {
        const byName = (a, b) => (a.name || '').localeCompare(b.name || '') || a.__id.localeCompare(b.__id);
        const compare = {
            name: byName,
            cost: (a, b) => getCardManaValue(a) - getCardManaValue(b) || byName(a, b),
            rarity: (a, b) => CARD_RARITIES.indexOf(getCardRarity(b)) - CARD_RARITIES.indexOf(getCardRarity(a)) || byName(a, b),
            type: (a, b) => CARD_TYPE_ORDER.indexOf(a.type) - CARD_TYPE_ORDER.indexOf(b.type) || byName(a, b),
            owned: (a, b) => ownedOf(b) - ownedOf(a) || byName(a, b)
        }[sort] || byName;
        return [...cards].sort(compare);
    }

    // Builds the search box and selects once; afterwards it only syncs their values with the state.
    function buildCardFilterBar(scopeId, onChange) {
        const container = document.getElementById(scopeId);
        if (!container) return;
        const filters = cardFilterState[scopeId];
        if (!container.dataset.built) {
            container.dataset.built = 'true';
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'card-filter-search';
            search.dataset.filter = 'query';
            search.placeholder = 'Search names, text, keywords';
            search.setAttribute('aria-label', 'Search cards');
            search.addEventListener('input', () => { filters.query = search.value.trim(); container.onFilterChange?.(); });
            container.appendChild(search);
            // The selects fold away on narrow screens (search stays visible); open by default elsewhere
            const more = document.createElement('details');
            more.className = 'card-filter-more';
            more.open = !window.matchMedia('(max-width: 519px)').matches;
            const summary = document.createElement('summary');
            summary.className = 'card-filter-summary';
            summary.textContent = 'Filters & sort';
            more.appendChild(summary);
            const selects = document.createElement('div');
            selects.className = 'card-filter-selects';
            const fields = { element: 'Element', type: 'Card type', cost: 'Mana value', rarity: 'Rarity', owned: 'Ownership', sort: 'Sort order' };
            Object.entries(fields).forEach(([name, label]) => {
                const select = document.createElement('select');
                select.dataset.filter = name;
                select.setAttribute('aria-label', label);
                const options = name === 'owned' ? CARD_OWNED_OPTIONS[scopeId] : CARD_FILTER_OPTIONS[name];
                options.forEach(([value, text]) => select.add(new Option(text, value)));
                select.addEventListener('change', () => { filters[name] = select.value; container.onFilterChange?.(); });
                selects.appendChild(select);
            });
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'card-filter-reset';
            reset.textContent = 'Clear';
            reset.setAttribute('aria-label', 'Clear search and filters');
            reset.addEventListener('click', () => resetCardFilters(scopeId));
            selects.appendChild(reset);
            more.appendChild(selects);
            container.appendChild(more);
        }
        container.onFilterChange = onChange;
        container.querySelectorAll('[data-filter]').forEach(el => { el.value = filters[el.dataset.filter]; });
        const active = Object.entries(filters).filter(([k, v]) => !['sort', 'query'].includes(k) && v !== CARD_FILTER_DEFAULTS[scopeId][k]).length;
        container.classList.toggle('is-filtered', active > 0 || !!filters.query);
        const summary = container.querySelector('.card-filter-summary');
        if (summary) summary.textContent = active ? `Filters & sort (${active} on)` : 'Filters & sort';
    }

    function resetCardFilters(scopeId) {
        Object.assign(cardFilterState[scopeId], CARD_FILTER_DEFAULTS[scopeId]);
        const container = document.getElementById(scopeId);
        container?.querySelectorAll('[data-filter]').forEach(el => { el.value = cardFilterState[scopeId][el.dataset.filter]; });
        container?.onFilterChange?.();
    }

    // One-line card preview for list rows: cost pips, type, power/toughness and rarity, from the face helpers
    function renderCardRowMeta(card) {
        const type = CARD_TYPE_INFO[card.type];
        const rarity = getCardRarity(card);
        const parts = [];
        if (card.type !== 'land') parts.push(`<span class="row-cost">${renderCostPips(card.cost)}</span>`);
        parts.push(`<span class="row-type">${type ? `${type.icon} ${type.label}` : card.type}</span>`);
        if (card.type === 'creature') parts.push(`<span class="row-pt">${card.power}/${card.toughness}</span>`);
        if (card.type === 'land') {
            const colours = Array.isArray(card.elements) ? card.elements : [card.element];
            parts.push(`<span class="row-mana">Tap: ${colours.map(e => ELEMENTS[e]?.emoji || '◇').join(' or ')}</span>`);
        }
        (card.abilities || []).slice(0, 3).forEach(a => {
            parts.push(`<span class="row-keyword${a === 'flash' ? ' is-inactive' : ''}" title="${describeKeyword(a)}">${KEYWORD_RULES[a]?.badge || ''} ${KEYWORD_RULES[a]?.label || a}</span>`);
        });
        parts.push(`<span class="row-rarity rarity-${rarity}">${RARITY_INFO[rarity].glyph} ${RARITY_INFO[rarity].label}</span>`);
        return parts.join('');
    }

    // The emoji in its element-coloured tile, as on card faces
    function createCardRowArt(card, className = 'card-row-art') {
        const art = document.createElement('span');
        art.className = className;
        art.textContent = card.emoji || '✨';
        art.setAttribute('aria-hidden', 'true');
        applyCardIdentity(art, card);
        return art;
    }

    // The Binder lists the whole catalog: owned cards with their count, the rest marked "Not owned".
    function renderBinderCollection() {
        const listEl = document.getElementById('binderList');
        const summaryEl = document.getElementById('binderSummaryBadge');
        if (!listEl || !summaryEl) return;

        const collection = gameMeta?.collection || {};
        const ownedOf = card => (Number.isFinite(collection[card.__id]) ? collection[card.__id] : 0);
        const ownedCards = __ALL_CARDS.filter(card => ownedOf(card) > 0);
        const totalCards = ownedCards.reduce((sum, card) => sum + ownedOf(card), 0);
        summaryEl.textContent = `🗂️ ${ownedCards.length} of ${__ALL_CARDS.length} unique cards • ${totalCards} total cards`;

        buildCardFilterBar('binderFilters', renderBinderCollection);
        const filters = cardFilterState.binderFilters;
        const shown = sortCardsForList(__ALL_CARDS.filter(card => cardMatchesFilters(card, filters, ownedOf(card))), filters.sort, ownedOf);
        const showingEl = document.getElementById('binderShowing');
        if (showingEl) showingEl.textContent = `Showing ${shown.length} of ${__ALL_CARDS.length} cards`;

        listEl.innerHTML = '';
        if (!shown.length) {
            const empty = document.createElement('div');
            empty.className = 'deck-builder-empty';
            empty.textContent = ownedCards.length ? 'No cards match these filters.' : 'No cards in your binder yet. Open a few packs!';
            listEl.appendChild(empty);
            return;
        }

        shown.forEach(card => {
            const count = ownedOf(card);
            const row = document.createElement('div');
            row.className = 'binder-row';
            row.dataset.cardId = card.__id;
            row.classList.toggle('is-unowned', count === 0);
            row.appendChild(createCardRowArt(card, 'binder-row-emoji card-row-art'));
            const nameEl = document.createElement('div');
            nameEl.className = 'binder-row-name';
            nameEl.appendChild(document.createTextNode(card.name || 'Unknown Card'));
            const meta = document.createElement('div');
            meta.className = 'binder-row-meta';
            meta.innerHTML = renderCardRowMeta(card) + (count === 0 ? '<span class="row-unowned">Not owned</span>' : '');
            nameEl.appendChild(meta);
            row.appendChild(nameEl);
            const countEl = document.createElement('div');
            countEl.className = 'binder-row-count';
            countEl.textContent = `x${count}`;
            row.appendChild(countEl);
            row.title = getCardTooltipText(card);
            bindCardPress(row, {
                label: `${card.name}, ${count ? `${count} owned` : 'not owned'}. Press for details.`,
                onTap: () => showCardDetail(card),
                onLongPress: () => showCardDetail(card)
            });
            listEl.appendChild(row);
        });
    }

    function showBinder() {
        playSFX('menuOpen');
        setStartMenuScreen('binderScreen');
        renderBinderCollection();
    }

    function hideBinder() {
        playSFX('menuClose');
        setStartMenuScreen('mainMenu');
        focusSafeElement();
    }

    function purchasePack(themeKey) {
        try {
            if (!canSaveProfile()) return { ok: false, reason: 'storage_unavailable' };
            const normalizedTheme = String(themeKey || '').trim().toLowerCase();
            const cost = PACK_SHOP_COSTS[normalizedTheme];
            if (!Number.isFinite(cost)) {
                console.warn('Pack Shop purchase blocked: unknown theme key.', themeKey);
                setPackShopMessage('That pack is unavailable right now.', 'error');
                return { ok: false, reason: 'unknown_theme' };
            }

            // One purchase at a time: a second tap or Enter while the pack is open buys nothing
            if (packOpeningState.active) {
                return { ok: false, reason: 'pack_open' };
            }

            if (!gameMeta.wallet || !Number.isFinite(gameMeta.wallet.credits)) {
                gameMeta.wallet = { credits: STARTER_CREDITS };
            }

            const currentCredits = Math.max(0, Math.floor(gameMeta.wallet.credits));
            if (currentCredits < cost) {
                console.info('[Pack Shop] Purchase skipped: insufficient credits.', { cost, currentCredits, themeKey: normalizedTheme });
                setPackShopMessage(`Not enough credits yet (${currentCredits}/${cost}). Play a match to earn more!`, 'error');
                updatePackShopCreditsBadge();
                return { ok: false, reason: 'insufficient_credits', cost, currentCredits };
            }

            const cardIds = generatePack(normalizedTheme);
            if (!Array.isArray(cardIds) || cardIds.length === 0) {
                console.warn('Pack Shop purchase failed: generatePack returned no cards.', normalizedTheme);
                setPackShopMessage('Pack generation failed. Please try again.', 'error');
                return { ok: false, reason: 'empty_pack', themeKey: normalizedTheme };
            }

            const beforePurchase = gameMeta;
            const beforeOwned = lastPackOwnedBefore;
            gameMeta = JSON.parse(JSON.stringify(gameMeta));
            const openedAt = new Date().toISOString();
            gameMeta.wallet.credits = Math.max(0, currentCredits - cost);
            addPackToCollection(cardIds, openedAt);
            gameMeta.lastPack = { themeKey: normalizedTheme, cardIds, openedAt, acquisitionId: globalThis.crypto?.randomUUID?.() || `pack-${Date.now()}-${nextCardInstanceId()}` };
            gameMeta.stats.packsOpened = (readStoredNumber(gameMeta.stats?.packsOpened) ?? 0) + 1;

            if (!metaSave(gameMeta)) {
                gameMeta = beforePurchase;
                lastPackOwnedBefore = beforeOwned;
                setPackShopMessage('Purchase not completed: progress could not be saved.', 'error');
                return { ok: false, reason: 'save_failed' };
            }

            reportAchievement('pack:purchased', { themeKey: normalizedTheme, price: cost });
            reportAchievement('wallet', {});
            setPackShopMessage(`Bought a ${getPackTheme(normalizedTheme)?.label || normalizedTheme} Pack for 💳 ${cost}.`, 'success');
            updatePackShopCreditsBadge();
            openPackOpeningOverlayFromMeta('shop');
            return { ok: true, themeKey: normalizedTheme, cardIds, cost };
        } catch (error) {
            console.warn('Pack Shop purchase flow failed but UI remains usable.', error);
            setPackShopMessage('Something went wrong. Please try again.', 'error');
            return { ok: false, reason: 'exception', error };
        }
    }

    function openDeckBuilderGuide() {
        const overlay = document.getElementById('deckBuilderGuideOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
    }

    function closeDeckBuilderGuide() {
        const overlay = document.getElementById('deckBuilderGuideOverlay');
        if (!overlay) return;
        overlay.style.display = 'none';
    }

    function getDeckBuilderDeckEntries(deckKey) {
        const deck = gameMeta?.decks?.[deckKey];
        const counts = {};
        (deckBuilderState.workingCardIds || []).forEach(cardId => {
            counts[cardId] = (counts[cardId] || 0) + 1;
        });

        const deckColors = Array.isArray(deck?.colors) ? deck.colors : getDeckColorsFromKey(deckKey);
        // Every catalog card legal for the deck's colours; the ownership filter decides which are listed
        const eligibleCardIds = __ALL_CARDS
            .filter(card => isCardEligibleForDeck(card, deckColors))
            .map(card => card.__id);

        return { deck, counts, deckColors, eligibleCardIds };
    }

    const deckDisplayName = deckKey => getDeckColorsFromKey(deckKey).map(elementLabel).join(' + ') || deckKey;

    function isDeckBuilderDirty() {
        const saved = gameMeta?.decks?.[deckBuilderState.deckKey]?.cardIds;
        if (!deckBuilderState.deckKey || !Array.isArray(saved)) return false;
        return !sameCardMultiset(deckBuilderState.workingCardIds || [], saved);
    }

    // Asks before throwing away unsaved deck edits; runs onDiscard straight away when there are none
    function confirmDiscardDeckEdits(onDiscard, onKeep) {
        if (!isDeckBuilderDirty()) {
            onDiscard();
            return;
        }
        showConfirmModal('💾 UNSAVED DECK', `Your changes to ${deckDisplayName(deckBuilderState.deckKey)} aren't saved. Discard them?`, onDiscard, onKeep);
    }

    // Why a card can't be added right now, or null. Same limits saveDeckBuilderDeck enforces (validateDeckBuild).
    function getAddBlockReason(card, inDeck, owned, deckSize, targetSize) {
        const limit = getDeckBuilderCopyLimit(card);
        if (owned <= 0) return { code: 'not-owned', text: 'Not owned yet: win or buy packs to collect it' };
        if (inDeck >= limit) {
            return { code: 'copy-limit', text: limit === 1 ? 'Copy limit: 1 per deck (legendary)' : `Copy limit: ${limit} per deck` };
        }
        if (inDeck >= owned) return { code: 'no-copies', text: `All ${owned} owned ${owned === 1 ? 'copy is' : 'copies are'} in the deck` };
        if (deckSize >= targetSize) return { code: 'deck-full', text: `Deck is full (${deckSize}/${targetSize}): remove a card first` };
        return null;
    }

    function removeFromWorkingDeck(cardId, copies = 1) {
        for (let i = 0; i < copies; i++) {
            const idx = deckBuilderState.workingCardIds.lastIndexOf(cardId);
            if (idx < 0) break;
            deckBuilderState.workingCardIds.splice(idx, 1);
        }
    }

    // Removes lands, the most numerous basic land first (of one colour when given)
    function removeLandsFromWorkingDeck(count, colour = null) {
        for (let i = 0; i < count; i++) {
            const tally = {};
            deckBuilderState.workingCardIds.forEach(id => {
                const card = __CARD_BY_ID[id];
                if (card?.type !== 'land') return;
                if (colour && !inferLandElements(card).includes(colour)) return;
                tally[id] = (tally[id] || 0) + (card.element && card.element !== 'colorless' ? 1000 : 0) + 1;
            });
            const pick = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (!pick) break;
            removeFromWorkingDeck(pick, 1);
        }
    }

    // What stops the working deck from saving, each with an action that fixes it where one is clear.
    // validateDeckBuild stays the rule: a deck it accepts has no issues, and any error it reports is listed.
    function getDeckIssues(deckKey, cardIds) {
        const verdict = validateDeckBuild(deckKey, cardIds, gameMeta);
        if (verdict.ok) return [];
        const deck = gameMeta?.decks?.[deckKey];
        const target = getDeckTargetSize(deck);
        const deckColors = Array.isArray(deck?.colors) && deck.colors.length ? deck.colors : getDeckColorsFromKey(deckKey);
        const issues = [];
        const counts = {};
        cardIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

        if (cardIds.length < target) {
            issues.push({ kind: 'size', text: `Add ${plural(target - cardIds.length, 'more card')}: a deck has exactly ${target}.` });
        } else if (cardIds.length > target) {
            issues.push({ kind: 'size', text: `Remove ${plural(cardIds.length - target, 'card')}: a deck has exactly ${target}.` });
        }
        Object.entries(counts).forEach(([id, used]) => {
            const card = __CARD_BY_ID[id];
            if (!card) {
                issues.push({ kind: 'unknown', text: `Unknown card "${id}" in the deck.`, action: { label: 'Remove it', run: () => removeFromWorkingDeck(id, used) } });
                return;
            }
            if (!isCardEligibleForDeck(card, deckColors)) {
                issues.push({ kind: 'identity', text: `${card.name} isn't legal in a ${deckDisplayName(deckKey)} deck.`, action: { label: `Remove ${card.name}`, run: () => removeFromWorkingDeck(id, used) } });
            }
            const owned = Number.isFinite(gameMeta.collection?.[id]) ? gameMeta.collection[id] : 0;
            const limit = getDeckBuilderCopyLimit(card);
            const allowed = Math.min(owned, limit);
            if (used > allowed) {
                const why = owned < limit || !Number.isFinite(limit) ? `you own ${owned}` : `the limit is ${limit}${limit === 1 ? ' (legendary)' : ''}`;
                issues.push({ kind: 'copies', text: `${card.name}: ${used} in the deck, but ${why}. Remove ${used - allowed}.`,
                    action: { label: `Remove ${used - allowed}`, run: () => removeFromWorkingDeck(id, used - allowed) } });
            }
        });

        const covered = [/^Deck must contain exactly/, /^Unknown card id/, / is not valid for /, / exceeds owned copies /, / exceeds max copies /, / is not a valid land color /];
        verdict.errors.forEach(error => {
            let m = /^Deck can contain at most (\d+) lands \(currently (\d+)\)/.exec(error);
            if (m) {
                const excess = Number(m[2]) - Number(m[1]);
                issues.push({ kind: 'too-many-lands', text: `Too many lands: ${m[2]} (at most ${m[1]}). Remove ${plural(excess, 'land')}.`,
                    action: { label: `Remove ${plural(excess, 'land')}`, run: () => removeLandsFromWorkingDeck(excess) } });
                return;
            }
            m = /can contain at most (\d+) (\w+) lands \(currently (\d+)\)/.exec(error);
            // A one-colour deck's colour cap is its land cap, already listed as "too many lands"
            if (m && deckColors.length === 1) return;
            if (m) {
                const excess = Number(m[3]) - Number(m[1]);
                const name = ELEMENT_LABELS[m[2]] || m[2];
                issues.push({ kind: 'too-many-colour-lands', text: `Too many ${name} lands: ${m[3]} (at most ${m[1]}). Remove ${excess}.`,
                    action: { label: `Remove ${plural(excess, `${name} land`)}`, run: () => removeLandsFromWorkingDeck(excess, m[2]) } });
                return;
            }
            if (!covered.some(re => re.test(error))) issues.push({ kind: 'other', text: error });
        });
        return issues;
    }

    function renderDeckBuilderListRows(container, rows, emptyText) {
        if (!container) return;
        container.innerHTML = '';
        if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'deck-builder-empty';
            empty.textContent = emptyText;
            container.appendChild(empty);
            return;
        }
        rows.forEach(row => container.appendChild(row));
    }

    function updateDeckBuilderStatus(deck) {
        const status = document.getElementById('deckBuilderStatus');
        if (!status) return;
        const targetSize = getDeckTargetSize(deck);
        const current = deckBuilderState.workingCardIds.length;
        const ready = current === targetSize;
        const baseMessage = `Deck size: ${current}/${targetSize}${ready ? ' ✅ Ready to save' : ' ❗ Must be exact to save'}`;
        if (Array.isArray(deckBuilderState.validationErrors) && deckBuilderState.validationErrors.length > 0) {
            status.textContent = `${baseMessage} | Not saved: ${deckBuilderState.validationErrors.join(' ')}`;
            return;
        }
        if (deckBuilderState.debugWarning) {
            status.textContent = `${baseMessage} | ${deckBuilderState.debugWarning}`;
            return;
        }
        status.textContent = baseMessage;
    }

    // Cards out of the deck size, type counts and a mana curve, all from the working deck
    function renderDeckBuilderSummary(deck) {
        const panel = document.getElementById('deckBuilderSummary');
        if (!panel) return;
        const cards = deckBuilderState.workingCardIds.map(id => __CARD_BY_ID[id]).filter(Boolean);
        const target = getDeckTargetSize(deck);
        const count = type => cards.filter(card => card.type === type).length;
        const caps = getDeckLandCaps(Array.isArray(deck?.colors) ? deck.colors : getDeckColorsFromKey(deckBuilderState.deckKey));
        const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, '6+': 0 };
        cards.filter(card => card.type !== 'land').forEach(card => {
            const mv = getCardManaValue(card);
            curve[mv >= 6 ? '6+' : mv] += 1;
        });
        const peak = Math.max(1, ...Object.values(curve));
        const stat = (key, n, label) => `<div class="deck-stat"><strong data-count="${key}">${n}</strong> ${label}</div>`;
        const size = cards.length;
        panel.innerHTML = `
            <div class="deck-stats">
                <div class="deck-stat deck-stat-size${size === target ? ' is-complete' : ''}"><strong data-count="cards">${size}</strong> <span>/ ${target} cards</span></div>
                ${stat('lands', count('land'), `lands <span class="deck-stat-cap">(max ${caps.maxLands})</span>`)}
                ${stat('creatures', count('creature'), 'creatures')}
                ${stat('spells', count('instant'), 'spells')}
                ${stat('artifacts', count('artifact'), 'artifacts')}
            </div>
            <figure class="mana-curve-figure">
            <figcaption class="mana-curve-caption">Mana curve (non-land cards)</figcaption>
            <div class="mana-curve" role="img" aria-label="Mana curve of non-land cards: ${Object.entries(curve).map(([cost, n]) => `cost ${cost}: ${n}`).join(', ')}">
                ${Object.entries(curve).map(([cost, n]) => `
                    <div class="mana-curve-bar" data-cost="${cost}" data-count="${n}">
                        <span class="mana-curve-n">${n}</span>
                        <span class="mana-curve-fill" style="height:${Math.round((n / peak) * 100)}%"></span>
                        <span class="mana-curve-cost">${cost}</span>
                    </div>`).join('')}
            </div>
            </figure>`;
    }

    function renderDeckIssues() {
        const container = document.getElementById('deckBuilderIssues');
        if (!container) return;
        const issues = getDeckIssues(deckBuilderState.deckKey, deckBuilderState.workingCardIds);
        container.innerHTML = '';
        container.classList.toggle('has-issues', issues.length > 0);
        issues.forEach(issue => {
            const item = document.createElement('div');
            item.className = 'deck-issue';
            item.dataset.issue = issue.kind;
            const text = document.createElement('span');
            text.className = 'deck-issue-text';
            text.textContent = issue.text;
            item.appendChild(text);
            if (issue.action) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'deck-issue-action';
                button.textContent = issue.action.label;
                button.addEventListener('click', () => {
                    issue.action.run();
                    deckBuilderState.validationErrors = [];
                    deckBuilderState.debugWarning = '';
                    renderDeckBuilder();
                });
                item.appendChild(button);
            }
            container.appendChild(item);
        });
    }

    function createDeckBuilderRow(card, { button, count, reason }) {
        const row = document.createElement('div');
        row.className = 'deck-builder-row';
        row.dataset.cardId = card.__id;
        row.appendChild(button);
        const body = document.createElement('div');
        body.className = 'deck-builder-card';
        const name = document.createElement('div');
        name.className = 'deck-builder-name';
        name.appendChild(createCardRowArt(card));
        name.appendChild(document.createTextNode(` ${card.name}`));
        body.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'deck-builder-meta';
        meta.innerHTML = renderCardRowMeta(card);
        body.appendChild(meta);
        if (reason) {
            const why = document.createElement('div');
            why.className = 'deck-builder-reason';
            why.id = `reason-${card.__id}`;
            why.textContent = reason.text;
            body.appendChild(why);
            button.setAttribute('aria-describedby', why.id);
        }
        row.appendChild(body);
        const countEl = document.createElement('div');
        countEl.className = 'deck-builder-count';
        countEl.innerHTML = count;
        row.appendChild(countEl);
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'deck-builder-info-btn';
        info.textContent = 'ⓘ';
        info.setAttribute('aria-label', `Rules for ${card.name}`);
        info.addEventListener('click', e => cardInteraction(() => showCardDetail(card), e.isTrusted));
        row.appendChild(info);
        return row;
    }

    function renderDeckBuilder() {
        const poolContainer = document.getElementById('deckBuilderPool');
        const deckContainer = document.getElementById('deckBuilderDeck');
        const saveBtn = document.querySelector('#deckBuilderScreen button[onclick="saveDeckBuilderDeck()"]');
        if (!poolContainer || !deckContainer) return;

        const { deck, counts, eligibleCardIds } = getDeckBuilderDeckEntries(deckBuilderState.deckKey);
        if (!deck) return;
        const savedFocus = captureDeckBuilderFocus();

        const targetSize = getDeckTargetSize(deck);
        const ownedOf = card => gameMeta.collection[card.__id] || 0;
        buildCardFilterBar('deckBuilderFilters', renderDeckBuilder);
        const filters = cardFilterState.deckBuilderFilters;
        const eligible = eligibleCardIds.map(id => __CARD_BY_ID[id]);
        const shown = sortCardsForList(eligible.filter(card => cardMatchesFilters(card, filters, ownedOf(card))), filters.sort, ownedOf);
        const showingEl = document.getElementById('deckBuilderShowing');
        if (showingEl) showingEl.textContent = `Showing ${shown.length} of ${eligible.length} legal cards`;

        const poolRows = shown.map(card => {
            const cardId = card.__id;
            const owned = ownedOf(card);
            const inDeck = counts[cardId] || 0;
            const reason = getAddBlockReason(card, inDeck, owned, deckBuilderState.workingCardIds.length, targetSize);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'deck-builder-add';
            btn.textContent = '+';
            btn.setAttribute('aria-label', `Add ${card.name}`);
            if (reason) {
                // Not the disabled attribute: a blocked button still explains itself when pressed
                btn.setAttribute('aria-disabled', 'true');
                btn.dataset.reason = reason.code;
                btn.title = reason.text;
            }
            btn.addEventListener('click', () => {
                const blocked = getAddBlockReason(card, counts[cardId] || 0, owned, deckBuilderState.workingCardIds.length, targetSize);
                if (blocked) {
                    deckBuilderState.debugWarning = blocked.code === 'no-copies'
                        ? `Cannot add ${card.name}: no owned copies remaining (${owned} owned).`
                        : `Cannot add ${card.name}: ${blocked.text.charAt(0).toLowerCase()}${blocked.text.slice(1)}.`;
                    updateDeckBuilderStatus(deck);
                    return;
                }
                deckBuilderState.debugWarning = '';
                deckBuilderState.validationErrors = [];
                deckBuilderState.workingCardIds.push(cardId);
                renderDeckBuilder();
            });
            const row = createDeckBuilderRow(card, {
                button: btn,
                reason,
                count: `<span>In deck <b>${inDeck}</b></span><span>Owned <b>${owned}</b></span>`
            });
            row.classList.toggle('is-blocked', !!reason);
            row.classList.toggle('is-unowned', owned === 0);
            return row;
        });

        // The deck list, grouped by type, cheapest first within each group
        const deckRows = [];
        CARD_TYPE_ORDER.forEach(type => {
            const ids = Object.keys(counts)
                .filter(id => (__CARD_BY_ID[id]?.type || 'unknown') === type)
                .sort((a, b) => getCardManaValue(__CARD_BY_ID[a]) - getCardManaValue(__CARD_BY_ID[b]) || __CARD_BY_ID[a].name.localeCompare(__CARD_BY_ID[b].name));
            if (!ids.length) return;
            const title = document.createElement('div');
            title.className = 'deck-group-title';
            const copies = ids.reduce((sum, id) => sum + counts[id], 0);
            title.textContent = `${CARD_TYPE_INFO[type].icon} ${type === 'instant' ? 'Spells' : `${CARD_TYPE_INFO[type].label}s`} · ${copies}`;
            deckRows.push(title);
            ids.forEach(cardId => {
                const card = __CARD_BY_ID[cardId];
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'deck-builder-remove';
                btn.textContent = '−';
                btn.setAttribute('aria-label', `Remove one ${card.name}`);
                btn.addEventListener('click', () => {
                    removeFromWorkingDeck(cardId, 1);
                    deckBuilderState.validationErrors = [];
                    deckBuilderState.debugWarning = '';
                    renderDeckBuilder();
                });
                deckRows.push(createDeckBuilderRow(card, { button: btn, count: `x${counts[cardId]}` }));
            });
        });

        renderDeckBuilderListRows(poolContainer, poolRows, filters.owned === 'owned' && !eligible.some(card => ownedOf(card) > 0)
            ? 'No owned cards are legal for this deck.' : 'No cards match these filters.');
        renderDeckBuilderListRows(deckContainer, deckRows, 'Deck is empty.');

        if (saveBtn) {
            saveBtn.disabled = deckBuilderState.workingCardIds.length !== targetSize;
        }
        const unsaved = document.getElementById('deckBuilderUnsaved');
        if (unsaved) unsaved.style.display = isDeckBuilderDirty() ? '' : 'none';
        renderDeckBuilderSummary(deck);
        renderDeckIssues();
        updateDeckBuilderStatus(deck);
        restoreDeckBuilderFocus(savedFocus);
    }

    // + and − rebuild both lists, which dropped keyboard focus to the page. Keep it on the same card's button,
    // or on the row that took its place when the card left the list.
    function captureDeckBuilderFocus() {
        const active = document.activeElement;
        const row = active?.closest?.('#deckBuilderPool .deck-builder-row, #deckBuilderDeck .deck-builder-row');
        if (!row) return null;
        const rows = [...row.parentElement.querySelectorAll('.deck-builder-row')];
        return { listId: row.parentElement.id, cardId: row.dataset.cardId, index: rows.indexOf(row), button: [...row.querySelectorAll('button')].indexOf(active) };
    }

    function restoreDeckBuilderFocus(saved) {
        if (!saved) return;
        const rows = [...(document.getElementById(saved.listId)?.querySelectorAll('.deck-builder-row') || [])];
        const row = rows.find(r => r.dataset.cardId === saved.cardId) || rows[Math.min(saved.index, rows.length - 1)];
        const target = row?.querySelectorAll('button')[Math.max(saved.button, 0)] || document.querySelector('#deckBuilderFilters .card-filter-search');
        target?.focus({ preventScroll: true });
    }

    function loadDeckIntoBuilder(deckKey) {
        const select = document.getElementById('deckBuilderDeckKey');
        if (select) select.value = deckKey;
        deckBuilderState.deckKey = deckKey;
        deckBuilderState.workingCardIds = [...(gameMeta.decks?.[deckKey]?.cardIds || [])];
        deckBuilderState.debugWarning = '';
        deckBuilderState.validationErrors = [];
        renderDeckBuilder();
    }

    function initializeDeckBuilder() {
        const select = document.getElementById('deckBuilderDeckKey');
        if (!select) return;

        const deckKeys = Object.keys(gameMeta.decks || {}).sort();
        const preferredDeckKey = deckBuilderState.deckKey && gameMeta.decks[deckBuilderState.deckKey]
            ? deckBuilderState.deckKey
            : (gameMeta.selectedDeckKey && gameMeta.decks[gameMeta.selectedDeckKey] ? gameMeta.selectedDeckKey : deckKeys[0]);

        select.innerHTML = '';
        deckKeys.forEach(deckKey => {
            const option = document.createElement('option');
            option.value = deckKey;
            option.textContent = deckDisplayName(deckKey);
            option.selected = deckKey === preferredDeckKey;
            select.appendChild(option);
        });

        // Switching decks with unsaved edits asks first; until then the selector stays on the edited deck
        select.onchange = (event) => {
            const deckKey = event.target.value;
            if (isDeckBuilderDirty()) {
                select.value = deckBuilderState.deckKey;
                confirmDiscardDeckEdits(() => loadDeckIntoBuilder(deckKey));
                return;
            }
            loadDeckIntoBuilder(deckKey);
        };

        loadDeckIntoBuilder(preferredDeckKey || null);
    }

    function resetDeckBuilderDeck() {
        const deckKey = deckBuilderState.deckKey;
        const deck = gameMeta.decks?.[deckKey];
        if (!deck) return;
        playSFX('menuClose');
        deckBuilderState.workingCardIds = [...(deck.starterCardIds || [])];
        deckBuilderState.debugWarning = '';
        deckBuilderState.validationErrors = [];
        renderDeckBuilder();
    }

    function saveDeckBuilderDeck() {
        const deckKey = deckBuilderState.deckKey;
        const deck = gameMeta.decks?.[deckKey];
        if (!deck) return;

        const candidate = [...(deckBuilderState.workingCardIds || [])];
        const validation = validateDeckBuild(deckKey, candidate, gameMeta);

        if (!validation.ok) {
            const targetSize = getDeckTargetSize(deck);
            if (QA_DEBUG) deckBuilderState.debugWarning = `Save blocked: ${validation.errors.join(' | ')}`;
            deckBuilderState.validationErrors = validation.errors;
            showGameLog(validation.errors[0] || `Deck must contain exactly ${targetSize} cards to save.`, true);
            renderDeckBuilder();
            return;
        }

        const previous = gameMeta.decks[deckKey].cardIds;
        gameMeta.decks[deckKey].cardIds = [...candidate];
        if (!metaSave(gameMeta)) { gameMeta.decks[deckKey].cardIds = previous; return; }
        playSFX('select');
        showGameLog(`Saved deck ${deckKey}.`, false);
        reportAchievement('deck:saved', { deckKey });
        deckBuilderState.workingCardIds = [...candidate];
        deckBuilderState.debugWarning = '';
        deckBuilderState.validationErrors = [];
        renderDeckBuilder();
    }

    function backToMenu() {
        // Leaving the Deck Builder with unsaved edits asks first
        if (currentMenuScreen === 'deckBuilderScreen' && isDeckBuilderDirty()) {
            confirmDiscardDeckEdits(() => {
                deckBuilderState.workingCardIds = [...(gameMeta.decks?.[deckBuilderState.deckKey]?.cardIds || [])];
                backToMenu();
            });
            return;
        }
        playSFX('menuClose');
        closeDeckBuilderGuide();
        setStartMenuScreen('mainMenu');
        focusSafeElement();
    }

    // The menu screen that was open last, so BACK/Esc can return focus to the entry that opened it
    let menuReturnTarget = null;
    let currentMenuScreen = 'mainMenu';

    function setStartMenuScreen(activeScreenId = 'mainMenu') {
        const menuScreens = ['mainMenu', 'elementSelectionScreen', 'howToPlayScreen', 'statsScreen', 'achievementsScreen', 'deckBuilderScreen', 'packShopScreen', 'binderScreen'];
        if (activeScreenId === 'mainMenu' && currentMenuScreen !== 'mainMenu') menuReturnTarget = currentMenuScreen;
        currentMenuScreen = activeScreenId;
        menuScreens.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            if (id === activeScreenId) {
                // mainMenu needs 'flex' to preserve the column layout from .menu-buttons
                element.style.display = id === 'mainMenu' ? 'flex' : 'block';
            } else {
                element.style.display = 'none';
            }
        });
        // Scroll modal content to top when switching screens; data-screen lets the panel size itself per screen
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) {
            modalContent.scrollTop = 0;
            modalContent.dataset.screen = activeScreenId;
        }
        if (activeScreenId === 'mainMenu') {
            updateMenuStatus();
        } else {
            // Move focus to the new screen's heading so keyboard and screen-reader users start there
            document.getElementById(activeScreenId)?.querySelector('.modal-subtitle[tabindex="-1"]')?.focus({ preventScroll: true });
        }
    }

    // Credits, collection progress and record on the main menu, from the saved profile
    function updateMenuStatus() {
        const credits = Number.isFinite(gameMeta?.wallet?.credits) ? Math.floor(gameMeta.wallet.credits) : 0;
        const owned = Object.entries(gameMeta?.collection || {}).filter(([cardId, count]) => __CARD_BY_ID[cardId] && count > 0).length;
        const total = Object.keys(__CARD_BY_ID).length;
        const creditsEl = document.getElementById('menuCredits');
        const collectionEl = document.getElementById('menuCollection');
        const meterEl = document.getElementById('menuCollectionMeter');
        const recordEl = document.getElementById('menuRecord');
        if (creditsEl) creditsEl.textContent = credits;
        if (collectionEl) collectionEl.textContent = `${owned} / ${total}`;
        if (meterEl) meterEl.style.width = `${total ? Math.round((owned / total) * 100) : 0}%`;
        if (recordEl) {
            const wins = Math.max(0, Number(gameStats.wins) || 0);
            const losses = Math.max(0, Number(gameStats.losses) || 0);
            recordEl.textContent = wins + losses > 0 ? `${wins} won · ${losses} lost` : 'No battles yet';
        }
        const achievementsEl = document.getElementById('menuAchievements');
        if (achievementsEl && window.Achievements) achievementsEl.textContent = achievementsSummary();
        // NEW GAME names the deck it will start from, once you have played at least once
        const newGameDesc = document.getElementById('menuNewGameDesc');
        if (newGameDesc) {
            const played = (Number(gameStats.wins) || 0) + (Number(gameStats.losses) || 0) > 0;
            const colors = played && gameMeta?.decks?.[gameMeta?.selectedDeckKey] ? getDeckColorsFromKey(gameMeta.selectedDeckKey) : [];
            newGameDesc.textContent = colors.length
                ? `Last deck: ${colors.map(elementLabel).join(' + ')}`
                : 'Pick your elements and duel the AI';
        }
    }

    // ---- Achievements: the menu screen and the pause dialog draw the same view (renderAchievements)
    let achievementFilter = 'all';

    function escapeAchievementText(text) {
        return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    function renderAchievements(root) {
        if (!root || !window.Achievements) return;
        const all = Achievements.catalog;
        const unlockedTotal = Achievements.unlockedCount();
        const filters = [['all', 'All', '🏆'], ['unlocked', 'Unlocked', '✅'], ...Achievements.categories];
        const inFilter = a => achievementFilter === 'all' ? true
            : achievementFilter === 'unlocked' ? Achievements.isUnlocked(a.id) : a.cat === achievementFilter;
        const shown = all.filter(inFilter);
        const countIn = key => {
            const list = key === 'all' ? all : key === 'unlocked' ? all.filter(a => Achievements.isUnlocked(a.id)) : all.filter(a => a.cat === key);
            return key === 'unlocked' ? `${list.length}` : `${list.filter(a => Achievements.isUnlocked(a.id)).length}/${list.length}`;
        };
        const date = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
        const tierLabel = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

        root.innerHTML = `
            ${Achievements.persisting ? '' : '<p class="ach-qa-note">QA session or newer save format: achievements here are not saved.</p>'}
            <div class="ach-summary">
                <div class="ach-count"><strong>${unlockedTotal}</strong> of ${all.length} unlocked</div>
                <div class="ach-meter" aria-hidden="true"><span style="width:${Math.round(unlockedTotal / all.length * 100)}%"></span></div>
                <button type="button" class="ach-notify" role="switch" aria-checked="${Achievements.notify}">
                    <span>Unlock sound &amp; buzz</span><span class="pause-switch" aria-hidden="true"></span>
                </button>
            </div>
            <div class="ach-filters" role="group" aria-label="Show achievements">
                ${filters.map(([key, label, icon]) => `<button type="button" class="ach-filter" data-filter="${key}" aria-pressed="${achievementFilter === key}">
                    <span aria-hidden="true">${icon}</span> ${escapeAchievementText(label)} <span class="ach-filter-count">${countIn(key)}</span></button>`).join('')}
            </div>
            <ul class="ach-list" tabindex="0" aria-label="${escapeAchievementText(filters.find(f => f[0] === achievementFilter)?.[1] || 'All')} achievements">
                ${shown.map(a => {
                    const unlocked = Achievements.isUnlocked(a.id);
                    const secret = a.hidden && !unlocked;
                    const progress = !unlocked && a.goal ? Achievements.progressOf(a) : null;
                    const at = unlocked ? Achievements.unlockedAt(a.id) : null;
                    return `<li class="ach-item tier-${a.tier}" data-state="${unlocked ? 'unlocked' : secret ? 'secret' : 'locked'}" data-id="${a.id}">
                        <span class="ach-icon" aria-hidden="true">${secret ? '❔' : a.icon}</span>
                        <span class="ach-body">
                            <span class="ach-name">${secret ? 'Hidden achievement' : escapeAchievementText(a.name)}</span>
                            <span class="ach-desc">${secret ? 'Keep playing to find this one.' : escapeAchievementText(a.desc)}</span>
                            <span class="ach-meta">
                                <span class="ach-tier">${tierLabel[a.tier]}</span>
                                ${unlocked ? `<span class="ach-when">✓ ${Achievements.wasBackfilled(a.id) ? 'From your saved progress' : `Unlocked${at && !at.startsWith('1970') ? ` ${date(at)}` : ''}`}</span>` : '<span class="ach-when">🔒 Locked</span>'}
                                ${progress ? `<span class="ach-progress" role="img" aria-label="${progress.value} of ${progress.goal}"><span class="ach-bar"><span style="width:${Math.round(progress.value / progress.goal * 100)}%"></span></span>${progress.value} / ${progress.goal}</span>` : ''}
                            </span>
                        </span>
                    </li>`;
                }).join('')}
            </ul>`;

        root.querySelector('.ach-notify').addEventListener('click', () => {
            Achievements.setNotify(!Achievements.notify);
            renderAchievements(root);
            root.querySelector('.ach-notify')?.focus();
        });
        root.querySelectorAll('.ach-filter').forEach(button => button.addEventListener('click', () => {
            achievementFilter = button.dataset.filter;
            playSFX('select');
            renderAchievements(root);
            root.querySelector(`.ach-filter[data-filter="${achievementFilter}"]`)?.focus();
        }));
    }

    function showAchievements() {
        playSFX('menuOpen');
        setStartMenuScreen('achievementsScreen');
        renderAchievements(document.getElementById('achievementsMenuView'));
    }

    function showAchievementsDialog() {
        holdAchievementNotice();
        renderAchievements(document.getElementById('achievementsDialogView'));
        playSFX('menuOpen');
        document.getElementById('achievementsDialog').classList.add('show');
    }

    function hideAchievementsDialog() {
        playSFX('menuClose');
        document.getElementById('achievementsDialog').classList.remove('show');
        updatePausePanel();
    }

    function achievementsSummary() {
        return window.Achievements ? `${Achievements.unlockedCount()} of ${Achievements.catalog.length} unlocked` : '';
    }

    // ---- Unlock notices: queued, one at a time (3.2 s), at the top of the screen, never over the match controls.
    // Each is { icon, name, label?, quiet? }: quiet notices make no sound or buzz.
    const achievementNoticeQueue = [];
    let achievementNoticeShowing = false;

    function queueAchievementNotice(notice) {
        achievementNoticeQueue.push(notice);
        if (!achievementNoticeShowing) showNextAchievementNotice();
        else updateAchievementNoticeCount();
    }

    function achievementNoticeLabel(notice) {
        const more = achievementNoticeQueue.length;
        return `${notice.label || 'Achievement unlocked'}${more ? ` · ${more} more` : ''}`;
    }

    // Unlocks that arrive while a notice shows (a win often brings several) are counted on it at once
    let currentAchievementNotice = null;
    function updateAchievementNoticeCount() {
        const label = document.querySelector('#achievementToast:not([hidden]) .ach-toast-label');
        if (label && currentAchievementNotice) label.textContent = achievementNoticeLabel(currentAchievementNotice);
    }

    // PAUSE, this list and a pack reveal take the notice on screen down at once (it would cover their headings); it
    // comes back, without its sound again, once they close
    let achievementNoticeTimer = null;
    function holdAchievementNotice() {
        const toast = document.getElementById('achievementToast');
        if (!toast || toast.hidden || !currentAchievementNotice) return;
        clearTimeout(achievementNoticeTimer);
        toast.hidden = true;
        achievementNoticeQueue.unshift({ ...currentAchievementNotice, quiet: true });
        currentAchievementNotice = null;
        setTimeout(showNextAchievementNotice, 600);
    }

    function titleScreenShowing() {
        const shown = id => {
            const el = document.getElementById(id);
            return !!el && getComputedStyle(el).display !== 'none';
        };
        return shown('clickToStart') || shown('introContainer');
    }

    function showNextAchievementNotice() {
        const toast = document.getElementById('achievementToast');
        if (!toast || !achievementNoticeQueue.length) {
            achievementNoticeShowing = false;
            return;
        }
        achievementNoticeShowing = true;
        // Wait while paused (the board is frozen), while this list is open, while a pack is being revealed (a
        // notice could spoil the cards) and while the page is hidden. Over anything else the notice sits at the top
        // and lets clicks through.
        const blocking = getOpenGameDialog()?.id;
        if (document.hidden || gamePaused || titleScreenShowing() || ['pauseModal', 'achievementsDialog', 'packOpeningOverlay'].includes(blocking)) {
            setTimeout(showNextAchievementNotice, 600);
            return;
        }
        const notice = achievementNoticeQueue.shift();
        currentAchievementNotice = notice;
        toast.innerHTML = `<span class="ach-toast-icon" aria-hidden="true">${notice.icon}</span>
            <span class="ach-toast-text"><span class="ach-toast-label">${escapeAchievementText(achievementNoticeLabel(notice))}</span>
            <span class="ach-toast-name">${escapeAchievementText(notice.name)}</span></span>`;
        toast.hidden = false;
        if (Achievements.notify && !notice.quiet) {
            GameFeedback.play('achievement');
            haptic('achievement');
        }
        achievementNoticeTimer = setTimeout(() => {
            toast.hidden = true;
            currentAchievementNotice = null;
            setTimeout(showNextAchievementNotice, 250);
        }, 3200);
    }

    if (window.Achievements) {
        Achievements.onUnlock((def, { backfilled }) => {
            if (!backfilled) queueAchievementNotice({ icon: def.icon, name: def.name });
            const label = document.getElementById('menuAchievements');
            if (label) label.textContent = achievementsSummary();
        });
    }

    // A profile that already proved some achievements gets one quiet notice instead of one for each (queued once
    // this script has finished loading: the dialog list it checks is defined further down)
    profileReady.then(() => {
    if (achievementsRecognised.length) {
        setTimeout(() => queueAchievementNotice({
            icon: '🏆', quiet: true, label: 'Recognised from your saved progress',
            name: `${achievementsRecognised.length} achievement${achievementsRecognised.length === 1 ? '' : 's'}`
        }), 0);
    }

    });

    // Visual themes: colours, type and backgrounds only (styles.css "VISUAL THEMES"). Saved under its own key,
    // apart from the profile, so a progress reset keeps it and switching theme never touches the save.
    const THEME_STORAGE_KEY = 'emoji_elements_theme';
    const VISUAL_THEMES = {
        arcane: { label: 'Arcane Fantasy', desc: 'Violet ink, gold leaf and runes', metaColor: '#140b1f' },
        'deep-space': { label: 'Deep Space', desc: 'Midnight navy, starlight and ice blue', metaColor: '#060a16' },
        neon: { label: 'Neon Sci-Fi', desc: 'Black glass, cyan and magenta', metaColor: '#07060c' }
    };

    function getVisualTheme() {
        const key = document.documentElement.dataset.theme;
        return VISUAL_THEMES[key] ? key : 'arcane';
    }

    function applyVisualTheme(key, { save = true, track = false } = {}) {
        if (!VISUAL_THEMES[key]) key = 'arcane';
        document.documentElement.dataset.theme = key;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', VISUAL_THEMES[key].metaColor);
        const chipName = document.getElementById('themeChipName');
        if (chipName) chipName.textContent = VISUAL_THEMES[key].label;
        const pauseName = document.getElementById('pauseThemeName');
        if (pauseName) pauseName.textContent = VISUAL_THEMES[key].label;
        document.querySelectorAll('#themeOptions [role="radio"]').forEach(option => {
            const checked = option.dataset.uiTheme === key;
            option.setAttribute('aria-checked', String(checked));
            option.tabIndex = checked ? 0 : -1;
        });
        if (save) {
            try { localStorage.setItem(THEME_STORAGE_KEY, key); } catch (_) { /* private mode: the theme lasts this visit */ }
            if (track) reportAchievement('theme', { theme: key });
        }
    }

    function renderThemePicker() {
        const list = document.getElementById('themeOptions');
        if (!list || list.childElementCount) return;
        Object.entries(VISUAL_THEMES).forEach(([key, theme]) => {
            const option = document.createElement('button');
            option.type = 'button';
            // Each option is drawn in its own theme's tokens, so it is its own preview
            option.className = 'theme-option';
            option.setAttribute('role', 'radio');
            option.dataset.uiTheme = key;
            option.innerHTML = `
                <span class="theme-option-preview" aria-hidden="true">
                    <span class="theme-option-mark"><svg focusable="false"><use href="#ee-sigil"/></svg></span>
                    <span class="theme-option-swatches"><i></i><i></i><i></i></span>
                </span>
                <span class="theme-option-body">
                    <span class="theme-option-label">${theme.label}</span>
                    <span class="theme-option-desc">${theme.desc}</span>
                </span>`;
            option.addEventListener('click', e => { playSFX('select'); applyVisualTheme(key, { track: e.isTrusted }); });
            list.appendChild(option);
        });
        // Arrow keys move between themes and pick them (radio group pattern)
        list.addEventListener('keydown', e => {
            const keys = Object.keys(VISUAL_THEMES);
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            let next;
            if (step) next = keys[(keys.indexOf(getVisualTheme()) + step + keys.length) % keys.length];
            else if (e.key === 'Home') next = keys[0];
            else if (e.key === 'End') next = keys[keys.length - 1];
            if (!next) return;
            e.preventDefault();
            applyVisualTheme(next, { track: e.isTrusted });
            list.querySelector(`[data-ui-theme="${next}"]`)?.focus();
        });
        applyVisualTheme(getVisualTheme(), { save: false });
    }

    function showThemePicker() {
        renderThemePicker();
        playSFX('menuOpen');
        document.getElementById('themeDialog').classList.add('show');
        // Focus starts on the current theme rather than the close button, scrolled into view on short screens
        setTimeout(() => {
            const current = document.querySelector('#themeOptions [aria-checked="true"]');
            current?.focus({ preventScroll: true });
            current?.scrollIntoView({ block: 'nearest' });
        }, 60);
    }

    function hideThemePicker() {
        playSFX('menuClose');
        document.getElementById('themeDialog').classList.remove('show');
    }

    document.getElementById('achievementsDialog')?.addEventListener('click', function(e) {
        if (e.target === this) hideAchievementsDialog();
    });

    document.getElementById('soundDialog')?.addEventListener('click', function(e) {
        if (e.target === this) hideSoundSettings();
    });

    document.getElementById('themeDialog')?.addEventListener('click', function(e) {
        if (e.target === this) hideThemePicker();
    });
    applyVisualTheme(getVisualTheme(), { save: false });

    function initializeStartMenuState() {
        setStartMenuScreen('mainMenu');
        resetElementSelection();
        updateStatsDisplay();
    }

    function getRequiredElementCount() {
        return gameState.deckMode === 'single' ? 1 : 2;
    }

    function updateStartButtonState() {
        const startBtn = document.getElementById('startBtn');
        if (!startBtn) return;

        const required = getRequiredElementCount();
        if (gameState.selectedElements.length === required) {
            startBtn.disabled = false;
            startBtn.textContent = '⚔️ START BATTLE ⚔️';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = required === 1 ? 'Select 1 Element' : 'Select 2 Elements';
        }
        updateElementPickHint();
        renderDeckSummary();
    }

    // Deck-type and element buttons follow gameState (selected class, aria-pressed, "full" state)
    function syncElementSelectionUI() {
        document.querySelectorAll('.deck-mode-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.deckMode === gameState.deckMode);
            btn.setAttribute('aria-pressed', String(btn.dataset.deckMode === gameState.deckMode));
        });

        document.querySelectorAll('.element-btn').forEach(btn => {
            const selected = gameState.selectedElements.includes(btn.dataset.element);
            btn.classList.toggle('selected', selected);
            btn.setAttribute('aria-pressed', String(selected));
        });

        const selector = document.getElementById('elementSelector');
        if (selector) {
            // Two-colour deck with both picked: the others are dimmed until one is removed
            const full = gameState.deckMode === 'dual' && gameState.selectedElements.length >= 2;
            selector.classList.toggle('is-full', full);
        }

        updateStartButtonState();
    }

    function updateElementPickHint() {
        const hint = document.getElementById('elementPickHint');
        if (!hint) return;
        const picked = gameState.selectedElements.map(e => ELEMENT_LABELS[e]);
        if (gameState.deckMode === 'single') {
            hint.textContent = picked.length ? `${picked[0]} deck · tap another element to switch` : 'Choose 1 element';
        } else if (picked.length === 0) {
            hint.textContent = 'Choose 2 elements';
        } else if (picked.length === 1) {
            hint.textContent = `${picked[0]} chosen · choose 1 more`;
        } else {
            hint.textContent = `${picked.join(' + ')} · tap a chosen element to change it`;
        }
    }

    // What the saved deck for these elements holds: the deck START BATTLE will use (createPlayerDeck)
    function getDeckSummary(deckKey) {
        const deck = gameMeta?.decks?.[deckKey];
        const cardIds = Array.isArray(deck?.cardIds) ? deck.cardIds : [];
        if (!isMetaRuntimeEnabled() || cardIds.length === 0 || !cardIds.every(id => __CARD_BY_ID[id])) return null;
        const cards = cardIds.map(id => __CARD_BY_ID[id]);
        const counts = { land: 0, creature: 0, instant: 0, artifact: 0 };
        cards.forEach(card => { counts[card.type] = (counts[card.type] || 0) + 1; });
        const manaValue = card => Object.values(card.cost || {}).reduce((sum, n) => sum + n, 0);
        const nonLands = cards.filter(card => card.type !== 'land');
        const averageCost = nonLands.length ? nonLands.reduce((sum, card) => sum + manaValue(card), 0) / nonLands.length : 0;
        const rarityRank = { legendary: 3, epic: 2, rare: 1 };
        const seen = new Set();
        const keyCards = nonLands
            .filter(card => !seen.has(card.__id) && seen.add(card.__id))
            .sort((a, b) => (rarityRank[b.__rarity] || 0) - (rarityRank[a.__rarity] || 0) || manaValue(b) - manaValue(a) || a.name.localeCompare(b.name))
            .slice(0, 3);
        const starter = Array.isArray(deck.starterCardIds) ? deck.starterCardIds : [];
        const customized = starter.length > 0 && !sameCardMultiset(cardIds, starter);
        return { size: cards.length, counts, averageCost, keyCards, customized };
    }

    function renderDeckSummary() {
        const container = document.getElementById('deckSummary');
        if (!container) return;
        const required = getRequiredElementCount();
        const picked = gameState.selectedElements;
        container.classList.toggle('is-empty', picked.length !== required);
        if (picked.length !== required) {
            const missing = required - picked.length;
            container.innerHTML = `<p class="deck-summary-placeholder">Choose ${missing} ${picked.length ? 'more ' : ''}element${missing === 1 ? '' : 's'} to see the deck you'll play.</p>`;
            return;
        }

        const deckKey = getDeckKeyFromElements(picked);
        const colors = getDeckColorsFromKey(deckKey);
        const accents = colors.map(color => `<span class="deck-summary-element" data-element="${color}">${elementLabel(color)}</span>`).join('<span class="deck-summary-plus" aria-hidden="true">+</span>');
        const summary = getDeckSummary(deckKey);
        if (!summary) {
            container.innerHTML = `<div class="deck-summary-head"><span class="deck-summary-name">${accents}</span></div>
                <p class="deck-summary-placeholder">No saved deck for these elements, so a ${STANDARD_DECK_SIZE}-card deck will be built for this match.</p>`;
            return;
        }

        const plural = (n, word) => `<li><strong>${n}</strong> ${n === 1 ? word : `${word}s`}</li>`;
        const keyCards = summary.keyCards.map(card => `<span class="deck-summary-card">${card.emoji} ${card.name}</span>`).join('');
        container.innerHTML = `
            <div class="deck-summary-head">
                <span class="deck-summary-name">${accents}</span>
                <span class="deck-summary-tag">${summary.customized ? 'Customized' : 'Starter list'}</span>
            </div>
            <ul class="deck-summary-counts">
                ${plural(summary.size, 'card')}${plural(summary.counts.land, 'land')}${plural(summary.counts.creature, 'creature')}${plural(summary.counts.instant, 'instant')}${plural(summary.counts.artifact, 'artifact')}
            </ul>
            <p class="deck-summary-line">Average cost of non-land cards: <strong>${summary.averageCost.toFixed(1)}</strong></p>
            ${keyCards ? `<div class="deck-summary-line deck-summary-keys"><span>Rarest cards:</span> ${keyCards}</div>` : ''}
            <p class="deck-summary-note">Your saved deck for these elements. Change it in Deck Builder.</p>`;
    }

    // NEW GAME starts from the deck you last took into battle (gameMeta.selectedDeckKey, saved by startGame)
    function restoreSavedDeckSelection() {
        if (!isMetaRuntimeEnabled()) return;
        const deckKey = gameMeta?.selectedDeckKey;
        if (!deckKey || !gameMeta?.decks?.[deckKey]) return;
        const colors = getDeckColorsFromKey(deckKey);
        if (colors.length < 1 || colors.length > 2) return;
        gameState.deckMode = colors.length === 1 ? 'single' : 'dual';
        gameState.selectedElements = [...colors];
        syncElementSelectionUI();
    }

    function setDeckMode(mode) {
        if (document.getElementById('gameContainer').style.display === 'flex' || isStartingGame) {
            return;
        }

        if (!['single', 'dual'].includes(mode)) {
            return;
        }

        playSFX('select');
        gameState.deckMode = mode;
        gameState.selectedElements = [];
        syncElementSelectionUI();
    }

    function resetElementSelection() {
        gameState.selectedElements = [];
        gameState.deckMode = 'dual';
        syncElementSelectionUI();
    }

    function returnToMainMenu() {
        cancelMatchWork();
        clearMatchPause();
        resetGameLog();
        stopBattleMusic();
        stopSFX('gameVictory');
        stopSFX('gameLose');

        const victoryOverlay = document.getElementById('victoryOverlay');
        const loseOverlay = document.getElementById('loseOverlay');
        const rewardOverlay = document.getElementById('matchRewardOverlay');
        victoryOverlay.classList.remove('show');
        loseOverlay.classList.remove('show');
        rewardOverlay?.classList.remove('show');
        pendingMatchResultOverlay = null;
        pendingMatchRewardSummary = null;

        document.getElementById('pauseModal').classList.remove('show');
        document.getElementById('graveyardModal').classList.remove('show');
        document.getElementById('mulliganConfirmModal').classList.remove('show');
        document.getElementById('gameConfirmModal').classList.remove('show');
        closePackOpeningOverlay();

        const gameContainer = document.getElementById('gameContainer');
        const startModal = document.getElementById('startModal');
        gameContainer.classList.remove('enemy-turn');
        gameContainer.style.display = 'none';
        startModal.style.display = 'flex';
        startModal.classList.add('modal-visible');

        // Reset processing lock and attack phase to clean state
        attackPhase = false;
        releaseProcessingLock();
        setAttackControls('idle');

        // Drop the left match's cards (and their listeners) from the hidden board; startGame rebuilds the rows.
        // A UI update already queued for the next frame would fill them again from the old match, so cancel it.
        if (uiUpdateRafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(uiUpdateRafId);
        uiUpdateRafId = 0;
        isUIUpdateScheduled = false;
        ['playerHand', 'playerBoard', 'enemyBoard'].forEach(id => { document.getElementById(id).innerHTML = ''; });

        initializeStartMenuState();

        // Resume menu music without restarting if it is already active
        ensureStartMenuMusic();
    }

    function playAgain() {
        returnToMainMenu();
        showElementSelection();
    }

    // Pause/Resume. Pausing stops the match where it is: the AI's turn, its failsafe, the action-lock failsafes and
    // the toasts wait (matchDelay), CSS animations on the board hold, and the board takes no input (inert). Resume
    // continues the same timers with the time they had left; the dialog code returns focus to where it was.
    function pauseGame() {
        const container = document.getElementById('gameContainer');
        if (container.style.display !== 'flex' || gamePaused) {
            return;
        }

        gamePaused = true;
        freezeMatchTimers();
        holdAchievementNotice();
        container.classList.add('is-paused');
        container.inert = true;
        document.getElementById('gameLog')?.classList.remove('show');
        // Effect particles are only decoration: drop them rather than draw them over the pause panel
        particles = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        BATTLE_TRACKS.forEach(name => {
            if (isAudioPlaying(audioSystem[name])) fadeAudio(audioSystem[name], () => musicTarget(audioSystem[name]), 250);
        });
        updatePausePanel();
        renderSoundSettings(document.querySelector('#pauseModal .pause-settings'), 'pause');
        playSFX('menuOpen');
        document.getElementById('pauseModal').classList.add('show');
    }

    function resumeGame(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const container = document.getElementById('gameContainer');
        // Safety fix: keep gameplay active after resuming from pause
        document.getElementById('startModal').style.display = 'none';
        container.style.display = 'flex';
        // The board takes input again before the dialog closes, so focus can return to it
        container.inert = false;
        container.classList.remove('is-paused');

        playSFX('menuClose');
        document.getElementById('pauseModal').classList.remove('show');
        if (gamePaused) {
            gamePaused = false;
            thawMatchTimers();
            BATTLE_TRACKS.forEach(name => {
                if (isAudioPlaying(audioSystem[name])) fadeAudio(audioSystem[name], () => musicTarget(audioSystem[name]), 250);
            });
            updateBattleMusicMood();
        }
    }

    // What the AI did, shown on the board: cards it put onto the battlefield since its turn began (marked NEW until
    // its next turn), and during its attack, its attackers and the creatures that blocked them automatically.
    let enemyTurnStartIds = null;
    let enemyCombatMarks = { attackers: new Set(), blockers: new Set() };

    function resetAiActivityMarks() {
        enemyTurnStartIds = null;
        enemyCombatMarks = { attackers: new Set(), blockers: new Set() };
    }

    function addBoardMarker(cardEl, className, text) {
        const marker = document.createElement('div');
        marker.className = `card-state ${className}`;
        marker.textContent = text;
        marker.setAttribute('aria-hidden', 'true');
        cardEl.appendChild(marker);
    }

    // Where the match stands, for the pause panel's subtitle, and the current settings
    function updatePausePanel() {
        const summary = document.getElementById('pauseSummary');
        if (summary) {
            const whose = gameState.turn === 'enemy' ? "Enemy's turn" : 'Your turn';
            summary.textContent = `Turn ${gameState.round || 1} · ${whose} · You ❤️ ${gameState.playerLife} · Enemy ❤️ ${gameState.enemyLife}`;
        }
        const achievementsNote = document.getElementById('pauseAchievementsNote');
        if (achievementsNote) achievementsNote.textContent = achievementsSummary();
        syncSoundSettings();
    }

    // One boundary for abandonment, replacement and completion, paused or running.
    function cancelMatchWork() {
        matchSerial++;
        matchTimers.forEach(timer => clearTimeout(timer.handle));
        matchTimers.clear();
        processingActionTimer = null;
        isProcessingAction = false;
        isStartingGame = false;
        particles = [];
        cancelAnimationFrame(particleRafId);
        particleRafId = 0;
        particleLoopRunning = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.querySelectorAll('.sparkle, .trample-effect').forEach(el => el.remove());
        document.getElementById('gameContainer').classList.remove('shake-board');
        document.querySelectorAll('.life-increase, .life-decrease, .juice-pop, .screen-shake, .shake').forEach(el =>
            el.classList.remove('life-increase', 'life-decrease', 'juice-pop', 'screen-shake', 'shake'));
        hideCardDetail();
    }

    function clearMatchPause() {
        const container = document.getElementById('gameContainer');
        container.inert = false;
        container.classList.remove('is-paused');
        if (gamePaused) {
            gamePaused = false;
            matchTimers.forEach(timer => clearTimeout(timer.handle));
            matchTimers.clear();
        }
    }

    // A match pauses itself when the page is hidden (another tab or app), so nothing happens unseen
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (!gameState.matchFinalized) pauseGame();
            Object.values(audioSystem).forEach(audio => {
                if (!audio.paused) {
                    backgroundPausedMusic.add(audio);
                    audio.pause();
                }
            });
        } else {
            for (const audio of backgroundPausedMusic) {
                const result = audio.play();
                result?.catch(error => console.debug('Music resume blocked:', error?.name));
            }
            backgroundPausedMusic.clear();
        }
    });

    function confirmQuit() {
        showConfirmModal('🏠 QUIT GAME?', 'Are you sure you want to quit to main menu? Current game will be lost.', function() {
            reportAchievement('match:quit', {});
            returnToMainMenu();
        });
    }

    function updateStatsDisplay() {
        const winsEl = document.getElementById('gamesWon');
        const lossesEl = document.getElementById('gamesLost');
        const totalEl = document.getElementById('totalGames');
        const rateEl = document.getElementById('winRate');
        if (!winsEl || !lossesEl || !totalEl || !rateEl) {
            return;
        }

        const wins = Math.max(0, Number(gameStats.wins) || 0);
        const losses = Math.max(0, Number(gameStats.losses) || 0);
        const total = Math.max(wins + losses, Number(gameStats.total) || 0);
        gameStats = { wins, losses, total };

        winsEl.textContent = wins;
        lossesEl.textContent = losses;
        totalEl.textContent = total;
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
        rateEl.textContent = winRate + '%';
    }

    function resetStats() {
        showConfirmModal('🔄 RESET STATS?', 'Are you sure you want to reset all statistics?', function() {
            playSFX('select');
            gameStats = { wins: 0, losses: 0, total: 0 };
            saveStats();
            updateStatsDisplay();
        });
    }

    function resetMetaProgress() {
        showConfirmModal('🧹 RESET PROGRESS?', 'This clears collection/decks/packs progress. Continue?', function() {
            try {
                if (!canSaveProfile() || !backupMetaRaw(localStorage.getItem(META_STORAGE_KEY), 'reset')) return;
                localStorage.removeItem(META_STORAGE_KEY);
                profileSavedRaw = null;
            } catch (error) {
                persistenceNotice('Progress could not be reset. The existing save was kept.');
                return;
            }

            try {
                gameMeta = metaEnsureInitialized({ importLegacy: false });
            } catch (error) {
                console.warn('Meta reset hook failed. Falling back to starter meta in memory.', error);
                gameMeta = createInitialMeta();
            }
            gameStats = { wins: 0, losses: 0, total: 0 };
            saveStats();
            updateStatsDisplay();

            deckBuilderState = {
                deckKey: null,
                workingCardIds: [],
                debugWarning: '',
                validationErrors: []
            };

            showGameLog('Progress reset. Starter collection restored.', false);
            playSFX('menuClose');
        });
    }

    // Battle setup's explanation of each level. Keep in step with AI_PROFILES (and AI.md §3).
    const DIFFICULTY_INFO = {
        easy: 'Plays 1 card a turn, never casts instants, and attacks with about 70% of its ready creatures at random.',
        medium: 'Plays up to 2 cards a turn and casts instants. Spots lethal damage and avoids attacks that would lose a creature for nothing.',
        hard: 'Plays as many cards as its mana allows. Plays like Medium, and keeps blockers home when your board could kill it next turn.'
    };
    const DIFFICULTY_COMMON = 'Every level plays by the same rules as you, with a legal 60-card deck in 1 or 2 random elements.';

    function syncDifficultyUI() {
        const difficulty = DIFFICULTY_INFO[gameState.difficulty] ? gameState.difficulty : 'easy';
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.difficulty === difficulty);
            btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === difficulty));
        });
        const info = document.getElementById('difficultyInfo');
        if (info) {
            const name = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
            info.innerHTML = `<strong>${name}:</strong> ${DIFFICULTY_INFO[difficulty]} <span class="difficulty-info-common">${DIFFICULTY_COMMON}</span>`;
        }
    }

    function selectDifficulty(difficulty) {
        playSFX('select');
        gameState.difficulty = difficulty;
        syncDifficultyUI();
    }

    // Card Detail Popup
    function showCardDetail(card) {
        if (cardInteractionDepth) reportAchievement('card:details', { card });
        const popup = document.getElementById('cardDetailPopup');
        const emoji = document.getElementById('detailEmoji');
        const name = document.getElementById('detailName');
        const content = document.getElementById('detailContent');

        emoji.textContent = card.emoji;
        name.textContent = card.name;

        // Same element colours, type and rarity treatment as the card face
        const identity = applyCardIdentity(popup, card);
        const rarity = getCardRarity(card);
        const typeInfo = CARD_TYPE_INFO[card.type] || { label: card.cardType || card.type, icon: '' };
        popup.dataset.type = card.type;
        popup.dataset.rarity = rarity;

        const row = (label, value) => `<div class="card-detail-info"><span class="card-detail-label">${label}:</span> ${value}</div>`;
        const tags = [
            `<span class="detail-tag detail-tag-type">${typeInfo.icon} ${card.type === 'instant' ? 'Instant Spell' : typeInfo.label}</span>`,
            `<span class="detail-tag detail-tag-rarity rarity-${rarity}">${RARITY_INFO[rarity].glyph} ${RARITY_INFO[rarity].label}</span>`,
            ...identity.map(element => `<span class="detail-tag detail-tag-element" data-element="${element}">${elementLabel(element)}</span>`)
        ];
        let html = `<div class="card-detail-tags">${tags.join('')}</div>`;

        if (card.type === 'land') {
            // Single-colour, dual, rainbow and colorless lands
            const colours = Array.isArray(card.elements) ? card.elements : [card.element];
            const mana = colours.map(element => `${ELEMENTS[element]?.emoji || '◇'} ${ELEMENT_LABELS[element] || element}`).join(' or ');
            html += `<div class="card-detail-section">${row('Mana', `Tap to add ${mana} to your mana pool`)}</div>`;
        } else {
            const stats = [row('Cost', `<span class="detail-cost">${renderCostPips(card.cost)}</span> <span class="detail-cost-text">${describeCost(card.cost)}</span>`)];
            if (card.type === 'creature') {
                // Current power/toughness, with the printed values when an effect changed them
                const printed = __CARD_BY_ID[card.__id];
                const changed = printed && (printed.power !== card.power || printed.toughness !== card.toughness);
                stats.push(row('Power/Toughness', `<strong class="detail-pt">${card.power}/${card.toughness}</strong>${changed ? ` <span class="detail-printed">(printed ${printed.power}/${printed.toughness})</span>` : ''}`));
            }
            html += `<div class="card-detail-section">${stats.join('')}</div>`;
        }

        // In your hand: whether it can be played now, and why not (the checks playCard makes)
        if (gameState.playerHand.includes(card)) {
            const restriction = getPlayRestriction(card);
            html += `<div class="card-detail-section card-detail-state">${row('In your hand', restriction ? `Can't play now: ${restriction.text}` : 'Can be played now')}</div>`;
        }

        // Where it stands on the battlefield right now
        const onBoard = gameState.playerBoard.includes(card) || gameState.enemyBoard.includes(card);
        if (onBoard) {
            const state = [];
            if (card.tapped) state.push('Tapped');
            if (card.type === 'creature') {
                const attackRestriction = gameState.playerBoard.includes(card) && gameState.turn === 'player' ? getAttackRestriction(card) : null;
                if (attackRestriction && !card.tapped && !card.summoningSick) state.push(`Can't attack: it ${attackRestriction}`);
                if (card.damage > 0) state.push(`💔 ${card.damage} damage this turn`);
                if (card.summoningSick && !card.abilities?.includes('haste')) state.push('💤 Summoning sick: can attack next turn');
                if (gameState.attackers.includes(card.id)) state.push('⚔️ Attacking');
            }
            const owner = gameState.enemyBoard.includes(card) ? 'Enemy battlefield' : 'Your battlefield';
            html += `<div class="card-detail-section card-detail-state">${row(owner, state.length ? state.join(' · ') : 'Ready')}</div>`;
        }

        if (card.type === 'creature') {
            const keywords = (card.abilities || []).map(renderKeywordDetail).join('');
            html += `<div class="card-detail-section"><div class="card-detail-subtitle">Abilities</div>${keywords || '<div class="card-detail-info">None</div>'}</div>`;
        } else if (card.type === 'instant' || card.type === 'artifact') {
            html += `<div class="card-detail-section card-detail-rules">${row('Rules', describeEffect(card))}</div>`;
        }

        const flavour = card.type === 'creature' ? (card.desc || 'A mighty creature')
            : card.type === 'land' ? '' : (card.desc || '');
        if (flavour) {
            html += `<div class="card-detail-section card-detail-flavour">${card.type === 'creature' ? flavour : row('Effect', flavour)}</div>`;
        }

        content.innerHTML = html;
        popup.classList.add('show');
        cardDetailOpenedAt = performance.now();
        hoverTooltipPinned = true;
        hideCardHoverTooltip();
    }

    function hideCardDetail() {
        document.getElementById('cardDetailPopup').classList.remove('show');
        hoverTooltipPinned = false;
    }

    function showGraveyard() {
        if (document.getElementById('gameContainer').style.display !== 'flex') {
            return;
        }

        playSFX('menuOpen');
        document.getElementById('graveyardModal').classList.add('show');
        renderGraveyard(activeGraveyardView);
    }

    function hideGraveyard() {
        playSFX('menuClose');
        document.getElementById('graveyardModal').classList.remove('show');
    }

    function renderGraveyard(owner) {
        activeGraveyardView = owner;
        const graveyardList = document.getElementById('graveyardList');
        const playerTab = document.getElementById('playerGraveyardTab');
        const enemyTab = document.getElementById('enemyGraveyardTab');

        playerTab.classList.toggle('active', owner === 'player');
        enemyTab.classList.toggle('active', owner === 'enemy');

        const cards = owner === 'player' ? gameState.playerGraveyard : gameState.enemyGraveyard;
        if (cards.length === 0) {
            graveyardList.innerHTML = `<div class="graveyard-empty">No ${owner === 'player' ? 'player' : 'enemy'} cards in the graveyard yet.</div>`;
            return;
        }

        graveyardList.innerHTML = '';

        [...cards].reverse().forEach(card => {
            const cardRow = document.createElement('button');
            cardRow.className = 'graveyard-card';
            cardRow.type = 'button';
            cardRow.innerHTML = `
                <span class="graveyard-card-emoji">${card.emoji}</span>
                <span class="graveyard-card-name">${card.name}</span>
                <span class="graveyard-card-type">${card.cardType}</span>
            `;
            bindCardPress(cardRow, {
                label: `${card.name}, ${card.cardType}`,
                onTap: () => showCardDetail(card),
                onLongPress: () => showCardDetail(card)
            });
            graveyardList.appendChild(cardRow);
        });
    }

    // Close popup when clicking outside
    // A click on the backdrop closes details, but not the click that ends the long-press which opened them
    // (on phones the popup opens under the finger).
    let cardDetailOpenedAt = 0;
    document.getElementById('cardDetailPopup').addEventListener('click', function(e) {
        if (e.target === this && performance.now() - cardDetailOpenedAt > 500) {
            hideCardDetail();
        }
    });

    document.getElementById('graveyardModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideGraveyard();
        }
    });

    document.getElementById('historyModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideMatchHistory();
        }
    });

    document.getElementById('packContentsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hidePackContents();
        }
    });

    // Element Selection
    function selectElement(element) {
        if (document.getElementById('gameContainer').style.display === 'flex') {
            return;
        }

        if (isStartingGame) {
            return;
        }

        playSFX('select');
        const btn = document.querySelector(`.element-btn[data-element="${element}"]`);
        if (!btn) return;

        if (gameState.selectedElements.includes(element)) {
            gameState.selectedElements = gameState.selectedElements.filter(e => e !== element);
        } else if (gameState.selectedElements.length < getRequiredElementCount()) {
            gameState.selectedElements.push(element);
        } else if (gameState.deckMode === 'single') {
            // A single-colour deck has one element, so picking another switches to it
            gameState.selectedElements = [element];
        }

        syncElementSelectionUI();
    }

    // Deck Generation with improved shuffling
    function generateDeck(elements) {
        const deck = [];
        const landCaps = getDeckLandCaps(elements);
        const LAND_COUNT = landCaps.maxLands;
        const NON_LAND_COUNT = Math.max(0, STANDARD_DECK_SIZE - LAND_COUNT);

        if (elements.length === 1) {
            for (let i = 0; i < LAND_COUNT; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[0]], id: nextCardInstanceId() });
            }
        } else {
            const firstLandCount = landCaps.maxPerColor[elements[0]] || Math.ceil(LAND_COUNT / 2);
            const secondLandCount = landCaps.maxPerColor[elements[1]] || (LAND_COUNT - firstLandCount);
            for (let i = 0; i < firstLandCount; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[0]], id: nextCardInstanceId() });
            }
            for (let i = 0; i < secondLandCount; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[1]], id: nextCardInstanceId() });
            }
        }

        const creatures = [];
        const spells = [];
        const artifacts = [];

        Object.values(CARD_DATABASE.creatures).forEach(creature => {
            const costElements = Object.keys(creature.cost);
            if (costElements.every(e => elements.includes(e))) {
                creatures.push(creature);
            }
        });

        Object.values(CARD_DATABASE.spells).forEach(spell => {
            const costElements = Object.keys(spell.cost);
            if (costElements.every(e => elements.includes(e))) {
                spells.push(spell);
            }
        });

        Object.values(CARD_DATABASE.artifacts).forEach(artifact => {
            const costElements = Object.keys(artifact.cost);
            if (costElements.every(e => elements.includes(e))) {
                artifacts.push(artifact);
            }
        });

        const creatureTarget = 18 + Math.floor(gameplayRandom() * 7); // 18-24
        const spellTarget = 7 + Math.floor(gameplayRandom() * 7); // 7-13
        const artifactTarget = Math.max(0, NON_LAND_COUNT - creatureTarget - spellTarget);

        // Generated decks (the AI's) follow the same copy limits as a player's deck: at most 2 of a card and
        // 1 of a legendary (AI.md §2). They used to pick with replacement, so most AI decks broke the limits.
        const copies = {};
        const canAdd = card => (copies[card.__id] || 0) < getDeckCardCopyLimit(card);
        function addCard(card) {
            copies[card.__id] = (copies[card.__id] || 0) + 1;
            deck.push({ ...card, id: nextCardInstanceId() });
        }

        function addCardsFromPool(pool, count) {
            for (let i = 0; i < count; i++) {
                const open = pool.filter(canAdd);
                if (open.length === 0) return;
                addCard(open[Math.floor(gameplayRandom() * open.length)]);
            }
        }

        addCardsFromPool(creatures, creatureTarget);
        addCardsFromPool(spells, spellTarget);
        addCardsFromPool(artifacts, artifactTarget);

        let fallbackPool = [...creatures, ...spells, ...artifacts].filter(canAdd);
        while (deck.length < LAND_COUNT + NON_LAND_COUNT && fallbackPool.length > 0) {
            addCard(fallbackPool[Math.floor(gameplayRandom() * fallbackPool.length)]);
            fallbackPool = fallbackPool.filter(canAdd);
        }

        shuffleDeck(deck, 6);

        return deck;
    }

    function createPlayerDeck(elements) {
        const normalizedElements = Array.isArray(elements)
            ? elements.filter(element => ELEMENTS[element])
            : [];
        const fallbackDeck = () => {
            if (normalizedElements.length === 0) {
                return generateDeck(['fire', 'water']);
            }
            if (normalizedElements.length === 1) {
                return generateDeck(normalizedElements);
            }
            return generateDeck(normalizedElements.slice(0, 2));
        };
        const isMetaEnabledForDeck = isMetaRuntimeEnabled();

        const getFallbackDeckWithLog = () => {
            if (QA_MODE) {
                console.debug('[QA] fallback path');
            }
            return fallbackDeck();
        };

        if (!isMetaEnabledForDeck) {
            return getFallbackDeckWithLog();
        }

        try {
            const meta = gameMeta;
            const selectedDeckKey = getDeckKeyFromElements(normalizedElements) || meta?.selectedDeckKey;
            const metaDeck = meta?.decks?.[selectedDeckKey];
            const cardIds = Array.isArray(metaDeck?.cardIds) ? metaDeck.cardIds : null;

            if (!cardIds || cardIds.length === 0) {
                if (selectedDeckKey) {
                    console.warn(`Meta deck "${selectedDeckKey}" is missing or empty. Falling back to generated deck.`);
                }
                return getFallbackDeckWithLog();
            }

            const isValid = cardIds.every(cardId => window.__CARD_BY_ID && window.__CARD_BY_ID[cardId]);
            if (!isValid) {
                console.warn(`Meta deck "${selectedDeckKey}" has invalid card ids. Falling back to generated deck.`);
                return getFallbackDeckWithLog();
            }

            const deck = cardIds.map(cardId => ({ ...window.__CARD_BY_ID[cardId], id: nextCardInstanceId() }));
            shuffleDeck(deck);
            if (QA_MODE) {
                console.debug('[QA] META path');
            }
            return deck;
        } catch (error) {
            console.warn('Failed to load meta deck at match start. Falling back to generated deck.', error);
            return getFallbackDeckWithLog();
        }
    }

    // Shuffle deck function (multi-pass Fisher-Yates + cut for better randomness)
    function shuffleDeck(deck, passes = 1) {
        if (!Array.isArray(deck) || deck.length < 2) return;
        const safePasses = Math.max(1, Math.floor(passes));

        for (let pass = 0; pass < safePasses; pass++) {
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(gameplayRandom() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            if (deck.length > 10) {
                const cutIndex = Math.floor(deck.length * (0.25 + gameplayRandom() * 0.5));
                const top = deck.splice(0, cutIndex);
                deck.push(...top);
            }
        }
    }

    // Start Game
    // Mulligan function
    // One mulligan, on your first turn, before your first action (RULES.md R2.1).
    function canMulligan() {
        return !gameState.matchFinalized && !mulliganUsed && !playerFirstTurnCompleted &&
            gameState.turn === 'player' && gameState.playerBoard.length === 0 && gameState.playerGraveyard.length === 0;
    }

    function mulligan() {
        if (gamePaused) return;
        if (!canMulligan()) {
            showGameLog('⚠️ You can only mulligan once, before your first action!', false);
            return;
        }

        // Show mulligan confirm modal instead of confirm()
        const modal = document.getElementById('mulliganConfirmModal');
        const yesBtn = document.getElementById('mulliganYesBtn');
        const noBtn = document.getElementById('mulliganNoBtn');

        // Clone and replace to remove old listeners
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);

        function closeModal() {
            modal.classList.remove('show');
            setTimeout(() => { modal.style.display = 'none'; }, 250);
        }

        newYes.addEventListener('click', function() {
            closeModal();
            performMulligan();
        });
        newNo.addEventListener('click', function() {
            closeModal();
        });

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('show');
    }

    function performMulligan() {
        if (!canMulligan()) {
            return;
        }
        playSFX('select');
        reportAchievement('mulligan', {});

        // Return hand to deck
        gameState.playerDeck = gameState.playerDeck.concat(gameState.playerHand);
        gameState.playerHand = [];

        // Super shuffle after returning hand to deck
        shuffleDeck(gameState.playerDeck, 8);

        // Draw 6 cards
        for (let i = 0; i < 6; i++) {
            drawCard('player');
        }

        mulliganUsed = true;
        document.getElementById('mulliganBtn').disabled = true;
        document.getElementById('mulliganBtn').style.opacity = '0.5';

        showGameLog('🔄 Mulligan - Drew 6 new cards', false);
        recordHistory('player', '🔄 You mulligan: a new hand of 6');
        updateUI();
        updateDeckCounters();
    }

    // Update deck counters
    function updateDeckCounters() {
        document.getElementById('playerDeckCount').textContent = gameState.playerDeck.length;
        document.getElementById('enemyDeckCount').textContent = gameState.enemyDeck.length;
        const enemyHand = document.getElementById('enemyHandCount');
        if (enemyHand) enemyHand.textContent = gameState.enemyHand.length;
    }

    function startGame() {
        if (isStartingGame) {
            return;
        }

        const elementScreen = document.getElementById('elementSelectionScreen');
        if (!elementScreen || elementScreen.style.display === 'none') {
            return;
        }

        const requiredElementCount = getRequiredElementCount();
        if (gameState.selectedElements.length !== requiredElementCount) {
            showGameLog(`⚠️ Select exactly ${requiredElementCount} element${requiredElementCount === 1 ? '' : 's'} first!`, false);
            return;
        }

        cancelMatchWork();
        isStartingGame = true;
        clearMatchPause();
        resetAiActivityMarks();
        const startBtn = document.getElementById('startBtn');
        if (startBtn) {
            startBtn.disabled = true;
        }

        playSFX('select');

        if (isMetaRuntimeEnabled()) {
            const chosenDeckKey = getDeckKeyFromElements(gameState.selectedElements);
            if (chosenDeckKey && gameMeta?.decks?.[chosenDeckKey]) {
                gameMeta.selectedDeckKey = chosenDeckKey;
                metaSave(gameMeta);
            }
        }

        // CRITICAL: Reset ALL game state to prevent crashes when starting new game
        gameState.playerLife = 20;
        gameState.enemyLife = 20;
        gameState.playerMana = {};
        gameState.enemyMana = {};
        gameState.playerHand = [];
        gameState.playerBoard = [];
        gameState.playerGraveyard = [];
        gameState.enemyHand = [];
        gameState.enemyBoard = [];
        gameState.enemyGraveyard = [];
        gameState.selectedCard = null;
        gameState.phase = 'main';
        gameState.turn = 'player';
        gameState.attackers = [];
        gameState.blockers = {};
        gameState.previousPlayerLife = 20;
        gameState.previousEnemyLife = 20;
        gameState.landsPlayedThisTurn = 0;  // CRITICAL: Reset land counter
        gameState.hasAttackedThisTurn = false;  // Reset attack flag for new game
        gameState.playerDeckedOut = false;
        gameState.enemyDeckedOut = false;
        gameState.matchFinalized = false;
        gameState.round = 1;
        aiStatusText = '';
        resetMatchHistory();
        recordHistory('player', '🔔 Turn 1: your turn');
        pendingMatchResultOverlay = null;

        // Generate decks
        gameState.playerDeck = createPlayerDeck(gameState.selectedElements);
        if (!Array.isArray(gameState.playerDeck) || gameState.playerDeck.length === 0) {
            console.warn('Player deck resolved to empty. Rebuilding with generated fallback deck.');
            gameState.playerDeck = generateDeck(gameState.selectedElements);
        }

        // AI picks random elements
        const elementKeys = Object.keys(ELEMENTS).filter(element => element !== 'colorless');
        const aiRequiredCount = gameplayRandom() < 0.5 ? 1 : 2;
        const aiElements = [];
        while (aiElements.length < aiRequiredCount) {
            const element = elementKeys[Math.floor(gameplayRandom() * elementKeys.length)];
            if (!aiElements.includes(element)) {
                aiElements.push(element);
            }
        }
        gameState.enemyDeck = generateDeck(aiElements);

        // Super shuffle both decks before opening hands
        shuffleDeck(gameState.playerDeck, 8);
        shuffleDeck(gameState.enemyDeck, 8);

        // Draw starting hands
        for (let i = 0; i < 7; i++) {
            drawCard('player');
            drawCard('enemy');
        }

        const modal = document.getElementById('startModal');
        modal.classList.remove('modal-visible');
        modal.style.display = 'none';
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.classList.remove('enemy-turn');
        gameContainer.style.display = 'flex';

        // Smoothly transition from menu theme into gameplay theme
        transitionToGameplayMusic();

        // Reset mulligan button
        mulliganUsed = false;
        playerFirstTurnCompleted = false;
        document.getElementById('mulliganBtn').disabled = false;
        document.getElementById('mulliganBtn').style.opacity = '1';

        // Reset attack phase variable and processing lock
        attackPhase = false;
        releaseProcessingLock();
        setAttackControls('idle');

        updateUI();
        updateDeckCounters();
        reportAchievement('match:start', {
            deckKey: getDeckKeyFromElements(gameState.selectedElements),
            elements: [...gameState.selectedElements],
            difficulty: gameState.difficulty
        });

        matchDelay(() => {
            isStartingGame = false;
        }, 300);
    }

    // Draw Card
    // Drawing from an empty deck loses the match (RULES.md R6.1).
    function drawCard(player) {
        if (gameState.matchFinalized) return;
        const isPlayer = player === 'player';
        const deck = isPlayer ? gameState.playerDeck : gameState.enemyDeck;
        if (deck.length === 0) {
            if (gameState.matchFinalized) return;
            gameState[isPlayer ? 'playerDeckedOut' : 'enemyDeckedOut'] = true;
            showGameLog(isPlayer ? '📭 Your deck is empty: you cannot draw!' : '📭 Enemy deck is empty!', !isPlayer);
            checkGameOver();
            return;
        }
        (isPlayer ? gameState.playerHand : gameState.enemyHand).push(deck.pop());
    }

    // Play Card
    function playCard(cardId) {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        // Turn enforcement and rapid-click protection
        if (gameState.turn !== 'player' || gameState.phase === 'enemy') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        if (isProcessingAction) {
            return; // Silently block rapid clicking
        }

        const card = gameState.playerHand.find(c => c.id === cardId);
        if (!card) return;

        const clickedHandCardEl = document.querySelector(`#playerHand .card[data-card-id="${cardId}"]`) ||
            document.querySelector(`#playerHand .card[data-id="${cardId}"]`) ||
            document.getElementById(`card-player-${cardId}`);

        // LAND PLAY LIMIT: Enforce one land per turn rule
        if (card.type === 'land' && gameState.landsPlayedThisTurn >= 1) {
            showGameLog('⚠️ Only one land per turn!', false);
            return;
        }

        const cardCost = card.cost || {};

        // Lands are always free; other card types must be affordable.
        if (card.type !== 'land' && !canPayCost(cardCost, gameState.playerMana)) {
            showCardDetail(card);
            showGameLog('⚠️ Not enough mana!', false);
            return;
        }

        applyJuice(clickedHandCardEl, 'juice-pop');

        let playedBoardCardId = null;
        const historySnap = snapshotForHistory();

        // Set processing lock to prevent rapid clicking (with 3 second failsafe)
        setProcessingLock(3000);

        // Pay cost
        const manaBefore = manaTotal(gameState.playerMana);
        if (card.type !== 'land') {
            payCost(cardCost, gameState.playerMana);
        }
        const manaAfter = manaTotal(gameState.playerMana);

        // Remove from hand
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== cardId);

        // Play the card
        if (card.type === 'land') {
            // Lands go to board and generate mana
            gameState.playerBoard.push({...card, tapped: false});
            playedBoardCardId = card.id;
            gameState.landsPlayedThisTurn++;  // Increment land counter
            playLandTap();
            showGameLog(`🌍 You play ${card.name}`, false);
        } else if (card.type === 'creature') {
            gameState.playerBoard.push({...card, tapped: false, summoningSick: !card.abilities?.includes('haste'), damage: 0});
            playedBoardCardId = card.id;
            // Summon sound by the card's theme
            GameFeedback.play('summon', { variant: card.theme === 'Science Fiction' ? 'scifi' : 'fantasy' });
            showGameLog(`${card.emoji} You summon ${card.name}`, false, card.theme === 'Science Fiction');
        } else if (card.type === 'artifact') {
            const artifactOnBoard = {...card, tapped: false};
            gameState.playerBoard.push(artifactOnBoard);
            playedBoardCardId = artifactOnBoard.id;
            GameFeedback.play('artifact');
            showGameLog(`${card.emoji} You play ${card.name}`, false, card.theme === 'Science Fiction');

            // Trigger artifact effects that should happen immediately when played
            resolveArtifactOnPlay(artifactOnBoard, 'player');
        } else if (card.type === 'instant') {
            GameFeedback.play('spell');
            showGameLog(`${card.emoji} You cast ${card.name}`, false, card.theme === 'Science Fiction');
            castInstant(card, 'player');
        }

        haptic('play');
        reportAchievement('card:played', { side: 'player', card, manaBefore, manaAfter });
        const verb = { land: 'play', creature: 'summon', artifact: 'play', instant: 'cast' }[card.type] || 'play';
        recordHistory('player', `${card.emoji} You ${verb} ${card.name}`,
            describeChangesSince(historySnap, { playedFrom: 'player', playedId: playedBoardCardId ?? card.id }));

        // Particles
        const handEl = document.getElementById('playerHand');
        const rect = handEl.getBoundingClientRect();
        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ffd700', 30);

        updateUI();

        if (playedBoardCardId) {
            const playedCardEl = document.querySelector(`#playerBoard .card[data-card-id="${playedBoardCardId}"]`) ||
                document.querySelector(`#playerBoard .card[data-id="${playedBoardCardId}"]`) ||
                document.getElementById(`card-player-${playedBoardCardId}`);
            applyJuice(playedCardEl || document.getElementById('playerBoard'), 'juice-pop');
        }

        // Release processing lock after a short delay
        matchDelay(() => {
            releaseProcessingLock();
        }, 200);
    }

    // Check if can pay cost
    function canPayCost(cost, mana) {
        if (!cost) return true;

        let availableColorless = mana.colorless || 0;

        for (let element in cost) {
            if (element === 'colorless') continue;

            const required = cost[element] || 0;
            const available = mana[element] || 0;

            if (available < required) {
                const shortage = required - available;
                if (availableColorless < shortage) {
                    return false;
                }
                availableColorless -= shortage;
            }
        }

        const genericRequired = cost.colorless || 0;
        const totalMana = Object.values(mana).reduce((sum, value) => sum + (value || 0), 0);
        const totalCost = Object.values(cost).reduce((sum, value) => sum + (value || 0), 0);

        if (totalMana < totalCost) {
            return false;
        }

        if (genericRequired > 0 && totalMana < genericRequired) {
            return false;
        }

        return true;
    }

    // Pay cost
    function payCost(cost, mana) {
        if (!cost) return;

        for (let element in cost) {
            if (element === 'colorless') continue;

            let remaining = cost[element] || 0;
            const coloredAvailable = mana[element] || 0;
            const useColored = Math.min(coloredAvailable, remaining);

            mana[element] = coloredAvailable - useColored;
            remaining -= useColored;

            if (remaining > 0) {
                mana.colorless = Math.max(0, (mana.colorless || 0) - remaining);
            }
        }

        let genericRemaining = cost.colorless || 0;
        if (genericRemaining > 0) {
            const colorsByAmount = Object.keys(mana).sort((a, b) => (mana[b] || 0) - (mana[a] || 0));
            for (const color of colorsByAmount) {
                if (genericRemaining <= 0) break;
                const spend = Math.min(mana[color] || 0, genericRemaining);
                mana[color] = (mana[color] || 0) - spend;
                genericRemaining -= spend;
            }
        }
    }

    // Mana Choice Modal for dual lands
    function showManaChoiceModal(card, callback) {
        const modal = document.getElementById('manaChoiceModal');
        const optionsContainer = document.getElementById('manaChoiceOptions');
        optionsContainer.innerHTML = '';

        card.elements.forEach(element => {
            const btn = document.createElement('button');
            btn.className = 'mana-choice-btn';
            btn.textContent = ELEMENTS[element] ? ELEMENTS[element].emoji : element;
            btn.title = element;
            btn.addEventListener('click', function() {
                modal.classList.remove('show');
                setTimeout(() => { if (!modal.classList.contains('show')) modal.style.display = 'none'; }, 250);
                callback(element);
            });
            optionsContainer.appendChild(btn);
        });

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'mana-choice-btn cancel-btn';
        cancelBtn.textContent = '✕ Cancel';
        cancelBtn.addEventListener('click', function() {
            modal.classList.remove('show');
            setTimeout(() => { if (!modal.classList.contains('show')) modal.style.display = 'none'; }, 250);
        });
        optionsContainer.appendChild(cancelBtn);

        modal.style.display = 'flex';
        // Trigger reflow for animation
        void modal.offsetWidth;
        modal.classList.add('show');
    }

    // Generic confirm modal
    function showConfirmModal(title, text, onConfirm, onCancel) {
        const modal = document.getElementById('gameConfirmModal');
        document.getElementById('gameConfirmTitle').textContent = title;
        document.getElementById('gameConfirmText').textContent = text;

        const yesBtn = document.getElementById('gameConfirmYesBtn');
        const noBtn = document.getElementById('gameConfirmNoBtn');

        // Clone and replace to remove old listeners
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);

        let settled = false;
        function closeModal() {
            modal.classList.remove('show');
            setTimeout(() => { if (!modal.classList.contains('show')) modal.style.display = 'none'; }, 250);
        }

        newYes.addEventListener('click', function() {
            if (settled) return;
            settled = true;
            closeModal();
            if (onConfirm) onConfirm();
        });
        newNo.addEventListener('click', function() {
            if (settled) return;
            settled = true;
            closeModal();
            if (onCancel) onCancel();
        });

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('show');
    }

    // Tap lands for mana
    function tapLand(cardId) {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        // Turn enforcement: Only allow during player's turn
        if (gameState.turn !== 'player' || gameState.phase === 'enemy') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card || card.type !== 'land') return;

        // DUAL LAND SUPPORT: Check if this is a dual-color land
        const isDualLand = card.elements && card.elements.length > 1;
        const storedElement = card.selectedElement; // Track which element was chosen for dual lands

        // A tapped land can be untapped only to give back its unspent mana (RULES.md R4.4)
        if (card.tapped) {
            const elementToRefund = isDualLand ? storedElement : card.element;
            if (!elementToRefund || !(gameState.playerMana[elementToRefund] > 0)) {
                showGameLog(`⚠️ ${card.name}'s mana is already spent`, false);
                return;
            }
            card.tapped = false;
            gameState.playerMana[elementToRefund]--;
            playSFX('untap');
            showGameLog(`🔄 You untap ${card.name} (mana refunded)`, false);
            updateUI();
            return;
        }

        // Otherwise tap it for mana
        let elementToAdd;

        if (isDualLand) {
            // DUAL LAND: Show mana choice modal instead of prompt
            showManaChoiceModal(card, function(chosenElement) {
                // The choice may arrive after the turn ended or the match finished (RULES.md R4.5)
                if (gameState.matchFinalized || gameState.turn !== 'player' || gameState.phase === 'enemy' ||
                    card.tapped || !gameState.playerBoard.includes(card)) {
                    return;
                }
                card.selectedElement = chosenElement;
                card.tapped = true;
                gameState.playerMana[chosenElement] = (gameState.playerMana[chosenElement] || 0) + 1;
                playLandTap();
                reportAchievement('land:tapped', { cards: [card] });
                showGameLog(`⚡ You tap ${card.name} for ${chosenElement} mana`, false);
                updateUI();
            });
            return; // Exit early; callback handles the rest
        } else if (card.element) {
            // Regular single-color land
            elementToAdd = card.element;
        } else {
            showGameLog('⚠️ This land has no mana!', false);
            return;
        }

        card.tapped = true;
        gameState.playerMana[elementToAdd] = (gameState.playerMana[elementToAdd] || 0) + 1;

        playLandTap();
        reportAchievement('land:tapped', { cards: [card] });
        showGameLog(`⚡ You tap ${card.name} for ${elementToAdd} mana`, false);

        updateUI();
    }

    // Tap ALL untapped lands of a given element type at once
    function tapAllLandsOfType(landKey) {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        if (gameState.turn !== 'player' || gameState.phase === 'enemy') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        const landsOfType = gameState.playerBoard.filter(c => {
            if (c.type !== 'land') return false;
            const key = c.element || (c.elements && c.elements.join('-')) || 'colorless';
            return key === landKey;
        });

        const untappedLands = landsOfType.filter(c => !c.tapped);
        if (untappedLands.length === 0) {
            showGameLog('⚠️ No untapped lands of that type!', false);
            return;
        }

        let tappedCount = 0;
        untappedLands.forEach(card => {
            const isDualLand = card.elements && card.elements.length > 1;
            let elementToAdd;

            if (isDualLand) {
                // For dual lands tapped via tap-all, use the first element
                elementToAdd = card.elements[0];
                card.selectedElement = elementToAdd;
            } else if (card.element) {
                elementToAdd = card.element;
            } else {
                return;
            }

            card.tapped = true;
            gameState.playerMana[elementToAdd] = (gameState.playerMana[elementToAdd] || 0) + 1;
            tappedCount++;
        });

        if (tappedCount > 0) {
            playLandTap();
            reportAchievement('land:tapped', { cards: untappedLands.filter(c => c.tapped) });
            showGameLog(`⚡ You tap ${tappedCount} ${untappedLands[0].name}${tappedCount > 1 ? 's' : ''} for mana`, false);
            updateUI();
        }
    }

    function activateArtifact(cardId) {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        if (gameState.turn !== 'player' || gameState.phase === 'enemy') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card || card.type !== 'artifact') return;

        if (card.tapped) {
            showGameLog(`⚠️ ${card.name} is already tapped`, false);
            return;
        }

        if (card.effect !== 'mana') {
            showCardDetail(card);
            return;
        }

        card.tapped = true;
        const manaToAdd = 'colorless';
        gameState.playerMana[manaToAdd] = (gameState.playerMana[manaToAdd] || 0) + (card.value || 1);

        playLandTap();
        reportAchievement('mana:artifact', { card });
        showGameLog(`⚡ ${card.name} adds ${ELEMENTS[manaToAdd].emoji} mana`, false);
        updateUI();
    }

    // A card that leaves the battlefield goes back to its printed self: stat bonuses, granted keywords,
    // damage, Anger and Deep Freeze end with it (EFFECTS.md E3). Tokens keep their token stats.
    function asPrintedCard(card) {
        const copy = {...card, tapped: false, damage: 0};
        delete copy.eotPower;
        delete copy.frozen;
        const printed = (card.__id && __CARD_BY_ID[card.__id]) || card.printed;
        if (card.type === 'creature' && printed) {
            copy.power = printed.power;
            copy.toughness = printed.toughness;
            copy.abilities = printed.abilities;
        }
        return copy;
    }

    function moveCardToGraveyard(card, owner) {
        if (!card) return;

        const graveyard = owner === 'player' ? gameState.playerGraveyard : gameState.enemyGraveyard;
        graveyard.push(asPrintedCard(card));
    }

    function isOneShotArtifactEffect(effect) {
        return ['buff', 'buff_defense', 'aoe', 'draw_on_play', 'token', 'destroy', 'bounce', 'tap', 'discard', 'discard_draw'].includes(effect);
    }

    // Artifacts whose effect happens once, when played. They are then used up (EFFECTS.md E1).
    const ON_PLAY_ARTIFACT_EFFECTS = ['buff', 'buff_defense', 'aoe', 'draw_on_play'];

    // Shared by the player and the AI, so both sides resolve cards the same way.
    function resolveArtifactOnPlay(artifactOnBoard, owner) {
        if (!ON_PLAY_ARTIFACT_EFFECTS.includes(artifactOnBoard.effect)) return;
        const before = snapshotForOutcome();
        withLifeSource('artifact', () => resolveSpell(artifactOnBoard, owner));
        checkStateBasedActions();
        reportAchievement('spell:resolved', describeOutcome(before, artifactOnBoard, owner));
        if (isOneShotArtifactEffect(artifactOnBoard.effect)) {
            sendBoardCardToGraveyard(artifactOnBoard.id, owner);
        }
    }

    function castInstant(card, caster) {
        const before = snapshotForOutcome();
        withLifeSource(card.effect === 'drain' ? 'drain' : 'instant', () => resolveSpell(card, caster));
        moveCardToGraveyard(card, caster);
        checkStateBasedActions();
        reportAchievement('spell:resolved', describeOutcome(before, card, caster));
    }

    // Untap step for one permanent. A Deep Frozen permanent skips one untap (EFFECTS.md E4).
    function untapAtTurnStart(card) {
        if (card.frozen) {
            card.frozen = false;
        } else {
            card.tapped = false;
        }
        if (card.type === 'creature') {
            card.summoningSick = false;
        }
    }

    // "Until end of turn" bonuses (Anger) end when the turn ends, on both sides (EFFECTS.md E4).
    function clearEndOfTurnEffects() {
        [...gameState.playerBoard, ...gameState.enemyBoard].forEach(card => {
            if (card.eotPower) {
                card.power -= card.eotPower;
                delete card.eotPower;
            }
        });
    }

    function sendBoardCardToGraveyard(cardId, owner) {
        const board = owner === 'player' ? gameState.playerBoard : gameState.enemyBoard;
        const target = board.find(c => c.id === cardId);
        if (!target) return;

        moveCardToGraveyard(target, owner);

        if (owner === 'player') {
            gameState.playerBoard = gameState.playerBoard.filter(c => c.id !== cardId);
        } else {
            gameState.enemyBoard = gameState.enemyBoard.filter(c => c.id !== cardId);
        }
    }

    // State-based actions - check for dead creatures
    function checkStateBasedActions() {
        // Check player board for dead creatures
        const playerDeadCreatures = gameState.playerBoard.filter(c =>
            c.type === 'creature' && (c.damage || 0) >= c.toughness
        );
        playerDeadCreatures.forEach(creature => {
            moveCardToGraveyard(creature, 'player');
            showGameLog(`💀 ${creature.emoji} ${creature.name} is destroyed!`, false);
        });
        gameState.playerBoard = gameState.playerBoard.filter(c =>
            c.type !== 'creature' || (c.damage || 0) < c.toughness
        );

        // Check enemy board for dead creatures
        const enemyDeadCreatures = gameState.enemyBoard.filter(c =>
            c.type === 'creature' && (c.damage || 0) >= c.toughness
        );
        enemyDeadCreatures.forEach(creature => {
            moveCardToGraveyard(creature, 'enemy');
            showGameLog(`💀 ${creature.emoji} ${creature.name} is destroyed!`, true);
        });
        gameState.enemyBoard = gameState.enemyBoard.filter(c =>
            c.type !== 'creature' || (c.damage || 0) < c.toughness
        );

        // Play sound if any creatures died
        if (playerDeadCreatures.length > 0 || enemyDeadCreatures.length > 0) {
            playSFX('cardDestroyed');
        }
    }

    function clearCombatDamage() {
        gameState.playerBoard.forEach(card => {
            if (card.type === 'creature' && card.damage) {
                card.damage = 0;
            }
        });

        gameState.enemyBoard.forEach(card => {
            if (card.type === 'creature' && card.damage) {
                card.damage = 0;
            }
        });
    }

    // Resolve Spell
    function resolveSpell(card, caster) {
        const isCasterPlayer = caster === 'player';

        switch(card.effect) {
            case 'damage':
                if (card.target === 'all') {
                    // Every creature on both sides, the caster's too (EFFECTS.md)
                    [...gameState.playerBoard, ...gameState.enemyBoard].forEach(c => {
                        if (c.type === 'creature') {
                            c.damage = (c.damage || 0) + card.value;
                        }
                    });
                    shakeScreen();
                } else {
                    // Damage opponent
                    if (isCasterPlayer) {
                        changeEnemyLife(-card.value);
                        const enemyArea = document.querySelector('.enemy-area');
                        const rect = enemyArea.getBoundingClientRect();
                        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ff4500', 30);
                    } else {
                        changePlayerLife(-card.value);
                        const playerArea = document.querySelector('.player-area:not(.enemy-area)');
                        const rect = playerArea.getBoundingClientRect();
                        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ff4500', 30);
                    }
                }
                break;

            case 'heal':
                if (isCasterPlayer) {
                    changePlayerLife(card.value);
                    const playerInfo = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rect = playerInfo.getBoundingClientRect();
                    createSparkles(rect.left + rect.width / 2, rect.top + rect.height / 2, 20);
                } else {
                    changeEnemyLife(card.value);
                    const enemyInfo = document.querySelector('.enemy-area .player-info');
                    const rect = enemyInfo.getBoundingClientRect();
                    createSparkles(rect.left + rect.width / 2, rect.top + rect.height / 2, 20);
                }
                break;

            case 'heal_draw':
                // Heal life AND draw cards (e.g., Meditate)
                if (isCasterPlayer) {
                    changePlayerLife(card.value);
                    const playerInfoHD = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rectHD = playerInfoHD.getBoundingClientRect();
                    createSparkles(rectHD.left + rectHD.width / 2, rectHD.top + rectHD.height / 2, 20);
                } else {
                    changeEnemyLife(card.value);
                    const enemyInfoHD = document.querySelector('.enemy-area .player-info');
                    const rectHD = enemyInfoHD.getBoundingClientRect();
                    createSparkles(rectHD.left + rectHD.width / 2, rectHD.top + rectHD.height / 2, 20);
                }
                {
                    const healDrawCount = card.drawCards || 1;
                    for (let i = 0; i < healDrawCount; i++) {
                        drawCard(caster);
                    }
                    showGameLog(`📜 ${isCasterPlayer ? 'You' : 'Enemy'} draw ${healDrawCount} card${healDrawCount > 1 ? 's' : ''}`, !isCasterPlayer);
                }
                break;

            case 'draw':
                for (let i = 0; i < card.value; i++) {
                    drawCard(caster);
                }
                showGameLog(`📜 ${isCasterPlayer ? 'You' : 'Enemy'} draw ${card.value} card${card.value > 1 ? 's' : ''}`, !isCasterPlayer);
                break;

            case 'draw_on_play':
                for (let i = 0; i < (card.value || 1); i++) {
                    drawCard(caster);
                }
                showGameLog(`🧬 ${isCasterPlayer ? 'You' : 'Enemy'} draw ${card.value || 1} card${(card.value || 1) > 1 ? 's' : ''}`, !isCasterPlayer);
                break;

            case 'drain':
                // Gain first: a lethal drain still gains its life before the match ends.
                if (isCasterPlayer) {
                    changePlayerLife(card.value);
                    changeEnemyLife(-card.value);
                    const playerInfo = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rect = playerInfo.getBoundingClientRect();
                    createSparkles(rect.left + rect.width / 2, rect.top + rect.height / 2, 15);
                } else {
                    changeEnemyLife(card.value);
                    changePlayerLife(-card.value);
                }
                showGameLog(`💉 Drain ${card.value} life`, !isCasterPlayer);
                break;

            case 'destroy':
                // Destroy target creature (simplified - destroys a random creature)
                const targetBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const creatures = targetBoard.filter(c => c.type === 'creature' && !c.abilities?.includes('hexproof'));
                if (creatures.length > 0) {
                    const target = creatures[Math.floor(gameplayRandom() * creatures.length)];
                    // Move to graveyard before removing from board
                    moveCardToGraveyard(target, isCasterPlayer ? 'enemy' : 'player');
                    if (isCasterPlayer) {
                        gameState.enemyBoard = gameState.enemyBoard.filter(c => c.id !== target.id);
                    } else {
                        gameState.playerBoard = gameState.playerBoard.filter(c => c.id !== target.id);
                    }
                    playSFX('cardDestroyed');
                    showGameLog(`${target.emoji} ${target.name} is destroyed!`, !isCasterPlayer);
                } else {
                    showGameLog(`No creatures to destroy`, !isCasterPlayer);
                }
                break;

            case 'buff':
                // Buff friendly creature(s) - supports power-only, target-all, and granting abilities
                const friendlyBoard = isCasterPlayer ? gameState.playerBoard : gameState.enemyBoard;
                const friendlyCreatures = friendlyBoard.filter(c => c.type === 'creature');
                if (friendlyCreatures.length > 0) {
                    const buffTargets = card.targetAll ? friendlyCreatures : [friendlyCreatures[Math.floor(gameplayRandom() * friendlyCreatures.length)]];
                    const isPowerOnly = card.buffType === 'power';
                    buffTargets.forEach(target => {
                        if (card.value > 0) {
                            target.power = (target.power || 0) + card.value;
                            if (card.untilEndOfTurn) {
                                target.eotPower = (target.eotPower || 0) + card.value;
                            }
                            if (!isPowerOnly) {
                                target.toughness = (target.toughness || 0) + card.value;
                            }
                        }
                        if (card.grantAbilities) {
                            card.grantAbilities.forEach(ability => {
                                // New array: abilities is shared with the card definition and every other copy.
                                if (!target.abilities?.includes(ability)) {
                                    target.abilities = [...(target.abilities || []), ability];
                                }
                            });
                        }
                    });
                    // Build log message
                    const buffStr = card.value > 0 ? (isPowerOnly ? `+${card.value}/+0` : `+${card.value}/+${card.value}`) : '';
                    const abilityStr = (card.grantAbilities ? (buffStr ? ' and ' : '') + card.grantAbilities.join(', ') : '') +
                        (card.untilEndOfTurn ? ' until end of turn' : '');
                    if (card.targetAll) {
                        showGameLog(`✨ All creatures get ${buffStr}${abilityStr}!`, !isCasterPlayer);
                    } else {
                        showGameLog(`✨ ${buffTargets[0].emoji} ${buffTargets[0].name} gets ${buffStr}${abilityStr}!`, !isCasterPlayer);
                    }
                    createSparkles(window.innerWidth / 2, window.innerHeight / 2, 15);
                } else {
                    showGameLog(`No creatures to buff`, !isCasterPlayer);
                }
                break;

            case 'buff_defense':
                // Buff friendly creature(s) with +0/+X - supports target-all and granting abilities
                const friendlyBoard2 = isCasterPlayer ? gameState.playerBoard : gameState.enemyBoard;
                const friendlyCreatures2 = friendlyBoard2.filter(c => c.type === 'creature');
                if (friendlyCreatures2.length > 0) {
                    const defTargets = card.targetAll ? friendlyCreatures2 : [friendlyCreatures2[Math.floor(gameplayRandom() * friendlyCreatures2.length)]];
                    defTargets.forEach(target => {
                        target.toughness = (target.toughness || 0) + card.value;
                        if (card.grantAbilities) {
                            card.grantAbilities.forEach(ability => {
                                // New array: abilities is shared with the card definition and every other copy.
                                if (!target.abilities?.includes(ability)) {
                                    target.abilities = [...(target.abilities || []), ability];
                                }
                            });
                        }
                    });
                    const defAbilityStr = card.grantAbilities ? ` and ${card.grantAbilities.join(', ')}` : '';
                    if (card.targetAll) {
                        showGameLog(`🛡️ All creatures get +0/+${card.value}${defAbilityStr}!`, !isCasterPlayer);
                    } else {
                        showGameLog(`🛡️ ${defTargets[0].emoji} ${defTargets[0].name} gets +0/+${card.value}${defAbilityStr}!`, !isCasterPlayer);
                    }
                    createSparkles(window.innerWidth / 2, window.innerHeight / 2, 15);
                } else {
                    showGameLog(`No creatures to buff`, !isCasterPlayer);
                }
                break;

            case 'tap':
                // Tap a random enemy creature. Deep Freeze (skipUntap) prefers an untapped one, else freezes a
                // tapped one, and it skips its controller's next untap (EFFECTS.md E4).
                const enemyBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const tappable = enemyBoard.filter(c => c.type === 'creature' && !c.abilities?.includes('hexproof'));
                const untappedCreatures = tappable.filter(c => !c.tapped);
                const tapPool = untappedCreatures.length > 0 || !card.skipUntap ? untappedCreatures : tappable;
                if (tapPool.length > 0) {
                    const target = tapPool[Math.floor(gameplayRandom() * tapPool.length)];
                    target.tapped = true;
                    if (card.skipUntap) {
                        target.frozen = true;
                    }
                    showGameLog(card.skipUntap
                        ? `🥶 ${target.emoji} ${target.name} is frozen: it won't untap next turn!`
                        : `❄️ ${target.emoji} ${target.name} is tapped!`, !isCasterPlayer);
                } else {
                    showGameLog(`No creatures to tap`, !isCasterPlayer);
                }
                break;

            case 'bounce':
                // Return random enemy creatures to hand (Tsunami effect)
                const enemyBoard2 = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const enemyHand = isCasterPlayer ? gameState.enemyHand : gameState.playerHand;
                const bounceable = enemyBoard2.filter(c => c.type === 'creature' && !c.abilities?.includes('hexproof'));
                const bounceCount = Math.min(2, bounceable.length);
                for (let i = 0; i < bounceCount; i++) {
                    if (bounceable.length > 0) {
                        const idx = Math.floor(gameplayRandom() * bounceable.length);
                        const target = bounceable[idx];
                        bounceable.splice(idx, 1);
                        enemyHand.push(asPrintedCard(target));
                        if (isCasterPlayer) {
                            gameState.enemyBoard = gameState.enemyBoard.filter(c => c.id !== target.id);
                        } else {
                            gameState.playerBoard = gameState.playerBoard.filter(c => c.id !== target.id);
                        }
                        showGameLog(`🌊 ${target.emoji} ${target.name} returns to hand!`, !isCasterPlayer);
                    }
                }
                break;

            case 'revive':
                // Return a creature from graveyard to battlefield
                const graveyard = isCasterPlayer ? gameState.playerGraveyard : gameState.enemyGraveyard;
                const board = isCasterPlayer ? gameState.playerBoard : gameState.enemyBoard;
                const reviveIndex = graveyard.map(c => c.type).lastIndexOf('creature');
                if (reviveIndex >= 0) {
                    const [revived] = graveyard.splice(reviveIndex, 1);
                    revived.damage = 0;
                    revived.tapped = false;
                    revived.id = nextCardInstanceId(); // New ID
                    revived.summoningSick = !revived.abilities?.includes('haste');
                    board.push(revived);
                    showGameLog(`⛪ ${revived.emoji} ${revived.name} is revived!`, !isCasterPlayer);
                    createSparkles(window.innerWidth / 2, window.innerHeight / 2, 20);
                } else {
                    showGameLog(`No creatures in graveyard to revive`, !isCasterPlayer);
                }
                break;

            case 'aoe':
                // Area damage to all enemy creatures
                const aoeBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                aoeBoard.forEach(c => {
                    if (c.type === 'creature') {
                        c.damage = (c.damage || 0) + card.value;
                    }
                });
                showGameLog(`💣 ${card.value} damage to all enemy creatures!`, !isCasterPlayer);
                shakeScreen();
                break;

            case 'mana':
                // Mana effects are passive and handled during upkeep
                showGameLog(`💎 Mana artifact activated!`, !isCasterPlayer);
                break;

            case 'token': {
                // Create token creatures (TOKEN_TYPES). Each token has its own keyword list.
                const tokenBoard = isCasterPlayer ? gameState.playerBoard : gameState.enemyBoard;
                const tokenCount = card.value || 1;
                const tokenType = TOKEN_TYPES[card.tokenType] || TOKEN_TYPES.default;

                for (let i = 0; i < tokenCount; i++) {
                    const printed = { power: tokenType.power, toughness: tokenType.toughness, abilities: [...tokenType.abilities] };
                    tokenBoard.push({
                        id: nextCardInstanceId(),
                        emoji: tokenType.emoji,
                        type: 'creature',
                        cardType: 'Creature Token',
                        name: tokenType.name,
                        ...printed,
                        abilities: [...tokenType.abilities],
                        printed,
                        cost: {},
                        tapped: false,
                        summoningSick: !tokenType.abilities.includes('haste'),
                        damage: 0,
                        theme: 'Fantasy'
                    });
                }

                showGameLog(`✨ Created ${tokenCount} ${tokenType.name}${tokenCount > 1 ? 's' : ''}!`, !isCasterPlayer);
                createSparkles(window.innerWidth / 2, window.innerHeight / 2, 20);
                break;
            }

            case 'discard':
                // Force opponent to discard cards
                const discardHand = isCasterPlayer ? gameState.enemyHand : gameState.playerHand;
                const discardCount = Math.min(card.value || 1, discardHand.length);

                for (let i = 0; i < discardCount; i++) {
                    if (discardHand.length > 0) {
                        const randomIndex = Math.floor(gameplayRandom() * discardHand.length);
                        const discarded = discardHand.splice(randomIndex, 1)[0];
                        moveCardToGraveyard(discarded, isCasterPlayer ? 'enemy' : 'player');
                        showGameLog(`🗑️ ${discarded.emoji} ${discarded.name} is discarded!`, isCasterPlayer);
                    }
                }
                break;

            case 'discard_draw':
                // Opponent discards, caster draws. The draw happens even if they had nothing to discard.
                const discardHand2 = isCasterPlayer ? gameState.enemyHand : gameState.playerHand;
                const discardDrawCount = card.value || 1;

                for (let i = 0; i < discardDrawCount; i++) {
                    if (discardHand2.length > 0) {
                        const randomIndex = Math.floor(gameplayRandom() * discardHand2.length);
                        const discarded = discardHand2.splice(randomIndex, 1)[0];
                        moveCardToGraveyard(discarded, isCasterPlayer ? 'enemy' : 'player');
                        showGameLog(`🗑️ ${discarded.emoji} ${discarded.name} is discarded!`, isCasterPlayer);
                    }
                    drawCard(caster);
                }
                showGameLog(`📜 ${isCasterPlayer ? 'You' : 'Enemy'} draw ${discardDrawCount} card${discardDrawCount > 1 ? 's' : ''}`, !isCasterPlayer);
                break;

            default:
                showGameLog(`${card.emoji} ${card.name} effect resolved`, !isCasterPlayer);
                break;
        }
    }

    function enterAttackPhase() {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        // Turn enforcement: Only allow during player's turn and main phase
        if (gameState.turn !== 'player' || gameState.phase !== 'main') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        if (isProcessingAction) {
            return; // Silently block during processing
        }

        // SAFETY CHECK: Prevent entering attack phase if already in it
        if (attackPhase || gameState.phase === 'attack') {
            console.warn('Already in attack phase, ignoring');
            return;
        }

        // VIGILANCE FIX: Prevent multiple attacks per turn
        if (gameState.hasAttackedThisTurn) {
            showGameLog('⚠️ You have already attacked this turn!', false);
            return;
        }

        // Check if there are any untapped creatures that can attack
        const availableAttackers = gameState.playerBoard.filter(canAttack);

        if (availableAttackers.length === 0) {
            showGameLog('⚠️ You have no creatures available to attack!', false);
            return;
        }

        attackPhase = true;
        gameState.attackers = [];
        gameState.phase = 'attack';
        document.getElementById('phaseIndicator').textContent = 'DECLARE ATTACKERS';
        setAttackControls('select');
        updateUI();
    }

    // The two controls that change during attacker selection: ATTACK becomes CONFIRM (with the count) and
    // END TURN, which can't be used mid-attack, becomes CANCEL.
    function setAttackControls(mode) {
        const attackBtn = document.getElementById('attackBtn');
        const endTurnBtn = document.getElementById('endTurnBtn');
        if (!attackBtn || !endTurnBtn) return;
        const selecting = mode === 'select';
        attackBtn.classList.toggle('is-confirm', selecting);
        endTurnBtn.classList.toggle('is-cancel', selecting);
        if (selecting) {
            const n = gameState.attackers.length;
            attackBtn.innerHTML = `<span class="btn-text">✓ CONFIRM ${n}</span>`;
            attackBtn.setAttribute('aria-label', n ? `Confirm attack with ${n} creature${n === 1 ? '' : 's'}` : 'Confirm: no attack');
            attackBtn.onclick = confirmAttackers;
            endTurnBtn.innerHTML = '<span class="btn-text">✕ CANCEL</span>';
            endTurnBtn.setAttribute('aria-label', 'Cancel the attack');
            endTurnBtn.onclick = cancelAttack;
        } else {
            attackBtn.innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
            attackBtn.removeAttribute('aria-label');
            attackBtn.onclick = enterAttackPhase;
            endTurnBtn.innerHTML = '<span class="btn-text">END TURN</span>';
            endTurnBtn.removeAttribute('aria-label');
            endTurnBtn.onclick = endTurn;
        }
    }

    // Leave attacker selection without attacking: the attack is still available this turn
    function cancelAttack() {
        if (!attackPhase || gameState.turn !== 'player' || isProcessingAction) return;
        attackPhase = false;
        gameState.attackers = [];
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        setAttackControls('idle');
        showGameLog('↩️ Attack cancelled', false);
        updateUI();
    }

    // Why a creature can't attack right now, or null if it can (RULES.md C1).
    function getAttackRestriction(card) {
        if (!card || card.type !== 'creature') return 'is not a creature';
        if (card.tapped) return 'is tapped';
        if (hasAbility(card, 'defender')) return "is a Defender and can't attack";
        if (card.summoningSick && !hasAbility(card, 'haste')) return 'has summoning sickness: it can attack next turn';
        return null;
    }

    function canAttack(card) {
        return getAttackRestriction(card) === null;
    }

    function selectAttacker(cardId) {
        if (gamePaused) return;
        if (gameState.matchFinalized || !attackPhase) return;

        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card) return;
        const restriction = getAttackRestriction(card);
        if (restriction) {
            showGameLog(`⚠️ ${card.name} ${restriction}`, false);
            return;
        }

        if (gameState.attackers.includes(cardId)) {
            gameState.attackers = gameState.attackers.filter(id => id !== cardId);
        } else {
            gameState.attackers.push(cardId);
        }
        playSFX('select');
        haptic('select');

        updateUI();
    }

    function confirmAttackers() {
        if (gameState.matchFinalized) {
            return;
        }

        // Turn enforcement
        if (gameState.turn !== 'player' || isProcessingAction) {
            return;
        }

        if (gameState.attackers.length === 0) {
            attackPhase = false;
            gameState.phase = 'main';
            document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
            setAttackControls('idle');
            showGameLog('🛡️ You choose not to attack', false);
            updateUI();
            return;
        }

        // VIGILANCE FIX: Mark that player has attacked this turn
        gameState.hasAttackedThisTurn = true;

        // Set processing lock (with 5 second failsafe for combat)
        setProcessingLock(5000);

        playSFX('attack');
        haptic('impact');
        showGameLog(`⚔️ You attack with ${gameState.attackers.length} creature${gameState.attackers.length > 1 ? 's' : ''}!`, false);

        // AI declares blockers
        aiDeclareBlockers();
        const combatPairs = gameState.attackers
            .map(id => gameState.playerBoard.find(c => c.id === id))
            .filter(Boolean)
            .map(attacker => ({
                attacker,
                blockers: (gameState.blockers[attacker.id] || []).map(id => gameState.enemyBoard.find(c => c.id === id)).filter(Boolean)
            }));

        // Resolve combat
        resolveCombat();
        reportCombat(combatPairs, 'player');

        attackPhase = false;
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        setAttackControls('idle');

        checkGameOver();
        updateUI();

        // Release processing lock after combat resolves
        matchDelay(() => {
            releaseProcessingLock();
        }, 300);
    }

    function hasAbility(creature, ability) {
        return creature?.abilities?.includes(ability);
    }

    function canBlockAttacker(blocker, attacker) {
        if (!blocker || blocker.type !== 'creature' || blocker.tapped) return false;
        if (hasAbility(attacker, 'unblockable')) return false;
        if (hasAbility(attacker, 'flying') && !hasAbility(blocker, 'flying') && !hasAbility(blocker, 'reach')) {
            return false;
        }
        return true;
    }

    function assignAutoBlockers(attackers, defendingBoard) {
        const blockers = {};
        const usedBlockers = new Set();

        attackers.forEach(attacker => {
            const legalBlockers = defendingBoard
                .filter(candidate => !usedBlockers.has(candidate.id) && canBlockAttacker(candidate, attacker))
                .sort((a, b) => b.toughness - a.toughness);

            const requiredBlockers = hasAbility(attacker, 'menace') ? 2 : 1;
            if (legalBlockers.length >= requiredBlockers) {
                blockers[attacker.id] = legalBlockers.slice(0, requiredBlockers).map(c => c.id);
                blockers[attacker.id].forEach(id => usedBlockers.add(id));
            }
        });

        return blockers;
    }

    // Where combat life changes go. Real combat uses the live totals; previewCombat passes its own copy, so the
    // preview runs these exact damage rules without touching the game.
    const LIVE_COMBAT_LIFE = {
        player: amount => changePlayerLife(amount),
        enemy: amount => changeEnemyLife(amount)
    };

    function applyDamage(attacker, blockers, isPlayerAttacking, life = LIVE_COMBAT_LIFE) {
        const adjustLifeByController = (isPlayerControlled, amount) => {
            if (amount <= 0) return;
            if (isPlayerControlled) {
                life.player(amount);
            } else {
                life.enemy(amount);
            }
        };

        const dealCombatDamage = (source, target, amount, sourceIsPlayerControlled) => {
            if (!source || !target || amount <= 0) return 0;

            const damageAlreadyMarked = target.damage || 0;
            const toughnessRemaining = Math.max(0, target.toughness - damageAlreadyMarked);
            const dealtDamage = Math.min(amount, toughnessRemaining);

            target.damage = damageAlreadyMarked + dealtDamage;

            if (hasAbility(source, 'deathtouch') && dealtDamage > 0) {
                target.damage = Math.max(target.damage, target.toughness);
            }

            if (hasAbility(source, 'lifelink') && dealtDamage > 0) {
                adjustLifeByController(sourceIsPlayerControlled, dealtDamage);
            }

            return dealtDamage;
        };

        const attackerHasFirstStrike = hasAbility(attacker, 'first_strike') || hasAbility(attacker, 'double_strike');
        const blockersHaveFirstStrike = blockers.some(b => hasAbility(b, 'first_strike') || hasAbility(b, 'double_strike'));
        const combatHasFirstStrikeStep = attackerHasFirstStrike || blockersHaveFirstStrike;

        const runDamageStep = (isFirstStrikeStep) => {
            const livingBlockers = blockers.filter(b => (b.damage || 0) < b.toughness);
            const attackerAlive = (attacker.damage || 0) < attacker.toughness;
            if (!attackerAlive) return;

            const attackerDealsNow = hasAbility(attacker, 'double_strike') ||
                (hasAbility(attacker, 'first_strike') ? isFirstStrikeStep : !isFirstStrikeStep);

            if (attackerDealsNow) {
                let remainingAttackDamage = attacker.power || 0;

                livingBlockers.forEach((blocker, index) => {
                    if (remainingAttackDamage <= 0) return;

                    const blockerDamage = blocker.damage || 0;
                    const lethalDamage = hasAbility(attacker, 'deathtouch')
                        ? ((blockerDamage < blocker.toughness) ? 1 : 0)
                        : Math.max(0, blocker.toughness - blockerDamage);

                    const isLastBlocker = index === livingBlockers.length - 1;
                    const assignedDamage = hasAbility(attacker, 'trample')
                        ? Math.min(remainingAttackDamage, lethalDamage)
                        : (isLastBlocker ? remainingAttackDamage : Math.min(remainingAttackDamage, lethalDamage));

                    if (assignedDamage > 0) {
                        dealCombatDamage(attacker, blocker, assignedDamage, isPlayerAttacking);
                        remainingAttackDamage -= assignedDamage;
                    }
                });

                if (remainingAttackDamage > 0 && hasAbility(attacker, 'trample')) {
                    if (isPlayerAttacking) {
                        life.enemy(-remainingAttackDamage);
                    } else {
                        life.player(-remainingAttackDamage);
                    }

                    if (hasAbility(attacker, 'lifelink')) {
                        adjustLifeByController(isPlayerAttacking, remainingAttackDamage);
                    }
                }
            }

            livingBlockers.forEach((blocker) => {
                const blockerDealsNow = hasAbility(blocker, 'double_strike') ||
                    (hasAbility(blocker, 'first_strike') ? isFirstStrikeStep : !isFirstStrikeStep);
                if (blockerDealsNow) {
                    dealCombatDamage(blocker, attacker, blocker.power || 0, !isPlayerAttacking);
                }
            });
        };

        if (combatHasFirstStrikeStep) {
            runDamageStep(true);
        }
        runDamageStep(false);

        // Trample and lifelink are processed within each combat damage step.
    }

    // An unblocked attacker hits the defending player; Double Strike hits twice (RULES.md C4, C6).
    function dealUnblockedDamage(attacker, isPlayerAttacking, life = LIVE_COMBAT_LIFE) {
        const hits = hasAbility(attacker, 'double_strike') ? 2 : 1;
        const power = attacker.power || 0;
        for (let i = 0; i < hits; i++) {
            if (isPlayerAttacking) {
                life.enemy(-power);
            } else {
                life.player(-power);
            }
            if (hasAbility(attacker, 'lifelink')) {
                if (isPlayerAttacking) {
                    life.player(power);
                } else {
                    life.enemy(power);
                }
            }
        }
    }

    // What an attack would do, by the same rules as the real thing: the automatic blocks (assignAutoBlockers),
    // then applyDamage / dealUnblockedDamage for each attacker in declared order, deaths checked afterwards
    // (as checkStateBasedActions does). It works on copies of the creatures and of the life totals, so it never
    // changes cards, life, mana, randomness, timers or rewards. The life copies follow the live life rules:
    // never below 0, and nothing changes once a side has lost (the match would be over).
    function previewCombat(attackers, defendingBoard, isPlayerAttacking) {
        const copy = card => ({ ...card, abilities: [...(card.abilities || [])] });
        const attackerCopies = attackers.filter(Boolean).map(copy);
        const blockerCopies = defendingBoard.filter(c => c.type === 'creature' && !c.tapped).map(copy);
        const blocks = assignAutoBlockers(attackerCopies, blockerCopies);
        const totals = { player: gameState.playerLife, enemy: gameState.enemyLife, result: gameState.matchFinalized ? 'over' : null };
        const change = (side, amount) => {
            if (totals.result) return;
            totals[side] = Math.max(0, totals[side] + amount);
            // checkGameOver looks at the player first
            if (totals.player <= 0) totals.result = 'loss';
            else if (totals.enemy <= 0) totals.result = 'win';
        };
        const life = { player: amount => change('player', amount), enemy: amount => change('enemy', amount) };
        const dies = card => (card.damage || 0) >= card.toughness;

        const pairs = attackerCopies.map(attacker => {
            const blockers = (blocks[attacker.id] || []).map(id => blockerCopies.find(b => b.id === id)).filter(Boolean);
            const before = { player: totals.player, enemy: totals.enemy };
            if (blockers.length > 0) {
                applyDamage(attacker, blockers, isPlayerAttacking, life);
            } else {
                dealUnblockedDamage(attacker, isPlayerAttacking, life);
            }
            return { attacker, blockers, lifeChange: { player: totals.player - before.player, enemy: totals.enemy - before.enemy } };
        });

        return {
            isPlayerAttacking,
            blocks,
            pairs: pairs.map(({ attacker, blockers, lifeChange }) => ({
                attackerId: attacker.id,
                blockerIds: blockers.map(b => b.id),
                attackerDies: dies(attacker),
                attackerDamage: attacker.damage || 0,
                blockersDie: blockers.filter(dies).map(b => b.id),
                blockerDamage: Object.fromEntries(blockers.map(b => [b.id, b.damage || 0])),
                lifeChange
            })),
            life: { player: totals.player, enemy: totals.enemy },
            deaths: [...attackerCopies, ...blockerCopies].filter(dies).map(c => c.id),
            result: totals.result === 'over' ? null : totals.result
        };
    }

    function aiDeclareBlockers() {
        const availableBlockers = gameState.enemyBoard.filter(c => c.type === 'creature' && !c.tapped);
        const attackingCreatures = gameState.attackers
            .map(attackerId => gameState.playerBoard.find(c => c.id === attackerId))
            .filter(Boolean);

        gameState.blockers = assignAutoBlockers(attackingCreatures, availableBlockers);

        if (Object.keys(gameState.blockers).length > 0) {
            playSFX('block');
        }
    }

    function resolveCombat() {
        const attackers = gameState.attackers.map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean);
        resolveAttackersWithHistory(attackers, attacker => (gameState.blockers[attacker.id] || [])
            .map(id => gameState.enemyBoard.find(c => c.id === id)).filter(Boolean), true);
        gameState.attackers = [];
        gameState.blockers = {};
    }

    // End Turn
    function endTurn() {
        if (gamePaused) return;
        if (gameState.matchFinalized) {
            return;
        }

        // Turn enforcement: Only allow ending turn during player's turn and main phase
        if (gameState.turn !== 'player' || gameState.phase === 'enemy') {
            showGameLog('⚠️ Wait for your turn!', false);
            return;
        }

        // Cannot end turn during attack phase
        if (gameState.phase === 'attack' || attackPhase) {
            showGameLog('⚠️ Complete or cancel your attack first!', false);
            return;
        }

        // Prevent double-clicking end turn
        if (isProcessingAction) {
            return;
        }

        // Set processing lock for turn transition (with 10 second failsafe)
        setProcessingLock(10000);

        // Disable mulligan after first turn
        if (!playerFirstTurnCompleted) {
            playerFirstTurnCompleted = true;
            document.getElementById('mulliganBtn').disabled = true;
            document.getElementById('mulliganBtn').style.opacity = '0.5';
        }

        // Show end turn message
        showGameLog('✅ You end your turn', false);

        // Permanents stay tapped until the start of your next turn (RULES.md R5.3)

        // Reset mana
        gameState.playerMana = {};

        // CRITICAL FIX: Reset land counter at end of turn (safety check)
        gameState.landsPlayedThisTurn = 0;

        // VIGILANCE FIX: Reset attack flag for next turn
        gameState.hasAttackedThisTurn = false;

        // Clear temporary combat damage at end of turn
        clearCombatDamage();
        clearEndOfTurnEffects();

        gameState.turn = 'enemy';
        gameState.phase = 'enemy';
        aiStatusText = 'Starting its turn';
        enemyTurnStartIds = new Set(gameState.enemyBoard.map(c => c.id));
        enemyCombatMarks = { attackers: new Set(), blockers: new Set() };
        document.getElementById('phaseIndicator').textContent = 'ENEMY TURN';
        document.getElementById('gameContainer').classList.add('enemy-turn');

        updateUI();

        // AI turn (skipped if this match was left in the meantime)
        const serial = matchSerial;
        matchDelay(() => {
            if (serial === matchSerial) aiTurn();
        }, 1500);
    }

    // Process upkeep effects for artifacts
    function processUpkeepEffects(isPlayer) {
        const board = isPlayer ? gameState.playerBoard : gameState.enemyBoard;
        const artifacts = board.filter(c => c.type === 'artifact');
        const outcomeBefore = { deck: gameState.playerDeck.length, enemyLife: gameState.enemyLife };

        withLifeSource('upkeep', () => artifacts.forEach(artifact => {
            if (gameState.matchFinalized) return;
            const snap = snapshotForHistory();
            switch(artifact.effect) {
                case 'draw':
                    // Artifacts like Crown of Power or Dark Scroll
                    for (let i = 0; i < (artifact.value || 1); i++) {
                        drawCard(isPlayer ? 'player' : 'enemy');
                    }
                    showGameLog(`${artifact.emoji} ${artifact.name} draws a card!`, !isPlayer);
                    break;

                case 'heal':
                    // Artifacts like Holy Chalice
                    if (isPlayer) {
                        changePlayerLife(artifact.value || 1);
                    } else {
                        changeEnemyLife(artifact.value || 1);
                    }
                    showGameLog(`${artifact.emoji} ${artifact.name} heals ${artifact.value || 1} life!`, !isPlayer);
                    break;

                case 'damage':
                    // Artifacts like Cursed Orb
                    if (isPlayer) {
                        changeEnemyLife(-(artifact.value || 1));
                    } else {
                        changePlayerLife(-(artifact.value || 1));
                    }
                    showGameLog(`${artifact.emoji} ${artifact.name} deals ${artifact.value || 1} damage!`, !isPlayer);
                    break;
            }
            const changes = describeChangesSince(snap);
            if (changes.length) recordHistory(isPlayer ? 'player' : 'enemy', `${cardLabel(artifact)} at the start of the turn`, changes);
        }));
        if (artifacts.length) {
            reportAchievement('upkeep', {
                side: isPlayer ? 'player' : 'enemy',
                drawn: isPlayer ? Math.max(0, outcomeBefore.deck - gameState.playerDeck.length) : 0,
                enemyLifeChange: gameState.enemyLife - outcomeBefore.enemyLife
            });
        }
    }

    // Start player turn
    function startPlayerTurn() {
        if (gameState.matchFinalized) {
            releaseProcessingLock();
            return;
        }

        document.getElementById('gameContainer').classList.remove('enemy-turn');
        enemyCombatMarks = { attackers: new Set(), blockers: new Set() };

        gameState.turn = 'player';
        gameState.phase = 'main';
        gameState.round = (gameState.round || 1) + 1;
        aiStatusText = '';
        recordHistory('player', `🔔 Turn ${gameState.round}: your turn`);
        reportAchievement('turn:start', { side: 'player', round: gameState.round });
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';

        // CRITICAL FIX: Ensure attack phase is reset and button is restored
        attackPhase = false;
        gameState.attackers = [];
        setAttackControls('idle');

        // Draw card at start of turn
        drawCard('player');
        if (gameState.matchFinalized) return;
        showGameLog('📜 You draw a card', false);

        // Process upkeep effects from artifacts
        processUpkeepEffects(true);
        if (gameState.matchFinalized) return;

        // Untap and reset mana
        gameState.playerBoard.forEach(untapAtTurnStart);
        gameState.playerMana = {};

        // Reset land counter for new turn
        gameState.landsPlayedThisTurn = 0;

        // Clear temporary combat damage and "until end of turn" bonuses from the enemy turn
        clearCombatDamage();
        clearEndOfTurnEffects();

        updateUI();

        // Release processing lock - player can now take actions
        releaseProcessingLock();
    }

    // The AI plays a creature, artifact or instant from its hand, through the same resolution as the player.
    // Returns the id of the permanent it put on the battlefield, if any.
    function aiPlayCard(card) {
        const snap = snapshotForHistory();
        payCost(card.cost, gameState.enemyMana);
        gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== card.id);
        setAiStatus(`${card.type === 'instant' ? 'Casting' : 'Playing'} ${cardLabel(card)}`);
        let playedId = null;

        if (card.type === 'creature') {
            gameState.enemyBoard.push({...card, tapped: false, summoningSick: !card.abilities?.includes('haste'), damage: 0});
            showGameLog(`${card.emoji} Enemy summons ${card.name}`, true, card.theme === 'scifi');
            GameFeedback.play('summon', { variant: card.theme === 'Science Fiction' ? 'scifi' : 'fantasy' });
            playedId = card.id;
        } else if (card.type === 'artifact') {
            const artifactOnBoard = {...card, tapped: false};
            gameState.enemyBoard.push(artifactOnBoard);
            showGameLog(`${card.emoji} Enemy plays ${card.name}`, true);
            GameFeedback.play('artifact');
            resolveArtifactOnPlay(artifactOnBoard, 'enemy');
            playedId = artifactOnBoard.id;
        } else {
            showGameLog(`${card.emoji} Enemy casts ${card.name}`, true);
            GameFeedback.play('spell');
            castInstant(card, 'enemy');
        }

        const verb = { creature: 'summons', artifact: 'plays', instant: 'casts' }[card.type] || 'plays';
        recordHistory('enemy', `${card.emoji} Enemy ${verb} ${card.name}`, describeChangesSince(snap, { playedFrom: 'enemy', playedId: playedId ?? card.id }));
        return playedId;
    }

    // The AI holds a two-sided sweeper (Earthquake, Avalanche) unless it kills more of your creatures than
    // of its own.
    // AI difficulty profiles (AI.md §3). Every level plays by exactly the same rules and deck rules as you;
    // they differ only in how many cards they play a turn and how carefully they choose.
    const AI_PROFILES = {
        easy: { maxPlays: 1, castsInstants: false, seesLethal: false, attacks: 'random', keepsBlockers: false },
        medium: { maxPlays: 2, castsInstants: true, seesLethal: true, attacks: 'careful', keepsBlockers: false },
        hard: { maxPlays: Infinity, castsInstants: true, seesLethal: true, attacks: 'careful', keepsBlockers: true }
    };

    function getAiProfile() {
        return AI_PROFILES[gameState.difficulty] || AI_PROFILES.easy;
    }

    const aiManaValue = card => Object.values(card.cost || {}).reduce((sum, n) => sum + n, 0);
    const aiCreatures = board => board.filter(c => c.type === 'creature');

    // Would this card do anything right now? Uses the same targeting rules as resolveSpell (EFFECTS.md E2),
    // so the AI never wastes a card on nothing, and never draws itself out of cards (RULES.md R6.1).
    function aiWantsToCast(card) {
        const targetable = aiCreatures(gameState.playerBoard).filter(c => !c.abilities?.includes('hexproof'));
        const drawsWouldDeckOut = n => gameState.enemyDeck.length <= n;
        switch (card.effect) {
            case 'damage':
                if (card.target !== 'all') return true;
                {
                    // Two-sided sweepers only when they kill more of your creatures than its own
                    const kills = board => board.filter(c => c.type === 'creature' && (c.damage || 0) + card.value >= c.toughness).length;
                    return kills(gameState.playerBoard) > kills(gameState.enemyBoard);
                }
            case 'buff':
            case 'buff_defense':
                return aiCreatures(gameState.enemyBoard).length > 0;
            case 'destroy':
            case 'bounce':
                return targetable.length > 0;
            case 'tap':
                return card.skipUntap ? targetable.length > 0 : targetable.some(c => !c.tapped);
            case 'revive':
                return gameState.enemyGraveyard.some(c => c.type === 'creature');
            case 'discard':
                return gameState.playerHand.length > 0;
            case 'aoe':
                return aiCreatures(gameState.playerBoard).length > 0;
            case 'draw':
                // An upkeep draw artifact draws every turn; an instant draws once.
                return !drawsWouldDeckOut(card.type === 'artifact' ? 3 : (card.value || 1));
            case 'draw_on_play':
            case 'discard_draw':
                return !drawsWouldDeckOut(card.value || 1);
            case 'heal_draw':
                return !drawsWouldDeckOut(card.drawCards || 1);
            default:
                return true;
        }
    }

    // Land drop: first the land that lets the most cards be cast this turn, then the colour the hand needs
    // most (a colour it can't make yet counts extra).
    function aiChooseLand() {
        const lands = gameState.enemyHand.filter(c => c.type === 'land');
        if (lands.length <= 1) return lands[0] || null;
        const colorsOf = land => land.elements?.length ? land.elements : (land.element ? [land.element] : []);
        const onBoard = new Set(gameState.enemyBoard.filter(c => c.type === 'land').flatMap(colorsOf));
        const spells = gameState.enemyHand.filter(c => c.type !== 'land');
        const basePool = {};
        gameState.enemyBoard.forEach(c => {
            if (c.type === 'land' && colorsOf(c).length === 1) basePool[colorsOf(c)[0]] = (basePool[colorsOf(c)[0]] || 0) + 1;
            if (c.type === 'artifact' && c.effect === 'mana') basePool.colorless = (basePool.colorless || 0) + (c.value || 1);
        });
        const castableNow = land => Math.max(...colorsOf(land).map(el => {
            const pool = { ...basePool, [el]: (basePool[el] || 0) + 1 };
            return spells.filter(c => canPayCost(c.cost, pool)).length;
        }), 0);
        const need = {};
        spells.forEach(card => {
            Object.keys(card.cost || {}).filter(el => el !== 'colorless').forEach(el => { need[el] = (need[el] || 0) + 1; });
        });
        const needScore = land => Math.max(0, ...colorsOf(land).map(el => (need[el] || 0) + (need[el] && !onBoard.has(el) ? 5 : 0)));
        const score = land => castableNow(land) * 100 + needScore(land);
        return lands.reduce((best, land) => (score(land) > score(best) ? land : best), lands[0]);
    }

    // Tap every mana source, as before; a land that makes several colours picks the colour that lets the
    // most cards in hand be cast (it used to always pick its first colour).
    function aiTapManaSources() {
        let tapped = false;
        const flexible = [];
        gameState.enemyBoard.forEach(card => {
            if (card.tapped) return;
            if (card.type === 'land') {
                if (card.elements?.length > 1) { flexible.push(card); return; }
                const element = card.element || card.elements?.[0];
                if (!element) return;
                card.tapped = true;
                gameState.enemyMana[element] = (gameState.enemyMana[element] || 0) + 1;
                tapped = true;
            } else if (card.type === 'artifact' && card.effect === 'mana') {
                // Mana artifacts, as for the player (activateArtifact)
                card.tapped = true;
                gameState.enemyMana.colorless = (gameState.enemyMana.colorless || 0) + (card.value || 1);
                tapped = true;
            }
        });
        const castableWith = pool => gameState.enemyHand.filter(c => c.type !== 'land' && canPayCost(c.cost, pool)).length;
        flexible.forEach(land => {
            const best = land.elements.reduce((choice, element) => {
                const pool = { ...gameState.enemyMana, [element]: (gameState.enemyMana[element] || 0) + 1 };
                const value = castableWith(pool);
                return value > choice.value ? { element, value } : choice;
            }, { element: land.elements[0], value: -1 });
            land.tapped = true;
            gameState.enemyMana[best.element] = (gameState.enemyMana[best.element] || 0) + 1;
            tapped = true;
        });
        return tapped;
    }

    // How much the AI wants to play a card now. Higher mana value breaks ties so the mana gets used.
    function scoreAiPlay(card) {
        const playerCreatures = aiCreatures(gameState.playerBoard);
        const strongest = playerCreatures.reduce((max, c) => Math.max(max, (c.power || 0) + (c.toughness || 0)), 0);
        let score = 0;
        if (card.type === 'creature') {
            score = (card.power || 0) + (card.toughness || 0) + (card.abilities?.length || 0);
        } else if (card.effect === 'damage' && card.target !== 'all') {
            score = (card.value || 0) + (card.value >= gameState.playerLife ? 100 : 0);
        } else if (['destroy', 'bounce'].includes(card.effect) || (card.effect === 'damage' && card.target === 'all') || card.effect === 'aoe') {
            score = 4 + strongest;
        } else if (['buff', 'buff_defense'].includes(card.effect)) {
            score = 2 + (card.value || 0) * (card.targetAll ? aiCreatures(gameState.enemyBoard).length : 1);
        } else if (card.type === 'artifact') {
            score = 4;
        } else {
            score = 2 + (card.value || 0);
        }
        return score + aiManaValue(card) * 0.5;
    }

    // The next card the AI plays this turn, or null.
    function aiChooseNextPlay(profile) {
        const candidates = gameState.enemyHand.filter(card =>
            (card.type === 'creature' || card.type === 'artifact' || (card.type === 'instant' && profile.castsInstants)) &&
            canPayCost(card.cost, gameState.enemyMana) && aiWantsToCast(card));
        if (!candidates.length) return null;
        // Lethal burn first (medium and hard)
        if (profile.seesLethal) {
            const lethal = candidates.find(c => c.type === 'instant' && c.effect === 'damage' && c.target !== 'all' && c.value >= gameState.playerLife);
            if (lethal) return lethal;
        }
        return candidates.sort((a, b) => scoreAiPlay(b) - scoreAiPlay(a))[0];
    }

    // AI Turn
    function aiTurn() {
        if (gameState.matchFinalized) {
            releaseProcessingLock();
            return;
        }

        // Delayed steps below stop if the match ends or is left mid-turn (RULES.md R7.4)
        const serial = matchSerial;
        let emergencyTurnStart = null;
        // A stale turn also cancels the failsafe below (it used to fire 12 s after every AI win).
        const turnIsStale = () => {
            const stale = gameState.matchFinalized || serial !== matchSerial;
            if (stale) clearMatchDelay(emergencyTurnStart);
            return stale;
        };

        // Emergency failsafe: ensure player turn starts even if something goes wrong
        emergencyTurnStart = matchDelay(() => {
            if (gameState.matchFinalized || serial !== matchSerial || gameState.turn !== 'enemy') return;
            console.warn('Emergency turn transition triggered');
            startPlayerTurn();
        }, 12000); // 12 seconds maximum for AI turn

        try {
            setAiStatus('Drawing a card');
            recordHistory('enemy', '🤖 Enemy turn');

            // Untap enemy permanents
            gameState.enemyBoard.forEach(untapAtTurnStart);
            gameState.enemyMana = {};

            // Draw card
            drawCard('enemy');
            if (turnIsStale()) return;
            showGameLog('🎴 Enemy draws a card', true);

            // Process upkeep effects from enemy artifacts
            processUpkeepEffects(false);
            if (turnIsStale()) return;

            matchDelay(() => {
            if (turnIsStale()) return;
            // Play lands
            const landInHand = aiChooseLand();
            setAiStatus(landInHand ? `Playing a land: ${cardLabel(landInHand)}` : 'No land to play');
            if (landInHand) {
                gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== landInHand.id);
                gameState.enemyBoard.push({...landInHand, tapped: false});
                showGameLog(`🌍 Enemy plays ${landInHand.name}`, true);
                recordHistory('enemy', `🌍 Enemy plays ${landInHand.name}`);
                updateUI();
                const enemyLandEl = document.querySelector(`#enemyBoard .card[data-card-id="${landInHand.id}"]`) ||
                    document.querySelector(`#enemyBoard .card[data-id="${landInHand.id}"]`) ||
                    document.getElementById(`card-enemy-${landInHand.id}`);
                applyJuice(enemyLandEl || document.getElementById('enemyBoard'), 'juice-pop');
            }

            matchDelay(() => {
                if (turnIsStale()) return;
                // Tap lands and mana artifacts for mana
                setAiStatus('Tapping mana');
                const manaTapped = aiTapManaSources();
                if (!manaTapped) setAiStatus('Choosing what to play');

                if (manaTapped) {
                    showGameLog('⚡ Enemy taps lands for mana', true);
                    updateUI();
                }

                matchDelay(() => {
                    if (turnIsStale()) return;
                    const applyOldMainPhaseBehavior = () => {
                        const playableCreatures = gameState.enemyHand
                            .filter(c => c.type === 'creature' && canPayCost(c.cost, gameState.enemyMana))
                            .sort((a, b) => {
                                if (gameState.difficulty === 'easy') {
                                    return 0;
                                } else if (gameState.difficulty === 'medium') {
                                    return (b.power + b.toughness) - (a.power + a.toughness);
                                } else {
                                    const effA = (a.power + a.toughness) / Object.values(a.cost).reduce((sum, v) => sum + v, 0);
                                    const effB = (b.power + b.toughness) / Object.values(b.cost).reduce((sum, v) => sum + v, 0);
                                    return effB - effA;
                                }
                            });

                        let creaturePlayed = false;
                        const playedEnemyCreatureIds = [];
                        playableCreatures.forEach(creature => {
                            if (canPayCost(creature.cost, gameState.enemyMana)) {
                                payCost(creature.cost, gameState.enemyMana);
                                gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== creature.id);
                                gameState.enemyBoard.push({...creature, tapped: false, summoningSick: !creature.abilities?.includes('haste'), damage: 0});
                                playedEnemyCreatureIds.push(creature.id);
                                showGameLog(`${creature.emoji} Enemy summons ${creature.name}`, true, creature.theme === 'scifi');
                                recordHistory('enemy', `${creature.emoji} Enemy summons ${creature.name}`);
                                creaturePlayed = true;
                            }
                        });

                        if (creaturePlayed) {
                            updateUI();
                            playedEnemyCreatureIds.forEach(playedId => {
                                const enemyCreatureEl = document.querySelector(`#enemyBoard .card[data-card-id="${playedId}"]`) ||
                                    document.querySelector(`#enemyBoard .card[data-id="${playedId}"]`) ||
                                    document.getElementById(`card-enemy-${playedId}`);
                                applyJuice(enemyCreatureEl || document.getElementById('enemyBoard'), 'juice-pop');
                            });
                        }

                        const playableArtifacts = gameState.enemyHand
                            .filter(c => c.type === 'artifact' && canPayCost(c.cost, gameState.enemyMana));

                        let artifactPlayed = false;
                        const playedEnemyArtifactIds = [];
                        playableArtifacts.forEach(artifact => {
                            if (canPayCost(artifact.cost, gameState.enemyMana)) {
                                payCost(artifact.cost, gameState.enemyMana);
                                gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== artifact.id);
                                const artifactOnBoard = {...artifact, tapped: false};
                                gameState.enemyBoard.push(artifactOnBoard);
                                playedEnemyArtifactIds.push(artifactOnBoard.id);
                                showGameLog(`${artifact.emoji} Enemy plays ${artifact.name}`, true);
                                const artifactSnap = snapshotForHistory();

                                resolveArtifactOnPlay(artifactOnBoard, 'enemy');
                                recordHistory('enemy', `${artifact.emoji} Enemy plays ${artifact.name}`, describeChangesSince(artifactSnap));

                                artifactPlayed = true;
                            }
                        });

                        if (artifactPlayed) {
                            updateUI();
                            playedEnemyArtifactIds.forEach(playedId => {
                                const enemyArtifactEl = document.querySelector(`#enemyBoard .card[data-card-id="${playedId}"]`) ||
                                    document.querySelector(`#enemyBoard .card[data-id="${playedId}"]`) ||
                                    document.getElementById(`card-enemy-${playedId}`);
                                applyJuice(enemyArtifactEl || document.getElementById('enemyBoard'), 'juice-pop');
                            });
                        }

                        if (gameState.difficulty === 'hard') {
                            const playableSpells = gameState.enemyHand
                                .filter(c => c.type === 'instant' && canPayCost(c.cost, gameState.enemyMana) && aiWantsToCast(c));

                            let spellPlayed = false;
                            playableSpells.forEach(spell => {
                                if (canPayCost(spell.cost, gameState.enemyMana)) {
                                    payCost(spell.cost, gameState.enemyMana);
                                    gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== spell.id);
                                    showGameLog(`${spell.emoji} Enemy casts ${spell.name}`, true);
                                    const spellSnap = snapshotForHistory();
                                    castInstant(spell, 'enemy');
                                    recordHistory('enemy', `${spell.emoji} Enemy casts ${spell.name}`, describeChangesSince(spellSnap));
                                    spellPlayed = true;
                                }
                            });

                            if (spellPlayed) {
                                updateUI();
                                applyJuice(document.getElementById('enemyBoard'), 'juice-pop');
                            }
                        }
                    };

                    // Steps that did nothing don't make you wait (AI.md §5)
                    let mainPhaseActed = true;
                    try {
                        const profile = getAiProfile();
                        const playedEnemyCardIds = [];
                        let playsMade = 0;

                        // Bounded: every play removes a card from a finite hand.
                        while (playsMade < profile.maxPlays && !gameState.matchFinalized) {
                            const best = aiChooseNextPlay(profile);
                            if (!best || !canPayCost(best.cost, gameState.enemyMana)) {
                                break;
                            }

                            const playedId = aiPlayCard(best);
                            if (playedId !== null) {
                                playedEnemyCardIds.push(playedId);
                            }

                            playsMade++;
                        }

                        mainPhaseActed = playsMade > 0;
                        if (!playsMade) setAiStatus('Plays nothing this turn');
                        if (playsMade > 0) {
                            updateUI();
                            playedEnemyCardIds.forEach(playedId => {
                                const enemyCardEl = document.querySelector(`#enemyBoard .card[data-card-id="${playedId}"]`) ||
                                    document.querySelector(`#enemyBoard .card[data-id="${playedId}"]`) ||
                                    document.getElementById(`card-enemy-${playedId}`);
                                applyJuice(enemyCardEl || document.getElementById('enemyBoard'), 'juice-pop');
                            });
                        }
                    } catch (aiScoringError) {
                        console.warn('AI scoring failed, using fallback behavior:', aiScoringError);
                        applyOldMainPhaseBehavior();
                    }

                        matchDelay(() => {
                            if (turnIsStale()) return;
                            const fallbackAttackers = gameState.enemyBoard.filter(canAttack);

                            let attackingCreatures = [];
                            try {
                                attackingCreatures = chooseEnemyAttackers(fallbackAttackers, gameState.difficulty);
                            } catch (attackSelectionError) {
                                console.warn('AI attack selection failed, using fallback behavior:', attackSelectionError);
                                if (gameState.difficulty === 'easy') {
                                    attackingCreatures = fallbackAttackers.filter(() => gameplayRandom() > 0.3);
                                } else {
                                    attackingCreatures = fallbackAttackers;
                                }
                            }

                            setAiStatus(attackingCreatures.length
                                ? `Attacking with ${attackingCreatures.length} creature${attackingCreatures.length === 1 ? '' : 's'}`
                                : 'Not attacking');
                            resolveEnemyAttackPhase(attackingCreatures);

                            updateUI();
                            checkGameOver();
                            // The attack status stays up through the pause before the player's turn

                            matchDelay(() => {
                                if (turnIsStale()) return;
                                clearMatchDelay(emergencyTurnStart); // Clear emergency failsafe
                                startPlayerTurn();
                            }, attackingCreatures.length ? 1500 : 500); // pacing: AI.md §5
                        }, mainPhaseActed ? 1500 : 300);
                    }, manaTapped ? 1000 : 300);
                }, landInHand ? 1500 : 300);
            }, 1000);
        } catch (error) {
            console.error('Error during AI turn:', error);
            clearMatchDelay(emergencyTurnStart);
            // Ensure turn transitions back to player even on error
            matchDelay(() => {
                if (serial === matchSerial) startPlayerTurn();
            }, 1000);
        }
    }


    function declarePlayerBlockers(enemyAttackers) {
        const availableBlockers = gameState.playerBoard.filter(c => c.type === 'creature' && !c.tapped);
        return assignAutoBlockers(enemyAttackers, availableBlockers);
    }

    // Attack choice (AI.md §3). Easy attacks at random. Medium and hard look at the block each attacker will
    // meet (blocking is automatic for both sides, RULES.md R5.4), take lethal when it is there, and skip
    // attacks that lose a creature for nothing. Hard also keeps blockers home when your board could kill it.
    const aiCardValue = card => Math.max(aiManaValue(card), ((card.power || 0) + (card.toughness || 0)) / 2);

    // One attacker against its blockers, by the combat rules (first strike, deathtouch, double strike).
    function aiBlockOutcome(attacker, blockers) {
        const strikesFirst = c => hasAbility(c, 'first_strike') || hasAbility(c, 'double_strike');
        const lethalTo = (source, target) => hasAbility(source, 'deathtouch') && (source.power || 0) > 0
            ? 1 : Math.max(0, (target.toughness || 0) - (target.damage || 0));
        let damage = (attacker.power || 0) * (hasAbility(attacker, 'double_strike') ? 2 : 1);
        const killed = [];
        [...blockers].sort((a, b) => b.toughness - a.toughness).forEach(b => {
            const need = lethalTo(attacker, b);
            if (damage >= need && need > 0) { killed.push(b); damage -= need; }
        });
        const attackerFirst = strikesFirst(attacker) && !blockers.some(strikesFirst);
        const hitters = attackerFirst ? blockers.filter(b => !killed.includes(b)) : blockers;
        const incoming = hitters.reduce((sum, b) => sum + (b.power || 0), 0);
        const attackerDies = hitters.some(b => hasAbility(b, 'deathtouch') && (b.power || 0) > 0) ||
            incoming >= (attacker.toughness || 0) - (attacker.damage || 0);
        // A blocker with first strike that kills the attacker first takes no damage.
        const blockersFirst = blockers.some(strikesFirst) && !strikesFirst(attacker);
        const reallyKilled = blockersFirst && attackerDies ? [] : killed;
        return { attackerDies, killedValue: reallyKilled.reduce((sum, b) => sum + aiCardValue(b), 0) };
    }

    // Damage that reaches the player if these creatures attack into the automatic blocks.
    function aiAttackDamage(attackers, blockers) {
        const blocks = assignAutoBlockers(attackers, blockers);
        return attackers.reduce((sum, a) => {
            const hits = hasAbility(a, 'double_strike') ? 2 : 1;
            const assigned = (blocks[a.id] || []).map(id => blockers.find(b => b.id === id)).filter(Boolean);
            if (!assigned.length) return sum + (a.power || 0) * hits;
            if (!hasAbility(a, 'trample')) return sum;
            const absorb = assigned.reduce((t, b) => t + (hasAbility(a, 'deathtouch') ? 1 : Math.max(0, b.toughness - (b.damage || 0))), 0);
            return sum + Math.max(0, (a.power || 0) * hits - absorb);
        }, 0);
    }

    function chooseEnemyAttackers(eligibleAttackers, difficulty) {
        if (!Array.isArray(eligibleAttackers) || eligibleAttackers.length === 0) {
            return [];
        }

        const profile = AI_PROFILES[difficulty] || AI_PROFILES.easy;
        if (profile.attacks === 'random') {
            return eligibleAttackers.filter(() => gameplayRandom() > 0.3);
        }

        const blockers = gameState.playerBoard.filter(c => c.type === 'creature' && !c.tapped);
        const ordered = aiBestAttackOrder(eligibleAttackers, blockers);

        // Game-ending attack: everything goes if the damage that gets through is lethal.
        if (aiAttackDamage(ordered, blockers) >= gameState.playerLife) {
            return ordered;
        }

        // Drop attackers that would die without taking something worth as much; re-check, because blocks
        // move to the next attacker when one stays home.
        let chosen = ordered;
        for (let pass = 0; pass < 4; pass++) {
            const blocks = assignAutoBlockers(chosen, blockers);
            const keep = chosen.filter(a => {
                const assigned = (blocks[a.id] || []).map(id => blockers.find(b => b.id === id)).filter(Boolean);
                if (!assigned.length) return true;
                const outcome = aiBlockOutcome(a, assigned);
                return !outcome.attackerDies || outcome.killedValue >= aiCardValue(a);
            });
            if (keep.length === chosen.length) break;
            chosen = keep;
        }

        // Hard: if your creatures could deal lethal next turn, keep enough blockers home.
        if (profile.keepsBlockers) {
            const yourAttackers = aiCreatures(gameState.playerBoard).filter(c => !hasAbility(c, 'defender'));
            const threat = yourAttackers.reduce((sum, c) => sum + (c.power || 0) * (hasAbility(c, 'double_strike') ? 2 : 1), 0);
            if (threat >= gameState.enemyLife) {
                const homeBlockers = () => aiCreatures(gameState.enemyBoard)
                    .filter(c => !c.tapped && (!chosen.includes(c) || hasAbility(c, 'vigilance'))).length;
                const sendable = chosen.filter(c => !hasAbility(c, 'vigilance')).sort((a, b) => b.toughness - a.toughness);
                while (homeBlockers() < yourAttackers.length && sendable.length) {
                    const stay = sendable.shift();
                    chosen = chosen.filter(c => c !== stay);
                }
            }
        }

        return aiBestAttackOrder(chosen, blockers);
    }

    // Blocks go toughest-blocker-first to attackers in the order they are declared (for both sides), so the
    // order decides which attacker gets blocked. Pick the order that lets the most damage through.
    function aiBestAttackOrder(attackers, blockers) {
        const byPower = [...attackers].sort((a, b) => (b.power || 0) - (a.power || 0));
        const orders = [byPower, [...byPower].reverse(), [...attackers]];
        return orders.reduce((best, order) => (aiAttackDamage(order, blockers) > aiAttackDamage(best, blockers) ? order : best), orders[0]);
    }

    function resolveEnemyAttackPhase(attackingCreatures) {
        if (attackingCreatures.length > 0) {
            showGameLog(`⚔️ Enemy attacks with ${attackingCreatures.length} creature${attackingCreatures.length > 1 ? 's' : ''}!`, true);
            showGameLog('🛡️ You declare blockers', false);
            playSFX('attack');
        } else {
            showGameLog('🛡️ Enemy does not attack', true);
            recordHistory('enemy', '🛡️ Enemy does not attack');
            return;
        }

        const playerBlockers = declarePlayerBlockers(attackingCreatures);
        enemyCombatMarks = {
            attackers: new Set(attackingCreatures.map(c => c.id)),
            blockers: new Set(Object.values(playerBlockers).flat())
        };
        if (Object.keys(playerBlockers).length > 0) {
            playSFX('block');
        }
        const combatPairs = attackingCreatures.map(attacker => ({
            attacker,
            blockers: (playerBlockers[attacker.id] || []).map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean)
        }));

        resolveAttackersWithHistory(attackingCreatures, attacker => (playerBlockers[attacker.id] || [])
            .map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean), false);
        const playerArea = document.querySelector('.player-area:not(.enemy-area)');
        const rect = playerArea.getBoundingClientRect();
        attackingCreatures.forEach(() => createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#dc143c', 30));
        reportCombat(combatPairs, 'enemy');
    }

    // Helper functions for lifepoint changes with sound and animation
    function changePlayerLife(amount) {
        if (gameState.matchFinalized) return;

        const oldLife = gameState.playerLife;
        gameState.playerLife = Math.max(0, gameState.playerLife + amount);
        const actualChange = gameState.playerLife - oldLife;
        if (actualChange !== 0) reportAchievement('life:changed', { side: 'player', amount, change: actualChange, before: oldLife, after: gameState.playerLife, source: lifeChangeSource });

        if (actualChange !== 0) {
            const lifeElement = document.getElementById('playerLife');
            const targetEl = lifeElement || document.querySelector('.player-area:not(.enemy-area)');
            const absChange = Math.abs(actualChange);

            if (targetEl) {
                spawnFloatingNumber({
                    targetEl,
                    text: actualChange > 0 ? `+${absChange}` : `-${absChange}`,
                    kind: actualChange < 0 ? 'damage' : 'heal'
                });
            }

            if (absChange >= 8) {
                screenShake('high');
            } else if (absChange >= 4) {
                screenShake('med');
            }

            const intensity = Math.min(1, absChange / 8);
            if (actualChange > 0) {
                GameFeedback.play('heal', { intensity });
                if (lifeElement) {
                    lifeElement.classList.add('life-increase');
                    matchDelay(() => lifeElement.classList.remove('life-increase'), 500);
                }
            } else {
                GameFeedback.play('damageTaken', { intensity });
                haptic('impact');
                if (lifeElement) {
                    lifeElement.classList.add('life-decrease');
                    matchDelay(() => lifeElement.classList.remove('life-decrease'), 300);
                }
            }

            checkGameOver();
            updateBattleMusicMood();
        }
    }

    function changeEnemyLife(amount) {
        if (gameState.matchFinalized) return;

        const oldLife = gameState.enemyLife;
        gameState.enemyLife = Math.max(0, gameState.enemyLife + amount);
        const actualChange = gameState.enemyLife - oldLife;
        if (actualChange !== 0) reportAchievement('life:changed', { side: 'enemy', amount, change: actualChange, before: oldLife, after: gameState.enemyLife, source: lifeChangeSource });

        if (actualChange !== 0) {
            const lifeElement = document.getElementById('enemyLife');
            const targetEl = lifeElement || document.querySelector('.enemy-area');
            const absChange = Math.abs(actualChange);

            if (targetEl) {
                spawnFloatingNumber({
                    targetEl,
                    text: actualChange > 0 ? `+${absChange}` : `-${absChange}`,
                    kind: actualChange < 0 ? 'damage' : 'heal'
                });
            }

            if (absChange >= 8) {
                screenShake('high');
            } else if (absChange >= 4) {
                screenShake('med');
            }

            const intensity = Math.min(1, absChange / 8);
            if (actualChange > 0) {
                GameFeedback.play('heal', { intensity });
                if (lifeElement) {
                    lifeElement.classList.add('life-increase');
                    matchDelay(() => lifeElement.classList.remove('life-increase'), 500);
                }
            } else {
                GameFeedback.play('damageDealt', { intensity });
                if (lifeElement) {
                    lifeElement.classList.add('life-decrease');
                    matchDelay(() => lifeElement.classList.remove('life-decrease'), 300);
                }
            }

            checkGameOver();
            updateBattleMusicMood();
        }
    }

    // Check Game Over
    // The player's loss is checked first, so a simultaneous loss counts against the player (RULES.md R7.2).
    function checkGameOver() {
        if (gameState.playerLife <= 0 || gameState.playerDeckedOut) {
            finalizeMatch('loss');
        } else if (gameState.enemyLife <= 0 || gameState.enemyDeckedOut) {
            finalizeMatch('win');
        }
    }

    var uiUpdateRafId = 0;
    var isUIUpdateScheduled = false;

    function scheduleUIUpdate() {
        if (isUIUpdateScheduled) return;
        isUIUpdateScheduled = true;

        const runner = () => {
            isUIUpdateScheduled = false;
            uiUpdateRafId = 0;
            performUIUpdate();
        };

        if (typeof requestAnimationFrame === 'function') {
            uiUpdateRafId = requestAnimationFrame(runner);
        } else {
            setTimeout(runner, 16);
        }
    }

    // Update UI
    function performUIUpdate() {
        // The attack preview first: board cards show their predicted part in it
        refreshCombatPreview();

        // Update life totals
        document.getElementById('playerLife').textContent = gameState.playerLife;
        document.getElementById('enemyLife').textContent = gameState.enemyLife;
        updateBattleMusicMood();

        // Update deck counters
        updateDeckCounters();

        // Update mana pools
        updateManaDisplay('playerMana', gameState.playerMana);
        updateManaDisplay('enemyMana', gameState.enemyMana);

        // Update player hand
        const savedRowFocus = captureRowFocus();
        const handEl = document.getElementById('playerHand');
        handEl.innerHTML = '';
        gameState.playerHand.forEach(card => {
            const cardEl = createCardElement(card, false);
            attachDesktopTooltip(cardEl, card);

            // Playable or not, by the same checks playCard makes (getPlayRestriction); the reason is on the card
            const restriction = getPlayRestriction(card);
            cardEl.classList.add(restriction ? 'unplayable' : 'playable');
            if (restriction) {
                cardEl.dataset.restriction = restriction.code;
                cardEl.title = `Can't play now: ${restriction.text}`;
                if (restriction.code === 'mana' || restriction.code === 'land') {
                    const chip = document.createElement('div');
                    chip.className = 'card-reason';
                    chip.setAttribute('aria-hidden', 'true');
                    const missing = getMissingMana(card.cost || {}, gameState.playerMana);
                    chip.textContent = restriction.code === 'land' ? 'Land used'
                        : `🔒${Object.entries(missing).map(([el, n]) => `${ELEMENTS[el]?.emoji || '◇'}${n}`).join('') || ''}`;
                    cardEl.appendChild(chip);
                }
            }

            // Lifting a playable card makes a soft swish (pointer only; the play itself has its own sound)
            if (!restriction) cardEl.addEventListener('pointerdown', () => GameFeedback.play('pickup'));

            // Tap/click/Enter plays; long-press, right-click or I shows details (bindCardPress)
            bindCardPress(cardEl, {
                label: describeCardForA11y(card, 'hand') + (restriction ? `, can't play now: ${restriction.text}` : ''),
                onTap: () => playCard(card.id),
                onLongPress: () => showCardDetail(card)
            });

            handEl.appendChild(cardEl);
        });

        // Update player board with STACKING for lands
        const boardEl = document.getElementById('playerBoard');
        boardEl.innerHTML = '';
        
        // Group lands by element
        const landStacks = {};
        const nonLands = [];
        
        gameState.playerBoard.forEach(card => {
            if (card.type === 'land') {
                // Handle both single-color lands (card.element) and dual lands (card.elements)
                const landKey = card.element || (card.elements && card.elements.join('-')) || 'colorless';
                if (!landStacks[landKey]) {
                    landStacks[landKey] = [];
                }
                landStacks[landKey].push(card);
            } else {
                nonLands.push(card);
            }
        });

        // Display land stacks as representative cards
        Object.keys(landStacks).forEach(element => {
            const stack = landStacks[element];
            const tappedCount = stack.filter(c => c.tapped).length;
            const untappedCount = stack.length - tappedCount;
            const total = stack.length;
            const representativeCard = stack[0];
            const landEmoji = representativeCard.emoji;

            const stackCard = document.createElement('div');
            stackCard.className = 'land-stack-card';
            applyCardIdentity(stackCard, representativeCard);
            attachDesktopTooltip(stackCard, representativeCard);
            if (tappedCount === total) {
                stackCard.classList.add('all-tapped');
            } else if (tappedCount > 0) {
                stackCard.classList.add('partially-tapped');
            } else {
                stackCard.classList.add('all-untapped');
            }

            // Emoji display
            const emojiEl = document.createElement('div');
            emojiEl.className = 'land-stack-emoji';
            emojiEl.textContent = landEmoji;
            stackCard.appendChild(emojiEl);

            // Count display: "⚡3/5" format
            const countEl = document.createElement('div');
            countEl.className = 'land-stack-count';
            if (total === 1) {
                countEl.innerHTML = tappedCount > 0
                    ? '<span class="tapped-count">tapped</span>'
                    : '<span class="untapped-count">ready</span>';
            } else {
                countEl.innerHTML = '⚡<span class="' + (tappedCount < total ? 'untapped-count' : 'tapped-count') + '">' + tappedCount + '</span>'
                    + '<span class="separator">/</span>'
                    + '<span class="tapped-count">' + total + '</span>';
            }
            stackCard.appendChild(countEl);

            // Total badge: "🔥 x5" format
            if (total > 1) {
                const totalEl = document.createElement('div');
                totalEl.className = 'land-stack-total';
                totalEl.textContent = landEmoji + ' x' + total;
                stackCard.appendChild(totalEl);
            }

            // "Tap all" button: a mouse shortcut shown on hover or focus. Long-press, right-click and I do the same.
            if (untappedCount > 1) {
                const tapAllBtn = document.createElement('div');
                tapAllBtn.className = 'land-stack-tap-all';
                tapAllBtn.textContent = '⚡';
                tapAllBtn.title = 'Tap all untapped';
                tapAllBtn.setAttribute('aria-hidden', 'true');
                tapAllBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
                tapAllBtn.onclick = (e) => {
                    e.stopPropagation();
                    tapAllLandsOfType(element);
                };
                stackCard.appendChild(tapAllBtn);
            }

            // Tap: tap one untapped land (or undo the last one). Long-press, right-click or I: tap them all,
            // or show details when there is only one left.
            bindCardPress(stackCard, {
                label: `${representativeCard.name}: ${untappedCount} of ${total} untapped. Press to tap one; long-press or I to tap all.`,
                onTap: () => {
                    const land = stack.find(c => !c.tapped) || stack.find(c => c.tapped);
                    if (land) tapLand(land.id);
                },
                onLongPress: () => {
                    if (untappedCount > 1) {
                        tapAllLandsOfType(element);
                    } else {
                        showCardDetail(representativeCard);
                    }
                }
            });

            boardEl.appendChild(stackCard);
        });

        // Display non-land cards normally
        nonLands.forEach(card => {
            const cardEl = createCardElement(card, true);
            attachDesktopTooltip(cardEl, card);
            
            let attackNote = '';
            if (card.type === 'creature' && attackPhase && gameState.attackers.includes(card.id)) {
                cardEl.classList.add('attacking');
                const marker = document.createElement('div');
                marker.className = 'card-state card-state-attacking';
                marker.textContent = '⚔️';
                marker.setAttribute('aria-hidden', 'true');
                cardEl.appendChild(marker);
                attackNote = markPreviewOutcome(cardEl, card.id);
            } else if (card.type === 'creature' && attackPhase) {
                // Why it can't attack (getAttackRestriction), on the card and in its name
                const restriction = getAttackRestriction(card);
                cardEl.classList.add(restriction ? 'cannot-attack' : 'can-attack');
                if (restriction) {
                    const chip = document.createElement('div');
                    chip.className = 'card-reason';
                    chip.setAttribute('aria-hidden', 'true');
                    chip.textContent = card.tapped ? 'Tapped' : hasAbility(card, 'defender') ? 'Defender' : 'Next turn';
                    cardEl.appendChild(chip);
                    cardEl.title = `Can't attack: it ${restriction}`;
                    attackNote = `, can't attack: it ${restriction}`;
                }
            } else if (enemyCombatMarks.blockers.has(card.id)) {
                cardEl.classList.add('auto-blocked');
                addBoardMarker(cardEl, 'card-state-blocked', '🛡');
                attackNote = ', blocked automatically';
            }

            // Tap: select as attacker (attack phase), use an artifact, otherwise show details.
            // Long-press, right-click or I always shows details.
            let boardAction = () => showCardDetail(card);
            if (card.type === 'creature' && attackPhase) {
                boardAction = () => selectAttacker(card.id);
            } else if (card.type === 'artifact' && !attackPhase) {
                boardAction = () => activateArtifact(card.id);
            }
            bindCardPress(cardEl, {
                label: describeCardForA11y(card, 'board') + (card.type === 'creature' && attackPhase
                    ? (gameState.attackers.includes(card.id) ? `, attacking${attackNote}` : (attackNote || ', press to attack')) : attackNote),
                onTap: boardAction,
                onLongPress: () => showCardDetail(card)
            });

            boardEl.appendChild(cardEl);
        });

        // Update enemy board with STACKING for lands
        const enemyBoardEl = document.getElementById('enemyBoard');
        enemyBoardEl.innerHTML = '';
        
        // Group enemy lands by element
        const enemyLandStacks = {};
        const enemyNonLands = [];
        
        gameState.enemyBoard.forEach(card => {
            if (card.type === 'land') {
                // Handle both single-color lands (card.element) and dual lands (card.elements)
                const landKey = card.element || (card.elements && card.elements.join('-')) || 'colorless';
                if (!enemyLandStacks[landKey]) {
                    enemyLandStacks[landKey] = [];
                }
                enemyLandStacks[landKey].push(card);
            } else {
                enemyNonLands.push(card);
            }
        });

        // Display enemy land stacks as representative cards
        Object.keys(enemyLandStacks).forEach(element => {
            const stack = enemyLandStacks[element];
            const tappedCount = stack.filter(c => c.tapped).length;
            const total = stack.length;
            const representativeCard = stack[0];
            const landEmoji = representativeCard.emoji;

            const stackCard = document.createElement('div');
            stackCard.className = 'land-stack-card enemy-land-stack';
            applyCardIdentity(stackCard, representativeCard);
            attachDesktopTooltip(stackCard, representativeCard);
            if (tappedCount === total) {
                stackCard.classList.add('all-tapped');
            } else if (tappedCount > 0) {
                stackCard.classList.add('partially-tapped');
            } else {
                stackCard.classList.add('all-untapped');
            }

            // Emoji display
            const emojiEl = document.createElement('div');
            emojiEl.className = 'land-stack-emoji';
            emojiEl.textContent = landEmoji;
            stackCard.appendChild(emojiEl);

            // Count display: "⚡3/5" format
            const countEl = document.createElement('div');
            countEl.className = 'land-stack-count';
            if (total === 1) {
                countEl.innerHTML = tappedCount > 0
                    ? '<span class="tapped-count">tapped</span>'
                    : '<span class="untapped-count">ready</span>';
            } else {
                countEl.innerHTML = '⚡<span class="' + (tappedCount < total ? 'untapped-count' : 'tapped-count') + '">' + tappedCount + '</span>'
                    + '<span class="separator">/</span>'
                    + '<span class="tapped-count">' + total + '</span>';
            }
            stackCard.appendChild(countEl);

            // Total badge: "🔥 x5" format
            if (total > 1) {
                const totalEl = document.createElement('div');
                totalEl.className = 'land-stack-total';
                totalEl.textContent = landEmoji + ' x' + total;
                stackCard.appendChild(totalEl);
            }

            // Enemy cards: any press shows details.
            bindCardPress(stackCard, {
                label: `Enemy ${representativeCard.name}: ${total - tappedCount} of ${total} untapped`,
                onTap: () => showCardDetail(representativeCard),
                onLongPress: () => showCardDetail(representativeCard)
            });

            enemyBoardEl.appendChild(stackCard);
        });

        // Display enemy non-land cards normally
        enemyNonLands.forEach(card => {
            const cardEl = createCardElement(card, true, true);
            attachDesktopTooltip(cardEl, card);
            let blockNote = attackPhase ? markPreviewOutcome(cardEl, card.id) : '';
            if (enemyCombatMarks.attackers.has(card.id)) {
                cardEl.classList.add('enemy-attacking');
                addBoardMarker(cardEl, 'card-state-attacking', '⚔️');
                blockNote += ', attacking you';
            }
            if (enemyTurnStartIds && !enemyTurnStartIds.has(card.id)) {
                cardEl.classList.add('ai-new');
                const chip = document.createElement('div');
                chip.className = 'ai-new-chip';
                chip.textContent = 'New';
                chip.setAttribute('aria-hidden', 'true');
                cardEl.appendChild(chip);
                blockNote += ', played on its last turn';
            }

            bindCardPress(cardEl, {
                label: `Enemy ${describeCardForA11y(card, 'board')}${blockNote}`,
                onTap: () => showCardDetail(card),
                onLongPress: () => showCardDetail(card)
            });

            enemyBoardEl.appendChild(cardEl);
        });

        restoreRowFocus(savedRowFocus);
        renderCombatPreviewPanel();
        updateTurnBanner();
        if (attackPhase) setAttackControls('select');

        // Manage button states - disable during enemy turn and when processing actions
        const attackBtn = document.getElementById('attackBtn');
        const endTurnBtn = document.getElementById('endTurnBtn');
        const mulliganBtn = document.getElementById('mulliganBtn');
        const isPlayerTurn = gameState.turn === 'player' && gameState.phase !== 'enemy';

        if (mulliganBtn) {
            mulliganBtn.disabled = !canMulligan();
            mulliganBtn.style.opacity = mulliganBtn.disabled ? '0.5' : '1';
        }

        if (attackBtn) {
            const shouldDisableAttack = !isPlayerTurn || isProcessingAction;
            attackBtn.disabled = shouldDisableAttack;

            // Visual feedback for disabled state
            if (shouldDisableAttack) {
                attackBtn.style.opacity = '0.5';
                attackBtn.style.cursor = 'not-allowed';
            } else {
                attackBtn.style.opacity = '1';
                attackBtn.style.cursor = 'pointer';
            }
        }

        if (endTurnBtn) {
            // During attacker selection this button is CANCEL, so it stays usable
            const shouldDisableEndTurn = !isPlayerTurn || isProcessingAction;
            endTurnBtn.disabled = shouldDisableEndTurn;

            // Visual feedback for disabled state
            if (shouldDisableEndTurn) {
                endTurnBtn.style.opacity = '0.5';
                endTurnBtn.style.cursor = 'not-allowed';
            } else {
                endTurnBtn.style.opacity = '1';
                endTurnBtn.style.cursor = 'pointer';
            }
        }
    }

    function updateUI({ immediate = false } = {}) {
        if (immediate) {
            if (uiUpdateRafId && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(uiUpdateRafId);
            }
            isUIUpdateScheduled = false;
            uiUpdateRafId = 0;
            performUIUpdate();
            return;
        }

        scheduleUIUpdate();
    }

    function updateManaDisplay(elementId, manaPool) {
        const el = document.getElementById(elementId);
        el.innerHTML = '';
        
        for (let element in manaPool) {
            if (manaPool[element] > 0) {
                const manaEl = document.createElement('div');
                manaEl.className = 'mana-icon';
                manaEl.textContent = `${ELEMENTS[element].emoji} ${manaPool[element]}`;
                el.appendChild(manaEl);
            }
        }
    }

    // One card face for the hand and both battlefields. The art (emoji) is the first child; around it: cost pips
    // (hand) or damage (board) top-left, keywords or the type icon top-right, a state marker bottom-left and
    // power/toughness bottom-right. Element colours, type and rarity are classes and data attributes styled in
    // styles.css ("CARD FACES").
    function createCardElement(card, onBoard, isEnemy = false) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.dataset.cardId = card.id;
        cardEl.id = `card-${isEnemy ? 'enemy' : 'player'}-${card.id}`;

        cardEl.classList.add(`rarity-${getCardRarity(card)}`, `type-${card.type}`);
        cardEl.dataset.type = card.type;
        applyCardIdentity(cardEl, card);

        if (card.type === 'land') {
            cardEl.classList.add('land');
        }
        if (card.theme === 'Science Fiction') {
            cardEl.classList.add('scifi');
        }
        if (card.tapped) {
            cardEl.classList.add('tapped');
        }
        if (isEnemy) {
            cardEl.classList.add('enemy-card');
        }
        const sick = onBoard && card.type === 'creature' && card.summoningSick && !card.abilities?.includes('haste');
        if (sick) {
            cardEl.classList.add('summoning-sick');
            cardEl.title = isEnemy ? 'Summoning sick: can attack on its next turn' : 'Summoning sick: can attack next turn';
        }

        // Art: the emoji, centred in an element-coloured window
        const emojiEl = document.createElement('div');
        emojiEl.className = 'card-art';
        emojiEl.textContent = card.emoji;
        cardEl.appendChild(emojiEl);

        // Cost, in hand only (the board has no use for it)
        if (!onBoard && card.type !== 'land') {
            const costEl = document.createElement('div');
            costEl.className = 'card-cost';
            costEl.innerHTML = renderCostPips(card.cost);
            cardEl.appendChild(costEl);
        }

        // Type icon for everything but creatures (their power/toughness already says what they are)
        if (card.type !== 'creature' && CARD_TYPE_INFO[card.type]) {
            const typeEl = document.createElement('div');
            typeEl.className = 'card-type-icon';
            typeEl.textContent = CARD_TYPE_INFO[card.type].icon;
            typeEl.title = CARD_TYPE_INFO[card.type].label;
            typeEl.setAttribute('aria-hidden', 'true');
            cardEl.appendChild(typeEl);
        }

        if (card.type === 'creature') {
            const powerEl = document.createElement('div');
            powerEl.className = 'card-power';
            powerEl.textContent = `${card.power}/${card.toughness}`;
            cardEl.appendChild(powerEl);

            // Damage marked this turn (it wears off between turns)
            if (onBoard && card.damage > 0) {
                const damageEl = document.createElement('div');
                damageEl.className = 'card-damage';
                damageEl.textContent = `💔${card.damage}`;
                cardEl.appendChild(damageEl);
            }

            // Summoning sickness as a marker, not only the dashed border
            if (sick) {
                const stateEl = document.createElement('div');
                stateEl.className = 'card-state card-state-sick';
                stateEl.textContent = '💤';
                stateEl.setAttribute('aria-hidden', 'true');
                cardEl.appendChild(stateEl);
            }

            // Keywords: up to three badges show; the rest are counted (+N) and listed in card details
            if (card.abilities && card.abilities.length > 0) {
                const abilitiesEl = document.createElement('div');
                abilitiesEl.className = 'card-abilities';
                card.abilities.forEach(ability => abilitiesEl.appendChild(createKeywordBadge(ability)));
                if (card.abilities.length > 3) {
                    const moreEl = document.createElement('div');
                    moreEl.className = 'ability-more';
                    moreEl.textContent = `+${card.abilities.length - 3}`;
                    moreEl.title = card.abilities.slice(3).map(describeKeyword).join('\n');
                    abilitiesEl.appendChild(moreEl);
                }
                cardEl.appendChild(abilitiesEl);
            }
        }

        return cardEl;
    }

    initializePackOpeningOverlay();

    // Resize canvas with debouncing for better performance
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }, 100); // Debounce resize for better performance
    });

    // Dialogs, topmost first. Esc closes the top one; Tab stays inside it; focus moves into a dialog when
    // it opens and returns to where it was when it closes (UI.md).
    const GAME_DIALOGS = [
        { id: 'gameConfirmModal', close: () => document.getElementById('gameConfirmNoBtn')?.click() },
        { id: 'mulliganConfirmModal', close: () => document.getElementById('mulliganNoBtn')?.click() },
        { id: 'manaChoiceModal', close: () => document.querySelector('#manaChoiceModal .cancel-btn')?.click() },
        { id: 'cardDetailPopup', close: () => hideCardDetail() },
        { id: 'packContentsModal', close: () => hidePackContents() },
        { id: 'packOpeningOverlay', close: () => closePackOpeningOverlay() },
        { id: 'matchRewardOverlay', close: null },   // the only way on is OPEN BOOSTER
        { id: 'victoryOverlay', close: null },       // PLAY AGAIN or MAIN MENU (Esc used to strand the board)
        { id: 'loseOverlay', close: null },
        { id: 'graveyardModal', close: () => hideGraveyard() },
        { id: 'historyModal', close: () => hideMatchHistory() },
        { id: 'themeDialog', close: () => hideThemePicker() },
        { id: 'soundDialog', close: () => hideSoundSettings() },
        { id: 'achievementsDialog', close: () => hideAchievementsDialog() },
        { id: 'pauseModal', close: () => resumeGame() }
    ];

    function isDialogOpen(el) {
        return !!el && el.classList.contains('show') && getComputedStyle(el).display !== 'none';
    }

    function getOpenGameDialog() {
        return GAME_DIALOGS.find(d => isDialogOpen(document.getElementById(d.id))) || null;
    }

    function getFocusable(container) {
        return [...container.querySelectorAll('button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0 &&
                getComputedStyle(el).visibility !== 'hidden');
    }

    const dialogReturnFocus = new Map();
    GAME_DIALOGS.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (!el || typeof MutationObserver === 'undefined') return;
        let wasOpen = isDialogOpen(el);
        new MutationObserver(() => {
            const open = isDialogOpen(el);
            if (open === wasOpen) return;
            wasOpen = open;
            if (open) {
                // A message toast would sit on top of the dialog
                document.getElementById('gameLog')?.classList.remove('show');
                const active = document.activeElement;
                if (active && active !== document.body && !el.contains(active)) dialogReturnFocus.set(id, active);
                // After the opening animation frame, so the dialog is laid out.
                setTimeout(() => {
                    if (!isDialogOpen(el) || el.contains(document.activeElement)) return;
                    const first = getFocusable(el)[0];
                    if (first) first.focus({ preventScroll: true });
                    else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
                }, 50);
            } else {
                const back = dialogReturnFocus.get(id);
                dialogReturnFocus.delete(id);
                if (el.contains(document.activeElement) || document.activeElement === document.body) {
                    if (getOpenGameDialog()) return; // another dialog took over; it manages focus
                    if (back && back.isConnected && back.getClientRects().length) back.focus({ preventScroll: true });
                    else focusSafeElement();
                }
            }
        }).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    });

    // Keyboard shortcuts during a match: Space/E end turn, A attack, M mulligan, Esc pause.
    document.addEventListener('keydown', (e) => {
        // Tab stays inside the open dialog.
        if (e.key === 'Tab') {
            const open = getOpenGameDialog();
            if (!open) return;
            const dialog = document.getElementById(open.id);
            const items = getFocusable(dialog);
            if (!items.length) { e.preventDefault(); return; }
            const index = items.indexOf(document.activeElement);
            if (e.shiftKey && (index <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
            else if (!e.shiftKey && (index === -1 || index === items.length - 1)) { e.preventDefault(); items[0].focus(); }
            return;
        }

        if (e.key === 'Escape') {
            const open = getOpenGameDialog();
            if (open) {
                e.preventDefault();
                if (open.close) open.close();
                return;
            }

            const startModal = document.getElementById('startModal');
            const deckBuilderGuideOverlay = document.getElementById('deckBuilderGuideOverlay');
            if (startModal?.classList.contains('modal-visible') && deckBuilderGuideOverlay?.style.display !== 'none') {
                e.preventDefault();
                closeDeckBuilderGuide();
                return;
            }

            const deckBuilderScreen = document.getElementById('deckBuilderScreen');
            if (startModal?.classList.contains('modal-visible') && deckBuilderScreen?.style.display === 'block') {
                e.preventDefault();
                backToMenu();
                return;
            }

            const packShopScreen = document.getElementById('packShopScreen');
            if (startModal?.classList.contains('modal-visible') && packShopScreen?.style.display === 'block') {
                e.preventDefault();
                hidePackShop();
                return;
            }

            const binderScreen = document.getElementById('binderScreen');
            if (startModal?.classList.contains('modal-visible') && binderScreen?.style.display === 'block') {
                e.preventDefault();
                hideBinder();
                return;
            }

            // Battle setup, How to Play and Stats go back to the menu too
            const backScreen = ['elementSelectionScreen', 'howToPlayScreen', 'statsScreen', 'achievementsScreen']
                .find(id => document.getElementById(id)?.style.display === 'block');
            if (startModal?.classList.contains('modal-visible') && backScreen) {
                e.preventDefault();
                backToMenu();
                return;
            }
        }

        // Only enable keyboard shortcuts during active gameplay (not in menus)
        if (document.getElementById('gameContainer').style.display !== 'flex') {
            return;
        }

        // Not while a dialog is open, with a modifier held (Ctrl+A is select-all), or when Space/Enter is
        // meant for the focused button or card.
        if (getOpenGameDialog() || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        // A control reached with Tab gets its own Space/Enter. After a mouse click or tap the shortcuts still
        // work, as before.
        const focusedControl = e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [role="button"]');
        if (focusedControl && !lastInputWasPointer && (e.key === ' ' || e.key === 'Enter')) {
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            pauseGame();
            return;
        }

        // H = match history, on either side's turn
        if (e.key === 'h' || e.key === 'H') {
            e.preventDefault();
            showMatchHistory();
            return;
        }

        // Only allow shortcuts during player's turn
        if (gameState.turn !== 'player' || isProcessingAction) {
            return;
        }

        switch(e.key.toLowerCase()) {
            case ' ': // Spacebar = End Turn
            case 'e': // E = End Turn
                e.preventDefault();
                const endTurnBtn = document.getElementById('endTurnBtn');
                if (attackPhase) {
                    endTurn(); // still END TURN, which is refused mid-attack (the button itself is CANCEL now)
                } else if (endTurnBtn && !endTurnBtn.disabled) {
                    endTurnBtn.click();
                }
                break;

            case 'a': // A = Attack
                e.preventDefault();
                const attackBtn = document.getElementById('attackBtn');
                if (attackBtn && !attackBtn.disabled) {
                    attackBtn.click();
                }
                break;

            case 'm': // M = Mulligan (if available)
                e.preventDefault();
                const mulliganBtn = document.getElementById('mulliganBtn');
                if (mulliganBtn && !mulliganBtn.disabled) {
                    mulliganBtn.click();
                }
                break;
        }
    });

    // Global error handler to prevent game from getting stuck
    window.addEventListener('error', (event) => {
        console.error('❌ Global error caught:', event.error);

        // If there's an error, release the processing lock to prevent permanent freeze
        if (isProcessingAction) {
            console.log('🔓 Releasing processing lock due to error');
            releaseProcessingLock();
        }
    });

    // Periodic safety check to ensure buttons don't get permanently stuck
    // This runs every 15 seconds and checks if the processing lock has been active too long
    let lastProcessingCheckTime = Date.now();
    setInterval(() => {
        // Only check during active gameplay (not in menus)
        if (document.getElementById('gameContainer').style.display === 'flex') {
            // If it's the player's turn and processing has been locked for over 15 seconds, something is wrong
            if (!gamePaused && !gameState.matchFinalized && gameState.turn === 'player' && isProcessingAction) {
                const timeSinceLastCheck = Date.now() - lastProcessingCheckTime;
                if (timeSinceLastCheck > 15000) {
                    console.warn('⚠️ Processing lock stuck for over 15 seconds - forcing release');
                    releaseProcessingLock();
                }
            }

            // Update last check time if not processing
            if (!isProcessingAction) {
                lastProcessingCheckTime = Date.now();
            }
        }
    }, 5000); // Check every 5 seconds
