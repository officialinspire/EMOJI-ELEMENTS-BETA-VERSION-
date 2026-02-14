    // Audio System
    const audioSystem = {
        startMenuMusic: new Audio('startmenu.mp3'),
        gameplayMusic: new Audio('gameplaybackgroundmusic.mp3'),
        tapLand: new Audio('tapland.mp3'),
        untap: new Audio('untap.mp3'),
        summonCreatureFantasy: new Audio('summoncreaturefantasy.mp3'),
        summonCreatureScifi: new Audio('scifisummon.mp3'),
        summonInstant: new Audio('summoninstant.mp3'),
        cardDestroyed: new Audio('carddestroyed.mp3'),
        attack: new Audio('attack.mp3'),
        block: new Audio('block.mp3'),
        playerHeal: new Audio('playerheal.mp3'),
        playerTakeDamage: new Audio('playertakedamage.mp3'),
        opponentHeals: new Audio('opponentheals.mp3'),
        opponentTakeDamage: new Audio('opponenttakedamage.mp3'),
        menuOpen: new Audio('menuopen.mp3'),
        menuClose: new Audio('menuclose.mp3'),
        select: new Audio('select.mp3'),
        gameVictory: new Audio('gamevictorysfx.mp3'),
        gameLose: new Audio('gamelosesfx.mp3')
    };

    // Configure audio loops and volume for mobile compatibility
    audioSystem.startMenuMusic.loop = true;
    audioSystem.gameplayMusic.loop = true;
    audioSystem.startMenuMusic.volume = 0.5;
    audioSystem.gameplayMusic.volume = 0.5;
    audioSystem.gameVictory.volume = 0.7;
    audioSystem.gameLose.volume = 0.7;

    // Set all sound effects to reasonable volume
    Object.keys(audioSystem).forEach(key => {
        if (!['startMenuMusic', 'gameplayMusic', 'gameVictory', 'gameLose'].includes(key)) {
            audioSystem[key].volume = 0.6;
        }
    });

    const MUSIC_TARGET_VOLUME = {
        menu: 0.5,
        gameplay: 0.5
    };

    const activeAudioFades = new WeakMap();

    // IMPROVED: Audio queue management to prevent overlapping sounds
    const audioQueue = {
        lastPlayed: {},
        minInterval: 100 // Minimum milliseconds between same sound effects
    };

    // Helper function to play sound effect with better management
    function playSFX(soundName, loop = false) {
        if (audioSystem[soundName]) {
            try {
                // Prevent rapid-fire duplicate sounds for better audio quality
                const now = Date.now();
                const lastPlayTime = audioQueue.lastPlayed[soundName] || 0;

                if (!loop && now - lastPlayTime < audioQueue.minInterval) {
                    return; // Skip if played too recently
                }

                audioQueue.lastPlayed[soundName] = now;

                audioSystem[soundName].currentTime = 0;
                audioSystem[soundName].loop = loop;
                const playPromise = audioSystem[soundName].play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => console.log('Audio play failed:', e));
                }
            } catch (e) {
                console.log('Audio error:', e);
            }
        }
    }

    // Helper function to stop sound
    function stopSFX(soundName) {
        if (audioSystem[soundName]) {
            try {
                audioSystem[soundName].pause();
                audioSystem[soundName].currentTime = 0;
            } catch (e) {
                console.log('Audio stop error:', e);
            }
        }
    }


    function applyMuteState() {
        Object.values(audioSystem).forEach(audio => {
            audio.muted = isMuted;
        });

        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.textContent = isMuted ? '🔇' : '🔊';
            muteBtn.title = isMuted ? 'Unmute sound' : 'Mute sound';
        }
    }

    function toggleMute() {
        isMuted = !isMuted;
        localStorage.setItem('emojiElementsMuted', String(isMuted));
        applyMuteState();
        showGameLog(isMuted ? '🔇 Sound muted' : '🔊 Sound enabled', false);
    }

    function initializeButtonTypes() {
        document.querySelectorAll('button:not([type])').forEach((button) => {
            button.type = 'button';
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

    // Helper function to fade audio volume in or out over a duration
    function fadeAudio(audioElement, targetVolume, duration, callback) {
        const existingFade = activeAudioFades.get(audioElement);
        if (existingFade) {
            clearInterval(existingFade);
        }

        const steps = 20;
        const interval = duration / steps;
        const startVolume = audioElement.volume;
        const volumeStep = (targetVolume - startVolume) / steps;
        let currentStep = 0;

        const fade = setInterval(() => {
            currentStep++;
            audioElement.volume = Math.max(0, Math.min(1, startVolume + volumeStep * currentStep));
            if (currentStep >= steps) {
                clearInterval(fade);
                activeAudioFades.delete(audioElement);
                audioElement.volume = targetVolume;
                if (callback) callback();
            }
        }, interval);

        activeAudioFades.set(audioElement, fade);
    }

    function isAudioPlaying(audioElement) {
        return !!audioElement && !audioElement.paused && !audioElement.ended;
    }

    function ensureStartMenuMusic() {
        stopSFX('gameplayMusic');

        if (!isAudioPlaying(audioSystem.startMenuMusic)) {
            audioSystem.startMenuMusic.volume = 0;
            playSFX('startMenuMusic', true);
        }

        fadeAudio(audioSystem.startMenuMusic, MUSIC_TARGET_VOLUME.menu, 800);
    }

    function transitionToGameplayMusic() {
        fadeAudio(audioSystem.startMenuMusic, 0, 500, () => {
            stopSFX('startMenuMusic');
        });

        if (!isAudioPlaying(audioSystem.gameplayMusic)) {
            audioSystem.gameplayMusic.volume = 0;
            playSFX('gameplayMusic', true);
        }

        fadeAudio(audioSystem.gameplayMusic, MUSIC_TARGET_VOLUME.gameplay, 800);
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
        hasAttackedThisTurn: false  // VIGILANCE FIX: Prevent multiple attacks per turn
    };

    // Stats tracking
    let gameStats = {
        wins: 0,
        losses: 0,
        total: 0
    };

    // Load stats from localStorage
    function loadStats() {
        const savedMeta = localStorage.getItem('emoji_elements_meta_v1');
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

        const saved = localStorage.getItem('emojiElementsStats');
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
        if (gameMeta && gameMeta.stats) {
            gameMeta.stats.wins = Number.isFinite(gameStats.wins) ? gameStats.wins : 0;
            gameMeta.stats.losses = Number.isFinite(gameStats.losses) ? gameStats.losses : 0;
            gameMeta.stats.packsOpened = Number.isFinite(gameMeta.stats.packsOpened) ? gameMeta.stats.packsOpened : 0;
            metaSave(gameMeta);
        }
        localStorage.setItem('emojiElementsStats', JSON.stringify(gameStats));
    }

    loadStats();

    // Detect iOS devices
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    let isMuted = localStorage.getItem('emojiElementsMuted') === 'true';
    let hoverTooltipPinned = false;

    // Intro / startup sequence state
    let startupState = 'awaiting-click';

    // Intro Video Logic with Click to Start
    window.addEventListener('DOMContentLoaded', () => {
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

            introContainer.classList.remove('hidden');
            introContainer.style.display = 'flex';

            introVideo.muted = false;
            introVideo.volume = 1.0;

            // Fallback in case video playback never starts on slower mobile browsers
            introStartWatchdogId = setTimeout(() => {
                const playbackStillBlocked = introVideo.paused && introVideo.currentTime === 0;
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
        introVideo.removeAttribute('muted');
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

    // Failsafe function to unlock processing after timeout
    function setProcessingLock(duration = 5000) {
        isProcessingAction = true;

        // Clear any existing timer
        if (processingActionTimer) {
            clearTimeout(processingActionTimer);
        }

        // Set failsafe timer to auto-unlock after duration
        processingActionTimer = setTimeout(() => {
            console.log('⚠️ Failsafe: Auto-unlocking processing action');
            isProcessingAction = false;
            updateUI();
        }, duration);
    }

    // Function to properly release processing lock
    function releaseProcessingLock() {
        isProcessingAction = false;
        if (processingActionTimer) {
            clearTimeout(processingActionTimer);
            processingActionTimer = null;
        }
        // CRITICAL FIX: Update UI to refresh button states immediately after releasing lock
        updateUI();
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
            fire: { emoji: '🔥', type: 'land', cardType: 'Land', element: 'fire', name: 'Volcanic Peak', theme: 'Nature' },
            water: { emoji: '💧', type: 'land', cardType: 'Land', element: 'water', name: 'Mystic Springs', theme: 'Nature' },
            earth: { emoji: '🌍', type: 'land', cardType: 'Land', element: 'earth', name: 'Ancient Grove', theme: 'Nature' },
            swamp: { emoji: '💀', type: 'land', cardType: 'Land', element: 'swamp', name: 'Cursed Bog', theme: 'Fantasy' },
            light: { emoji: '☀️', type: 'land', cardType: 'Land', element: 'light', name: 'Sacred Temple', theme: 'Fantasy' },
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
            fireball: { emoji: '💥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 3 }, effect: 'damage', value: 3, name: 'Fireball', desc: 'Deal 3 damage to target', theme: 'Fantasy' },
            explosion: { emoji: '🎆', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 4 }, effect: 'damage', value: 4, name: 'Explosion', desc: 'Deal 4 damage to target', theme: 'Fantasy' },
            inferno: { emoji: '🔥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 5 }, effect: 'damage', value: 5, name: 'Inferno', desc: 'Deal 5 damage to target', theme: 'Fantasy' },
            meteor: { emoji: '☄️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 6 }, effect: 'damage', value: 6, name: 'Meteor Strike', desc: 'Devastating impact', theme: 'Nature' },
            flame: { emoji: '🕯️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 1 }, effect: 'damage', value: 1, name: 'Flame Jet', desc: 'Quick burn', theme: 'Fantasy' },
            anger: { emoji: '🤬', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 2 }, effect: 'buff', value: 3, buffType: 'power', name: 'Anger', desc: '+3/+0 to creature until end of turn', theme: 'City' },

            // Water Spells
            freeze: { emoji: '❄️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'tap', name: 'Freeze', desc: 'Tap target creature', theme: 'Nature' },
            tsunami: { emoji: '🌊', type: 'instant', cardType: 'Instant/Spell', cost: { water: 5 }, effect: 'bounce', name: 'Tsunami', desc: 'Return creatures to hand', theme: 'Nature' },
            bubble: { emoji: '🫧', type: 'instant', cardType: 'Instant/Spell', cost: { water: 3 }, effect: 'buff_defense', value: 3, name: 'Bubble Shield', desc: '+0/+3 to creature', theme: 'Fantasy' },
            rain: { emoji: '🌧️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'heal', value: 2, name: 'Healing Rain', desc: 'Restore 2 life', theme: 'Nature' },
            whirlpool: { emoji: '🌀', type: 'instant', cardType: 'Instant/Spell', cost: { water: 4 }, effect: 'destroy', name: 'Whirlpool', desc: 'Destroy target creature', theme: 'Nature' },
            deep_freeze: { emoji: '🥶', type: 'instant', cardType: 'Instant/Spell', cost: { water: 3 }, effect: 'tap', name: 'Deep Freeze', desc: 'Tap target creature, it doesn\'t untap', theme: 'Fantasy' },
            surf: { emoji: '🏄', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'buff', value: 2, grantAbilities: ['unblockable'], name: 'Surf', desc: 'Creature gets +2/+2 and unblockable', theme: 'City' },
            coral: { emoji: '🪸', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'buff_defense', value: 2, name: 'Coral Shield', desc: '+0/+2 to creature', theme: 'Nature' },

            // Earth Spells
            earthquake: { emoji: '🌋', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 4 }, effect: 'damage', value: 2, target: 'all', name: 'Earthquake', desc: 'Deal 2 to all creatures', theme: 'Nature' },
            growth: { emoji: '🌱', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'buff', value: 2, name: 'Growth', desc: '+2/+2 to creature', theme: 'Nature' },
            roots: { emoji: '🌿', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 1 }, effect: 'buff_defense', value: 2, name: 'Tangling Roots', desc: '+0/+2 to creature', theme: 'Nature' },
            avalanche: { emoji: '🏔️', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 5 }, effect: 'damage', value: 3, target: 'all', name: 'Avalanche', desc: 'Deal 3 to all creatures', theme: 'Nature' },
            harvest: { emoji: '🌾', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'draw', value: 2, name: 'Harvest', desc: 'Draw 2 cards', theme: 'Nature' },
            wrestle: { emoji: '🤼', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 3 }, effect: 'destroy', name: 'Wrestle', desc: 'Destroy target creature in combat', theme: 'City' },
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
            comet: { emoji: '☄️', type: 'instant', cardType: 'Instant/Spell', cost: { swamp: 3, fire: 2 }, effect: 'damage', value: 5, name: 'Comet Strike', desc: 'Deal 5 damage to target', theme: 'Science Fiction' },

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
            bomb: { emoji: '💣', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'aoe', value: 2, name: 'Bomb', desc: 'Deal 2 to all enemies', theme: 'City' },
            chalice: { emoji: '🏆', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'heal', value: 1, name: 'Holy Chalice', desc: 'Gain 1 life each turn', theme: 'Fantasy' },
            scroll: { emoji: '📜', type: 'artifact', cardType: 'Artifact', cost: { swamp: 2 }, effect: 'draw', value: 1, name: 'Dark Scroll', desc: 'Draw extra card', theme: 'Fantasy' },
            orb: { emoji: '🔮', type: 'artifact', cardType: 'Artifact', cost: { swamp: 3 }, effect: 'damage', value: 1, name: 'Cursed Orb', desc: 'Deal 1 to enemy each turn', theme: 'Fantasy' },
            horn: { emoji: '📯', type: 'artifact', cardType: 'Artifact', cost: { earth: 2 }, effect: 'buff', value: 1, buffType: 'power', targetAll: true, name: 'War Horn', desc: 'All creatures get +1/+0', theme: 'City' },
            amulet: { emoji: '🪬', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'buff_defense', value: 1, targetAll: true, name: 'Protective Amulet', desc: 'All creatures get +0/+1', theme: 'Fantasy' },
            ring: { emoji: '💍', type: 'artifact', cardType: 'Artifact', cost: { fire: 1, water: 1 }, effect: 'mana', value: 1, name: 'Magic Ring', desc: 'Boost mana production', theme: 'Fantasy' },
            armor: { emoji: '🦺', type: 'artifact', cardType: 'Artifact', cost: { earth: 3 }, effect: 'buff_defense', value: 3, name: 'Heavy Armor', desc: '+0/+3 to equipped', theme: 'City' },
            axe: { emoji: '🪓', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'buff', value: 3, buffType: 'power', name: 'Battle Axe', desc: '+3/+0 to equipped', theme: 'Fantasy' },
            bow: { emoji: '🏹', type: 'artifact', cardType: 'Artifact', cost: { earth: 2, light: 1 }, effect: 'buff', value: 2, buffType: 'power', grantAbilities: ['flying'], name: 'Elven Bow', desc: '+2/+0 and flying', theme: 'Fantasy' },
            wand: { emoji: '🪄', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'damage', value: 2, name: 'Magic Wand', desc: 'Deal 2 damage when activated', theme: 'Fantasy' },
            halo: { emoji: '😇', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'buff', value: 1, targetAll: true, grantAbilities: ['lifelink'], name: 'Halo', desc: 'All your creatures get +1/+1 and lifelink', theme: 'Fantasy' },
            dna_artifact: { emoji: '🧬', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'draw_on_play', value: 1, name: 'DNA Sequence', desc: 'Draw a card when played', theme: 'Science Fiction' },
            fingerprint: { emoji: '🫴', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'mana', value: 1, name: 'Fingerprint Scanner', desc: 'Add 1 colorless mana', theme: 'Science Fiction' },
            footsteps: { emoji: '👣', type: 'artifact', cardType: 'Artifact', cost: {}, effect: 'buff', value: 0, targetAll: true, grantAbilities: ['haste'], name: 'Footsteps', desc: 'Creatures get haste', theme: 'Science Fiction' },
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
    const __CARD_BY_ID = {};

    __ALL_CARDS.forEach(card => {
        card.__id = getCardId(card);
        card.__rarity = inferRarity(card);
        __CARD_BY_ID[card.__id] = card;
    });

    window.__ALL_CARDS = __ALL_CARDS;
    window.__CARD_BY_ID = __CARD_BY_ID;

    // META persistence module
    const META_STORAGE_KEY = 'emoji_elements_meta_v1';
    const STARTER_MONO_DECK_KEYS = ['FIRE', 'WATER', 'EARTH', 'SWAMP', 'LIGHT'];
    const STARTER_DUAL_DECK_KEYS = ['FIRE_WATER', 'FIRE_EARTH', 'WATER_EARTH', 'EARTH_SWAMP', 'SWAMP_LIGHT'];

    function getDeckColorsFromKey(deckKey) {
        return String(deckKey || '')
            .split('_')
            .map(part => part.toLowerCase())
            .filter(color => ELEMENTS[color]);
    }

    function getDeckCardCopyLimit(card) {
        if (!card || card.type === 'land') return Number.POSITIVE_INFINITY;
        return card.__rarity === 'legendary' ? 1 : 2;
    }

    function metaLoad() {
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
        localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
    }

    function buildStarterDeckFromColors(deckKey, colors) {
        const LAND_COUNT = 25;
        const NON_LAND_COUNT = 35;
        const COLORLESS_LAND_COUNT = 3;
        const coloredLandCount = LAND_COUNT - COLORLESS_LAND_COUNT;

        const cardIds = [];
        const cardCounts = {};

        function addCardById(cardId, amount = 1) {
            const card = __CARD_BY_ID[cardId];
            if (!card) return;
            const limit = getDeckCardCopyLimit(card);
            const current = cardCounts[cardId] || 0;
            const room = Math.max(0, limit - current);
            const toAdd = Math.min(room, amount);
            for (let i = 0; i < toAdd; i++) {
                cardIds.push(cardId);
            }
            cardCounts[cardId] = current + toAdd;
        }

        if (colors.length === 1) {
            const monoLand = __CARD_BY_ID[getCardId(CARD_DATABASE.lands[colors[0]])];
            if (monoLand) {
                for (let i = 0; i < coloredLandCount; i++) {
                    cardIds.push(monoLand.__id);
                }
            }
        } else {
            const firstCount = Math.ceil(coloredLandCount / 2);
            const secondCount = Math.floor(coloredLandCount / 2);
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

        const wastelandId = getCardId(CARD_DATABASE.lands.wasteland);
        for (let i = 0; i < COLORLESS_LAND_COUNT; i++) {
            cardIds.push(wastelandId);
        }

        const eligibleNonLands = __ALL_CARDS
            .filter(card => card.type !== 'land')
            .filter(card => {
                const costElements = Object.keys(card.cost || {});
                return costElements.every(element => element === 'colorless' || colors.includes(element));
            })
            .sort((a, b) => a.__id.localeCompare(b.__id));

        while (Object.keys(cardCounts).reduce((sum, id) => sum + (cardCounts[id] || 0), 0) < NON_LAND_COUNT) {
            let addedInPass = false;
            for (const card of eligibleNonLands) {
                const before = cardCounts[card.__id] || 0;
                addCardById(card.__id, 1);
                if ((cardCounts[card.__id] || 0) > before) {
                    addedInPass = true;
                }
                const currentNonLandCount = Object.keys(cardCounts).reduce((sum, id) => sum + (cardCounts[id] || 0), 0);
                if (currentNonLandCount >= NON_LAND_COUNT) break;
            }

            if (!addedInPass) {
                break;
            }
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
        const starterDeckKeys = [...STARTER_MONO_DECK_KEYS, ...STARTER_DUAL_DECK_KEYS];

        starterDeckKeys.forEach(deckKey => {
            const colors = getDeckColorsFromKey(deckKey);
            if (colors.length === 0) return;
            const starterDeck = buildStarterDeckFromColors(deckKey, colors);
            decks[deckKey] = starterDeck;

            if (STARTER_MONO_DECK_KEYS.includes(deckKey)) {
                starterDeck.cardIds.forEach(cardId => {
                    collection[cardId] = (collection[cardId] || 0) + 1;
                });
            }
        });

        return {
            version: 1,
            collection,
            decks,
            selectedDeckKey: 'FIRE',
            stats: { wins: 0, losses: 0, packsOpened: 0 },
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

    function metaEnsureInitialized() {
        const loaded = metaLoad();
        if (!loaded || loaded.version !== 1) {
            const seeded = createInitialMeta();
            metaSave(seeded);
            return seeded;
        }

        const meta = {
            version: 1,
            collection: {},
            decks: {},
            selectedDeckKey: typeof loaded.selectedDeckKey === 'string' ? loaded.selectedDeckKey : 'FIRE',
            stats: {
                wins: Number.isFinite(loaded?.stats?.wins) ? loaded.stats.wins : 0,
                losses: Number.isFinite(loaded?.stats?.losses) ? loaded.stats.losses : 0,
                packsOpened: Number.isFinite(loaded?.stats?.packsOpened) ? loaded.stats.packsOpened : 0
            },
            lastPack: loaded.lastPack ?? null
        };

        Object.entries(loaded.collection || {}).forEach(([cardId, count]) => {
            if (!__CARD_BY_ID[cardId]) return;
            const safeCount = Math.max(0, Math.floor(Number(count) || 0));
            if (safeCount > 0) {
                meta.collection[cardId] = safeCount;
            }
        });

        Object.entries(loaded.decks || {}).forEach(([deckKey, deckData]) => {
            const colors = Array.isArray(deckData?.colors)
                ? deckData.colors.filter(color => ELEMENTS[color])
                : getDeckColorsFromKey(deckKey);
            if (colors.length === 0) return;
            const cardIds = clampDeckCardIdsToOwned(deckData?.cardIds || [], meta.collection);

            meta.decks[deckKey] = {
                deckKey,
                colors,
                starterCardIds: Array.isArray(deckData?.starterCardIds) ? deckData.starterCardIds.filter(id => __CARD_BY_ID[id]) : [],
                cardIds
            };
        });

        const seededMeta = createInitialMeta();
        STARTER_MONO_DECK_KEYS.forEach(deckKey => {
            if (!meta.decks[deckKey]) {
                meta.decks[deckKey] = seededMeta.decks[deckKey];
            }

            const requiredCounts = {};
            (meta.decks[deckKey].cardIds || []).forEach(cardId => {
                requiredCounts[cardId] = (requiredCounts[cardId] || 0) + 1;
            });

            Object.entries(requiredCounts).forEach(([cardId, needed]) => {
                const owned = meta.collection[cardId] || 0;
                if (owned < needed) {
                    meta.collection[cardId] = needed;
                }
            });
        });

        if (!meta.decks[meta.selectedDeckKey]) {
            meta.selectedDeckKey = 'FIRE';
        }

        metaSave(meta);
        return meta;
    }

    let gameMeta = metaEnsureInitialized();
    gameStats = {
        wins: Number.isFinite(gameMeta?.stats?.wins) ? gameMeta.stats.wins : 0,
        losses: Number.isFinite(gameMeta?.stats?.losses) ? gameMeta.stats.losses : 0,
        total: (Number.isFinite(gameMeta?.stats?.wins) ? gameMeta.stats.wins : 0) + (Number.isFinite(gameMeta?.stats?.losses) ? gameMeta.stats.losses : 0)
    };

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
        // Apply mobile optimization
        const adjustedCount = Math.floor(count * particleMultiplier);

        for (let i = 0; i < adjustedCount; i++) {
            // Limit total particle count for performance
            if (particles.length < maxParticles) {
                particles.push(new Particle(x, y, color));
            }
        }
    }

    // Performance: Use requestAnimationFrame more efficiently
    let lastParticleFrame = 0;
    const particleFPS = 60;
    const particleFrameInterval = 1000 / particleFPS;

    function animateParticles(currentTime) {
        requestAnimationFrame(animateParticles);

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

    animateParticles(0);

    // Game Log System
    function showGameLog(message, isEnemy = false, isScifi = false) {
        const log = document.getElementById('gameLog');
        log.textContent = message;
        log.className = 'game-log show';
        
        if (isEnemy) {
            log.classList.add('enemy');
        }
        if (isScifi) {
            log.classList.add('scifi');
        }

        setTimeout(() => {
            log.classList.remove('show');
        }, 2000);
    }

    // Visual Effects Functions
    function createSparkles(x, y, count = 15) {
        const sparkleEmojis = ['✨', '💫', '⭐', '🌟', '💖'];
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const sparkle = document.createElement('div');
                sparkle.className = 'sparkle';
                sparkle.textContent = sparkleEmojis[Math.floor(Math.random() * sparkleEmojis.length)];
                sparkle.style.left = (x + (Math.random() - 0.5) * 100) + 'px';
                sparkle.style.top = (y + (Math.random() - 0.5) * 100) + 'px';
                document.body.appendChild(sparkle);
                setTimeout(() => sparkle.remove(), 1000);
            }, i * 50);
        }
    }

    function createTrampleEffect(x, y) {
        const trampleEmojis = ['💥', '⚡', '💢', '💨'];
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                const effect = document.createElement('div');
                effect.className = 'trample-effect';
                effect.textContent = trampleEmojis[Math.floor(Math.random() * trampleEmojis.length)];
                effect.style.left = (x + (Math.random() - 0.5) * 80) + 'px';
                effect.style.top = (y + (Math.random() - 0.5) * 80) + 'px';
                document.body.appendChild(effect);
                setTimeout(() => effect.remove(), 800);
            }, i * 100);
        }
    }

    function shakeScreen() {
        const gameContainer = document.getElementById('gameContainer');
        gameContainer.classList.add('shake-board');
        setTimeout(() => {
            gameContainer.classList.remove('shake-board');
        }, 500);
    }

    function shakeElement(element) {
        element.classList.add('shake');
        setTimeout(() => {
            element.classList.remove('shake');
        }, 500);
    }

    // Menu Navigation
    function showElementSelection() {
        playSFX('menuOpen');
        setStartMenuScreen('elementSelectionScreen');
        resetElementSelection();
    }

    function showHowToPlay() {
        playSFX('menuOpen');
        setStartMenuScreen('howToPlayScreen');
    }

    function showStats() {
        playSFX('menuOpen');
        setStartMenuScreen('statsScreen');
        updateStatsDisplay();
    }

    function backToMenu() {
        playSFX('menuClose');
        setStartMenuScreen('mainMenu');
    }

    function setStartMenuScreen(activeScreenId = 'mainMenu') {
        const menuScreens = ['mainMenu', 'elementSelectionScreen', 'howToPlayScreen', 'statsScreen'];
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
        // Scroll modal content to top when switching screens
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0;
    }

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

        document.querySelectorAll('.deck-mode-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.deckMode === mode);
        });

        document.querySelectorAll('.element-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        updateStartButtonState();
    }

    function resetElementSelection() {
        gameState.selectedElements = [];
        gameState.deckMode = 'dual';

        document.querySelectorAll('.deck-mode-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.deckMode === 'dual');
        });

        document.querySelectorAll('.element-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        updateStartButtonState();
    }

    function returnToMainMenu() {
        stopSFX('gameplayMusic');
        stopSFX('gameVictory');
        stopSFX('gameLose');

        const victoryOverlay = document.getElementById('victoryOverlay');
        const loseOverlay = document.getElementById('loseOverlay');
        victoryOverlay.classList.remove('show');
        loseOverlay.classList.remove('show');

        document.getElementById('pauseModal').classList.remove('show');
        document.getElementById('graveyardModal').classList.remove('show');
        document.getElementById('mulliganConfirmModal').classList.remove('show');
        document.getElementById('gameConfirmModal').classList.remove('show');

        const gameContainer = document.getElementById('gameContainer');
        const startModal = document.getElementById('startModal');
        gameContainer.classList.remove('enemy-turn');
        gameContainer.style.display = 'none';
        startModal.style.display = 'flex';
        startModal.classList.add('modal-visible');

        // Reset processing lock and attack phase to clean state
        attackPhase = false;
        releaseProcessingLock();

        initializeStartMenuState();

        // Resume menu music without restarting if it is already active
        ensureStartMenuMusic();
    }

    function playAgain() {
        returnToMainMenu();
        showElementSelection();
    }

    // Pause/Resume Functions
    function pauseGame() {
        if (document.getElementById('gameContainer').style.display !== 'flex') {
            return;
        }

        playSFX('menuOpen');
        document.getElementById('pauseModal').classList.add('show');
    }

    function resumeGame(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        playSFX('menuClose');
        document.getElementById('pauseModal').classList.remove('show');

        // Safety fix: keep gameplay active after resuming from pause
        document.getElementById('startModal').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'flex';
    }

    function confirmQuit() {
        showConfirmModal('🏠 QUIT GAME?', 'Are you sure you want to quit to main menu? Current game will be lost.', function() {
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

    function selectDifficulty(difficulty) {
        playSFX('select');
        gameState.difficulty = difficulty;
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        document.querySelector(`[data-difficulty="${difficulty}"]`).classList.add('selected');
    }

    // Card Detail Popup
    function showCardDetail(card) {
        const popup = document.getElementById('cardDetailPopup');
        const emoji = document.getElementById('detailEmoji');
        const name = document.getElementById('detailName');
        const content = document.getElementById('detailContent');

        emoji.textContent = card.emoji;
        name.textContent = card.name;

        let html = '';

        if (card.type === 'land') {
            // Handle both single-color lands and dual lands
            let effectText;
            if (card.elements && card.elements.length > 1) {
                // Dual land
                const manaOptions = card.elements.map(el => ELEMENTS[el].emoji).join(' or ');
                effectText = `Tap to add ${manaOptions} to your mana pool`;
            } else if (card.element) {
                // Single color land
                effectText = `Tap to add ${ELEMENTS[card.element].emoji} to your mana pool`;
            } else {
                effectText = card.desc || 'Tap for mana';
            }

            html = `
                <div class="card-detail-section">
                    <div class="card-detail-info">
                        <span class="card-detail-label">Type:</span> Land
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Effect:</span> ${effectText}
                    </div>
                </div>
            `;
        } else if (card.type === 'creature') {
            const costStr = Object.entries(card.cost)
                .map(([el, val]) => `${ELEMENTS[el].emoji} ${val}`)
                .join(', ');
            
            const abilitiesStr = card.abilities && card.abilities.length > 0 
                ? card.abilities.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
                : 'None';

            html = `
                <div class="card-detail-section">
                    <div class="card-detail-info">
                        <span class="card-detail-label">Type:</span> Creature
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Cost:</span> ${costStr}
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Power/Toughness:</span> ${card.power}/${card.toughness}
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Abilities:</span> ${abilitiesStr}
                    </div>
                </div>
                <div class="card-detail-section">
                    <div class="card-detail-info" style="font-style: italic;">
                        ${card.desc || 'A mighty creature'}
                    </div>
                </div>
            `;
        } else if (card.type === 'instant') {
            const costStr = Object.entries(card.cost)
                .map(([el, val]) => `${ELEMENTS[el].emoji} ${val}`)
                .join(', ');

            html = `
                <div class="card-detail-section">
                    <div class="card-detail-info">
                        <span class="card-detail-label">Type:</span> Instant Spell
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Cost:</span> ${costStr}
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Effect:</span> ${card.desc || 'Magical effect'}
                    </div>
                </div>
            `;
        } else if (card.type === 'artifact') {
            const costStr = Object.entries(card.cost || {})
                .map(([el, val]) => `${ELEMENTS[el].emoji} ${val}`)
                .join(', ') || 'Free';

            html = `
                <div class="card-detail-section">
                    <div class="card-detail-info">
                        <span class="card-detail-label">Type:</span> Artifact
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Cost:</span> ${costStr}
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Effect:</span> ${card.desc || 'Powerful artifact'}
                    </div>
                </div>
            `;
        }

        content.innerHTML = html;
        popup.classList.add('show');
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
            cardRow.onclick = () => showCardDetail(card);
            graveyardList.appendChild(cardRow);
        });
    }

    // Close popup when clicking outside
    document.getElementById('cardDetailPopup').addEventListener('click', function(e) {
        if (e.target === this) {
            hideCardDetail();
        }
    });

    document.getElementById('graveyardModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideGraveyard();
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
        const btn = document.querySelector(`[data-element="${element}"]`);
        if (!btn) return;

        if (gameState.selectedElements.includes(element)) {
            gameState.selectedElements = gameState.selectedElements.filter(e => e !== element);
            btn.classList.remove('selected');
        } else if (gameState.selectedElements.length < getRequiredElementCount()) {
            gameState.selectedElements.push(element);
            btn.classList.add('selected');
        }

        updateStartButtonState();
    }

    // Deck Generation with improved shuffling
    function generateDeck(elements) {
        const deck = [];
        const LAND_COUNT = 25;
        const NON_LAND_COUNT = 35;
        const COLORLESS_LAND_COUNT = 3;

        if (elements.length === 1) {
            for (let i = 0; i < LAND_COUNT - COLORLESS_LAND_COUNT; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[0]], id: Math.random() });
            }
        } else {
            const coloredLandPool = LAND_COUNT - COLORLESS_LAND_COUNT;
            const firstLandCount = 10 + Math.floor(Math.random() * 3); // 10-12
            const secondLandCount = coloredLandPool - firstLandCount;
            for (let i = 0; i < firstLandCount; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[0]], id: Math.random() });
            }
            for (let i = 0; i < secondLandCount; i++) {
                deck.push({ ...CARD_DATABASE.lands[elements[1]], id: Math.random() });
            }
        }

        for (let i = 0; i < COLORLESS_LAND_COUNT; i++) {
            deck.push({ ...CARD_DATABASE.lands.wasteland, id: Math.random() });
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

        const creatureTarget = 18 + Math.floor(Math.random() * 7); // 18-24
        const spellTarget = 7 + Math.floor(Math.random() * 7); // 7-13
        const artifactTarget = Math.max(0, NON_LAND_COUNT - creatureTarget - spellTarget);

        function addCardsFromPool(pool, count) {
            for (let i = 0; i < count; i++) {
                if (pool.length > 0) {
                    const card = pool[Math.floor(Math.random() * pool.length)];
                    deck.push({ ...card, id: Math.random() });
                }
            }
        }

        addCardsFromPool(creatures, creatureTarget);
        addCardsFromPool(spells, spellTarget);
        addCardsFromPool(artifacts, artifactTarget);

        const fallbackPool = [...creatures, ...spells, ...artifacts];
        while (deck.length < LAND_COUNT + NON_LAND_COUNT && fallbackPool.length > 0) {
            const card = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
            deck.push({ ...card, id: Math.random() });
        }

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck;
    }

    // Shuffle deck function (Fisher-Yates algorithm)
    function shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    // Start Game
    // Mulligan function
    function mulligan() {
        if (mulliganUsed || playerFirstTurnCompleted) {
            showGameLog('⚠️ You can only mulligan once at the start!', false);
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
        playSFX('select');

        // Return hand to deck
        gameState.playerDeck = gameState.playerDeck.concat(gameState.playerHand);
        gameState.playerHand = [];

        // Shuffle deck properly
        shuffleDeck(gameState.playerDeck);

        // Draw 6 cards
        for (let i = 0; i < 6; i++) {
            drawCard('player');
        }

        mulliganUsed = true;
        document.getElementById('mulliganBtn').disabled = true;
        document.getElementById('mulliganBtn').style.opacity = '0.5';

        showGameLog('🔄 Mulligan - Drew 6 new cards', false);
        updateUI();
        updateDeckCounters();
    }

    // Update deck counters
    function updateDeckCounters() {
        document.getElementById('playerDeckCount').textContent = gameState.playerDeck.length;
        document.getElementById('enemyDeckCount').textContent = gameState.enemyDeck.length;
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

        isStartingGame = true;
        const startBtn = document.getElementById('startBtn');
        if (startBtn) {
            startBtn.disabled = true;
        }

        playSFX('select');

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

        // Generate decks
        gameState.playerDeck = generateDeck(gameState.selectedElements);

        // AI picks random elements
        const elementKeys = Object.keys(ELEMENTS);
        const aiRequiredCount = Math.random() < 0.5 ? 1 : 2;
        const aiElements = [];
        while (aiElements.length < aiRequiredCount) {
            const element = elementKeys[Math.floor(Math.random() * elementKeys.length)];
            if (!aiElements.includes(element)) {
                aiElements.push(element);
            }
        }
        gameState.enemyDeck = generateDeck(aiElements);

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
        document.getElementById('attackBtn').innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
        document.getElementById('attackBtn').onclick = enterAttackPhase;

        updateUI();
        updateDeckCounters();

        setTimeout(() => {
            isStartingGame = false;
        }, 300);
    }

    // Draw Card
    function drawCard(player) {
        if (player === 'player' && gameState.playerDeck.length > 0) {
            gameState.playerHand.push(gameState.playerDeck.pop());
        } else if (player === 'enemy' && gameState.enemyDeck.length > 0) {
            gameState.enemyHand.push(gameState.enemyDeck.pop());
        }
    }

    // Play Card
    function playCard(cardId) {
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

        // Set processing lock to prevent rapid clicking (with 3 second failsafe)
        setProcessingLock(3000);

        // Pay cost
        if (card.type !== 'land') {
            payCost(cardCost, gameState.playerMana);
        }

        // Remove from hand
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== cardId);

        // Play the card
        if (card.type === 'land') {
            // Lands go to board and generate mana
            gameState.playerBoard.push({...card, tapped: false});
            gameState.landsPlayedThisTurn++;  // Increment land counter
            showGameLog(`🌍 You play ${card.name}`, false);
        } else if (card.type === 'creature') {
            gameState.playerBoard.push({...card, tapped: false, summoningSick: !card.abilities?.includes('haste'), damage: 0});
            // Play appropriate creature summon sound based on theme
            if (card.theme === 'Science Fiction') {
                playSFX('summonCreatureScifi');
            } else {
                playSFX('summonCreatureFantasy');
            }
            showGameLog(`${card.emoji} You summon ${card.name}`, false, card.theme === 'Science Fiction');
        } else if (card.type === 'artifact') {
            const artifactOnBoard = {...card, tapped: false};
            gameState.playerBoard.push(artifactOnBoard);
            playSFX('summonInstant');
            showGameLog(`${card.emoji} You play ${card.name}`, false, card.theme === 'Science Fiction');

            // Trigger artifact effects that should happen immediately when played
            if (['buff', 'buff_defense', 'aoe', 'draw_on_play'].includes(card.effect)) {
                resolveSpell(artifactOnBoard, 'player');
                checkStateBasedActions();

                if (isOneShotArtifactEffect(card.effect)) {
                    sendBoardCardToGraveyard(artifactOnBoard.id, 'player');
                }
            }
        } else if (card.type === 'instant') {
            playSFX('summonInstant');
            showGameLog(`${card.emoji} You cast ${card.name}`, false, card.theme === 'Science Fiction');
            resolveSpell(card, 'player');
            moveCardToGraveyard(card, 'player');
            // Check for dead creatures after spell resolves
            checkStateBasedActions();
        }

        // Particles
        const handEl = document.getElementById('playerHand');
        const rect = handEl.getBoundingClientRect();
        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ffd700', 30);

        updateUI();

        // Release processing lock after a short delay
        setTimeout(() => {
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
                setTimeout(() => { modal.style.display = 'none'; }, 250);
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
            setTimeout(() => { modal.style.display = 'none'; }, 250);
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

        function closeModal() {
            modal.classList.remove('show');
            setTimeout(() => { modal.style.display = 'none'; }, 250);
        }

        newYes.addEventListener('click', function() {
            closeModal();
            if (onConfirm) onConfirm();
        });
        newNo.addEventListener('click', function() {
            closeModal();
            if (onCancel) onCancel();
        });

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('show');
    }

    // Tap lands for mana
    function tapLand(cardId) {
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

        // If tapped, UNTAP it and refund mana
        if (card.tapped) {
            card.tapped = false;
            const elementToRefund = isDualLand ? storedElement : card.element;
            if (elementToRefund && gameState.playerMana[elementToRefund] > 0) {
                gameState.playerMana[elementToRefund]--;
                playSFX('untap');
                showGameLog(`🔄 You untap ${card.name} (mana refunded)`, false);
                updateUI();
            }
            return;
        }

        // Otherwise tap it for mana
        let elementToAdd;

        if (isDualLand) {
            // DUAL LAND: Show mana choice modal instead of prompt
            showManaChoiceModal(card, function(chosenElement) {
                card.selectedElement = chosenElement;
                card.tapped = true;
                gameState.playerMana[chosenElement] = (gameState.playerMana[chosenElement] || 0) + 1;
                playSFX('tapLand');
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

        playSFX('tapLand');
        showGameLog(`⚡ You tap ${card.name} for ${elementToAdd} mana`, false);

        updateUI();
    }

    // Tap ALL untapped lands of a given element type at once
    function tapAllLandsOfType(landKey) {
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
            playSFX('tapLand');
            showGameLog(`⚡ You tap ${tappedCount} ${untappedLands[0].name}${tappedCount > 1 ? 's' : ''} for mana`, false);
            updateUI();
        }
    }

    function activateArtifact(cardId) {
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

        playSFX('tapLand');
        showGameLog(`⚡ ${card.name} adds ${ELEMENTS[manaToAdd].emoji} mana`, false);
        updateUI();
    }

    function moveCardToGraveyard(card, owner) {
        if (!card) return;

        const graveyard = owner === 'player' ? gameState.playerGraveyard : gameState.enemyGraveyard;
        graveyard.push({...card, tapped: false, damage: 0});
    }

    function isOneShotArtifactEffect(effect) {
        return ['buff', 'buff_defense', 'aoe', 'draw_on_play', 'token', 'destroy', 'bounce', 'tap', 'discard', 'discard_draw'].includes(effect);
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
                    // Damage all creatures
                    const board = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                    board.forEach(c => {
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
                    playSFX('playerHeal');
                    const playerInfoHD = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rectHD = playerInfoHD.getBoundingClientRect();
                    createSparkles(rectHD.left + rectHD.width / 2, rectHD.top + rectHD.height / 2, 20);
                } else {
                    changeEnemyLife(card.value);
                    playSFX('opponentHeals');
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
                if (isCasterPlayer) {
                    changeEnemyLife(-card.value);
                    changePlayerLife(card.value);
                    const playerInfo = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rect = playerInfo.getBoundingClientRect();
                    createSparkles(rect.left + rect.width / 2, rect.top + rect.height / 2, 15);
                } else {
                    changePlayerLife(-card.value);
                    changeEnemyLife(card.value);
                }
                showGameLog(`💉 Drain ${card.value} life`, !isCasterPlayer);
                break;

            case 'destroy':
                // Destroy target creature (simplified - destroys a random creature)
                const targetBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const creatures = targetBoard.filter(c => c.type === 'creature' && !c.abilities?.includes('hexproof'));
                if (creatures.length > 0) {
                    const target = creatures[Math.floor(Math.random() * creatures.length)];
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
                    const buffTargets = card.targetAll ? friendlyCreatures : [friendlyCreatures[Math.floor(Math.random() * friendlyCreatures.length)]];
                    const isPowerOnly = card.buffType === 'power';
                    buffTargets.forEach(target => {
                        if (card.value > 0) {
                            target.power = (target.power || 0) + card.value;
                            if (!isPowerOnly) {
                                target.toughness = (target.toughness || 0) + card.value;
                            }
                        }
                        if (card.grantAbilities) {
                            card.grantAbilities.forEach(ability => {
                                if (!target.abilities) target.abilities = [];
                                if (!target.abilities.includes(ability)) {
                                    target.abilities.push(ability);
                                }
                            });
                        }
                    });
                    // Build log message
                    const buffStr = card.value > 0 ? (isPowerOnly ? `+${card.value}/+0` : `+${card.value}/+${card.value}`) : '';
                    const abilityStr = card.grantAbilities ? (buffStr ? ' and ' : '') + card.grantAbilities.join(', ') : '';
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
                    const defTargets = card.targetAll ? friendlyCreatures2 : [friendlyCreatures2[Math.floor(Math.random() * friendlyCreatures2.length)]];
                    defTargets.forEach(target => {
                        target.toughness = (target.toughness || 0) + card.value;
                        if (card.grantAbilities) {
                            card.grantAbilities.forEach(ability => {
                                if (!target.abilities) target.abilities = [];
                                if (!target.abilities.includes(ability)) {
                                    target.abilities.push(ability);
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
                // Tap a random enemy creature
                const enemyBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const untappedCreatures = enemyBoard.filter(c => c.type === 'creature' && !c.tapped && !c.abilities?.includes('hexproof'));
                if (untappedCreatures.length > 0) {
                    const target = untappedCreatures[Math.floor(Math.random() * untappedCreatures.length)];
                    target.tapped = true;
                    showGameLog(`❄️ ${target.emoji} ${target.name} is tapped!`, !isCasterPlayer);
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
                        const idx = Math.floor(Math.random() * bounceable.length);
                        const target = bounceable[idx];
                        bounceable.splice(idx, 1);
                        target.tapped = false;
                        target.damage = 0;
                        enemyHand.push(target);
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
                if (graveyard.length > 0) {
                    const revived = graveyard.pop();
                    revived.damage = 0;
                    revived.tapped = false;
                    revived.id = Math.random(); // New ID
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

            case 'token':
                // Create token creatures
                const tokenBoard = isCasterPlayer ? gameState.playerBoard : gameState.enemyBoard;
                const tokenCount = card.value || 1;

                let tokenStats = { power: 1, toughness: 1, abilities: [] };
                let tokenEmoji = '🪙';
                let tokenName = 'Token';

                if (card.tokenType === 'spirit') {
                    tokenStats = { power: 1, toughness: 1, abilities: ['flying'] };
                    tokenEmoji = '👻';
                    tokenName = 'Spirit Token';
                } else if (card.tokenType === 'soldier') {
                    tokenStats = { power: 1, toughness: 1, abilities: [] };
                    tokenEmoji = '🗡️';
                    tokenName = 'Soldier Token';
                } else if (card.tokenType === 'beast') {
                    tokenStats = { power: 2, toughness: 2, abilities: [] };
                    tokenEmoji = '🐻';
                    tokenName = 'Beast Token';
                }

                for (let i = 0; i < tokenCount; i++) {
                    const token = {
                        id: Math.random(),
                        emoji: tokenEmoji,
                        type: 'creature',
                        cardType: 'Creature Token',
                        name: tokenName,
                        power: tokenStats.power,
                        toughness: tokenStats.toughness,
                        abilities: tokenStats.abilities,
                        cost: {},
                        tapped: false,
                        summoningSick: !tokenStats.abilities.includes('haste'),
                        damage: 0,
                        theme: 'Fantasy'
                    };
                    tokenBoard.push(token);
                }

                showGameLog(`✨ Created ${tokenCount} ${tokenName}${tokenCount > 1 ? 's' : ''}!`, !isCasterPlayer);
                createSparkles(window.innerWidth / 2, window.innerHeight / 2, 20);
                break;

            case 'discard':
                // Force opponent to discard cards
                const discardHand = isCasterPlayer ? gameState.enemyHand : gameState.playerHand;
                const discardCount = Math.min(card.value || 1, discardHand.length);

                for (let i = 0; i < discardCount; i++) {
                    if (discardHand.length > 0) {
                        const randomIndex = Math.floor(Math.random() * discardHand.length);
                        const discarded = discardHand.splice(randomIndex, 1)[0];
                        moveCardToGraveyard(discarded, isCasterPlayer ? 'enemy' : 'player');
                        showGameLog(`🗑️ ${discarded.emoji} ${discarded.name} is discarded!`, isCasterPlayer);
                    }
                }
                break;

            case 'discard_draw':
                // Opponent discards, caster draws
                const discardHand2 = isCasterPlayer ? gameState.enemyHand : gameState.playerHand;
                const discardDrawCount = Math.min(card.value || 1, discardHand2.length);

                for (let i = 0; i < discardDrawCount; i++) {
                    if (discardHand2.length > 0) {
                        const randomIndex = Math.floor(Math.random() * discardHand2.length);
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
        const availableAttackers = gameState.playerBoard.filter(c =>
            c.type === 'creature' && !c.tapped && !c.summoningSick && !c.abilities?.includes('defender')
        );

        if (availableAttackers.length === 0) {
            showGameLog('⚠️ You have no creatures available to attack!', false);
            return;
        }

        attackPhase = true;
        gameState.attackers = [];
        gameState.phase = 'attack';
        document.getElementById('phaseIndicator').textContent = 'DECLARE ATTACKERS';
        document.getElementById('attackBtn').innerHTML = '<span class="btn-text">✓ CONFIRM</span>';
        document.getElementById('attackBtn').onclick = confirmAttackers;
        updateUI();
    }

    function selectAttacker(cardId) {
        if (!attackPhase) return;
        
        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card || card.type !== 'creature' || card.tapped || card.summoningSick || card.abilities?.includes('defender')) return;

        if (gameState.attackers.includes(cardId)) {
            gameState.attackers = gameState.attackers.filter(id => id !== cardId);
        } else {
            gameState.attackers.push(cardId);
        }

        updateUI();
    }

    function confirmAttackers() {
        // Turn enforcement
        if (gameState.turn !== 'player' || isProcessingAction) {
            return;
        }

        if (gameState.attackers.length === 0) {
            attackPhase = false;
            gameState.phase = 'main';
            document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
            document.getElementById('attackBtn').innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
            document.getElementById('attackBtn').onclick = enterAttackPhase;
            showGameLog('🛡️ You choose not to attack', false);
            return;
        }

        // VIGILANCE FIX: Mark that player has attacked this turn
        gameState.hasAttackedThisTurn = true;

        // Set processing lock (with 5 second failsafe for combat)
        setProcessingLock(5000);

        playSFX('attack');
        showGameLog(`⚔️ You attack with ${gameState.attackers.length} creature${gameState.attackers.length > 1 ? 's' : ''}!`, false);

        // AI declares blockers
        aiDeclareBlockers();

        // Resolve combat
        resolveCombat();

        attackPhase = false;
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        document.getElementById('attackBtn').innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
        document.getElementById('attackBtn').onclick = enterAttackPhase;

        checkGameOver();
        updateUI();

        // Release processing lock after combat resolves
        setTimeout(() => {
            releaseProcessingLock();
        }, 300);
    }

    function hasAbility(creature, ability) {
        return creature?.abilities?.includes(ability);
    }

    function canBlockAttacker(blocker, attacker) {
        if (!blocker || blocker.type !== 'creature' || blocker.tapped) return false;
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

    function applyDamage(attacker, blockers, isPlayerAttacking) {
        const adjustLifeByController = (isPlayerControlled, amount) => {
            if (amount <= 0) return;
            if (isPlayerControlled) {
                changePlayerLife(amount);
            } else {
                changeEnemyLife(amount);
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
                        changeEnemyLife(-remainingAttackDamage);
                    } else {
                        changePlayerLife(-remainingAttackDamage);
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
        gameState.attackers.forEach(attackerId => {
            const attacker = gameState.playerBoard.find(c => c.id === attackerId);
            if (!attacker) return;

            if (!hasAbility(attacker, 'vigilance')) {
                attacker.tapped = true;
            }

            const blockerIds = gameState.blockers[attackerId] || [];
            const blockers = blockerIds.map(id => gameState.enemyBoard.find(c => c.id === id)).filter(Boolean);

            if (blockers.length > 0) {
                applyDamage(attacker, blockers, true);
            } else {
                changeEnemyLife(-(attacker.power || 0));
                if (hasAbility(attacker, 'lifelink')) {
                    changePlayerLife(attacker.power || 0);
                }
            }
        });

        checkStateBasedActions();
        gameState.attackers = [];
        gameState.blockers = {};
    }

    // End Turn
    function endTurn() {
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

        // Untap all player permanents
        gameState.playerBoard.forEach(card => {
            card.tapped = false;
            if (card.type === 'creature') {
                card.summoningSick = false;
            }
        });

        // Reset mana
        gameState.playerMana = {};

        // CRITICAL FIX: Reset land counter at end of turn (safety check)
        gameState.landsPlayedThisTurn = 0;

        // VIGILANCE FIX: Reset attack flag for next turn
        gameState.hasAttackedThisTurn = false;

        // Clear temporary combat damage at end of turn
        clearCombatDamage();

        gameState.turn = 'enemy';
        gameState.phase = 'enemy';
        document.getElementById('phaseIndicator').textContent = 'ENEMY TURN';
        document.getElementById('gameContainer').classList.add('enemy-turn');

        updateUI();

        // AI turn
        setTimeout(() => {
            aiTurn();
        }, 1500);
    }

    // Process upkeep effects for artifacts
    function processUpkeepEffects(isPlayer) {
        const board = isPlayer ? gameState.playerBoard : gameState.enemyBoard;
        const artifacts = board.filter(c => c.type === 'artifact');

        artifacts.forEach(artifact => {
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
        });
    }

    // Start player turn
    function startPlayerTurn() {
        document.getElementById('gameContainer').classList.remove('enemy-turn');

        gameState.turn = 'player';
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';

        // CRITICAL FIX: Ensure attack phase is reset and button is restored
        attackPhase = false;
        gameState.attackers = [];
        document.getElementById('attackBtn').innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
        document.getElementById('attackBtn').onclick = enterAttackPhase;

        // Draw card at start of turn
        drawCard('player');
        showGameLog('📜 You draw a card', false);

        // Process upkeep effects from artifacts
        processUpkeepEffects(true);

        // Untap and reset mana
        gameState.playerBoard.forEach(card => {
            card.tapped = false;
            if (card.type === 'creature') {
                card.summoningSick = false;
            }
        });
        gameState.playerMana = {};

        // Reset land counter for new turn
        gameState.landsPlayedThisTurn = 0;

        // Clear temporary combat damage from enemy turn combat
        clearCombatDamage();

        updateUI();

        // Release processing lock - player can now take actions
        releaseProcessingLock();
    }

    // AI Turn
    function aiTurn() {
        // Emergency failsafe: ensure player turn starts even if something goes wrong
        const emergencyTurnStart = setTimeout(() => {
            console.warn('Emergency turn transition triggered');
            if (gameState.turn === 'enemy') {
                startPlayerTurn();
            }
        }, 12000); // 12 seconds maximum for AI turn

        try {
            // Untap enemy permanents
            gameState.enemyBoard.forEach(card => {
                card.tapped = false;
                if (card.type === 'creature') {
                    card.summoningSick = false;
                }
            });
            gameState.enemyMana = {};

            // Draw card
            drawCard('enemy');
            showGameLog('🎴 Enemy draws a card', true);

            // Process upkeep effects from enemy artifacts
            processUpkeepEffects(false);

            setTimeout(() => {
            // Play lands
            const landInHand = gameState.enemyHand.find(c => c.type === 'land');
            if (landInHand) {
                gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== landInHand.id);
                gameState.enemyBoard.push({...landInHand, tapped: false});
                showGameLog(`🌍 Enemy plays ${landInHand.name}`, true);
                updateUI();
            }

            setTimeout(() => {
                // Tap lands for mana
                let manaTapped = false;
                gameState.enemyBoard.forEach(card => {
                    if (card.type === 'land' && !card.tapped) {
                        card.tapped = true;
                        // DUAL LAND SUPPORT: Handle lands with multiple elements
                        if (card.elements && Array.isArray(card.elements) && card.elements.length > 0) {
                            // For dual lands, AI chooses the first element (can be made smarter later)
                            const chosenElement = card.elements[0];
                            if (chosenElement) {
                                gameState.enemyMana[chosenElement] = (gameState.enemyMana[chosenElement] || 0) + 1;
                                manaTapped = true;
                            }
                        } else if (card.element) {
                            // Regular single-color land
                            gameState.enemyMana[card.element] = (gameState.enemyMana[card.element] || 0) + 1;
                            manaTapped = true;
                        }
                    }
                });

                if (manaTapped) {
                    showGameLog('⚡ Enemy taps lands for mana', true);
                    updateUI();
                }

                setTimeout(() => {
                    // Play creatures based on difficulty
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
                    playableCreatures.forEach(creature => {
                        if (canPayCost(creature.cost, gameState.enemyMana)) {
                            payCost(creature.cost, gameState.enemyMana);
                            gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== creature.id);
                            gameState.enemyBoard.push({...creature, tapped: false, summoningSick: !creature.abilities?.includes('haste'), damage: 0});
                            showGameLog(`${creature.emoji} Enemy summons ${creature.name}`, true, creature.theme === 'scifi');
                            creaturePlayed = true;
                        }
                    });

                    if (creaturePlayed) {
                        updateUI();
                    }

                    setTimeout(() => {
                        // Play artifacts
                        const playableArtifacts = gameState.enemyHand
                            .filter(c => c.type === 'artifact' && canPayCost(c.cost, gameState.enemyMana));

                        let artifactPlayed = false;
                        playableArtifacts.forEach(artifact => {
                            if (canPayCost(artifact.cost, gameState.enemyMana)) {
                                payCost(artifact.cost, gameState.enemyMana);
                                gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== artifact.id);
                                const artifactOnBoard = {...artifact, tapped: false};
                                gameState.enemyBoard.push(artifactOnBoard);
                                showGameLog(`${artifact.emoji} Enemy plays ${artifact.name}`, true);

                                if (['buff', 'buff_defense', 'aoe', 'draw_on_play'].includes(artifact.effect)) {
                                    resolveSpell(artifactOnBoard, 'enemy');
                                    checkStateBasedActions();

                                    if (isOneShotArtifactEffect(artifact.effect)) {
                                        sendBoardCardToGraveyard(artifactOnBoard.id, 'enemy');
                                    }
                                }

                                artifactPlayed = true;
                            }
                        });

                        if (artifactPlayed) {
                            updateUI();
                        }

                        // Play spells on hard difficulty
                        if (gameState.difficulty === 'hard') {
                            const playableSpells = gameState.enemyHand
                                .filter(c => c.type === 'instant' && canPayCost(c.cost, gameState.enemyMana));
                            
                            let spellPlayed = false;
                            playableSpells.forEach(spell => {
                                if (canPayCost(spell.cost, gameState.enemyMana)) {
                                    payCost(spell.cost, gameState.enemyMana);
                                    gameState.enemyHand = gameState.enemyHand.filter(c => c.id !== spell.id);
                                    showGameLog(`${spell.emoji} Enemy casts ${spell.name}`, true);
                                    resolveSpell(spell, 'enemy');
                                    moveCardToGraveyard(spell, 'enemy');
                                    // Check for dead creatures after spell resolves
                                    checkStateBasedActions();
                                    spellPlayed = true;
                                }
                            });

                            if (spellPlayed) {
                                updateUI();
                            }
                        }

                        setTimeout(() => {
                            // Attack with creatures - MUCH MORE AGGRESSIVE AI
                            const attackers = gameState.enemyBoard.filter(c =>
                                c.type === 'creature' && !c.tapped && !c.summoningSick && !c.abilities?.includes('defender')
                            );

                            let attackingCreatures = [];
                            if (gameState.difficulty === 'easy') {
                                // Easy: 70% chance to attack with each creature
                                attackingCreatures = attackers.filter(() => Math.random() > 0.3);
                            } else if (gameState.difficulty === 'medium') {
                                // Medium: Attack with all non-defender creatures
                                attackingCreatures = attackers;
                            } else {
                                // Hard: Attack with ALL non-defender creatures (most aggressive)
                                attackingCreatures = attackers;
                            }

                            resolveEnemyAttackPhase(attackingCreatures);

                            updateUI();
                            checkGameOver();

                            setTimeout(() => {
                                clearTimeout(emergencyTurnStart); // Clear emergency failsafe
                                startPlayerTurn();
                            }, 1500);
                        }, 1500);
                    }, 1500);
                }, 1500);
            }, 1500);
        }, 1000);
        } catch (error) {
            console.error('Error during AI turn:', error);
            clearTimeout(emergencyTurnStart);
            // Ensure turn transitions back to player even on error
            setTimeout(() => {
                startPlayerTurn();
            }, 1000);
        }
    }


    function declarePlayerBlockers(enemyAttackers) {
        const availableBlockers = gameState.playerBoard.filter(c => c.type === 'creature' && !c.tapped);
        return assignAutoBlockers(enemyAttackers, availableBlockers);
    }

    function resolveEnemyAttackPhase(attackingCreatures) {
        if (attackingCreatures.length > 0) {
            showGameLog(`⚔️ Enemy attacks with ${attackingCreatures.length} creature${attackingCreatures.length > 1 ? 's' : ''}!`, true);
            showGameLog('🛡️ You declare blockers', false);
            playSFX('attack');
        } else {
            showGameLog('🛡️ Enemy does not attack', true);
            return;
        }

        const playerBlockers = declarePlayerBlockers(attackingCreatures);
        if (Object.keys(playerBlockers).length > 0) {
            playSFX('block');
        }

        attackingCreatures.forEach(attacker => {
            if (!hasAbility(attacker, 'vigilance')) {
                attacker.tapped = true;
            }

            const blockerIds = playerBlockers[attacker.id] || [];
            const blockers = blockerIds.map(id => gameState.playerBoard.find(c => c.id === id)).filter(Boolean);

            if (blockers.length > 0) {
                applyDamage(attacker, blockers, false);
            } else {
                changePlayerLife(-(attacker.power || 0));
                if (hasAbility(attacker, 'lifelink')) {
                    changeEnemyLife(attacker.power || 0);
                }
            }

            const playerArea = document.querySelector('.player-area:not(.enemy-area)');
            const rect = playerArea.getBoundingClientRect();
            createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#dc143c', 30);
        });

        checkStateBasedActions();
    }

    // Helper functions for lifepoint changes with sound and animation
    function changePlayerLife(amount) {
        const oldLife = gameState.playerLife;
        gameState.playerLife = Math.max(0, gameState.playerLife + amount);
        const actualChange = gameState.playerLife - oldLife;

        if (actualChange !== 0) {
            const lifeElement = document.getElementById('playerLife');
            if (actualChange > 0) {
                // Life increase - play heal sound for each point
                for (let i = 0; i < actualChange; i++) {
                    setTimeout(() => playSFX('playerHeal'), i * 100);
                }
                lifeElement.classList.add('life-increase');
                setTimeout(() => lifeElement.classList.remove('life-increase'), 500);
            } else {
                // Life decrease - play damage sound for each point
                for (let i = 0; i < Math.abs(actualChange); i++) {
                    setTimeout(() => playSFX('playerTakeDamage'), i * 100);
                }
                lifeElement.classList.add('life-decrease');
                setTimeout(() => lifeElement.classList.remove('life-decrease'), 300);
            }
        }
    }

    function changeEnemyLife(amount) {
        const oldLife = gameState.enemyLife;
        gameState.enemyLife = Math.max(0, gameState.enemyLife + amount);
        const actualChange = gameState.enemyLife - oldLife;

        if (actualChange !== 0) {
            const lifeElement = document.getElementById('enemyLife');
            if (actualChange > 0) {
                // Life increase - play heal sound for each point
                for (let i = 0; i < actualChange; i++) {
                    setTimeout(() => playSFX('opponentHeals'), i * 100);
                }
                lifeElement.classList.add('life-increase');
                setTimeout(() => lifeElement.classList.remove('life-increase'), 500);
            } else {
                // Life decrease - play damage sound for each point
                for (let i = 0; i < Math.abs(actualChange); i++) {
                    setTimeout(() => playSFX('opponentTakeDamage'), i * 100);
                }
                lifeElement.classList.add('life-decrease');
                setTimeout(() => lifeElement.classList.remove('life-decrease'), 300);
            }
        }
    }

    // Check Game Over
    function checkGameOver() {
        if (gameState.playerLife <= 0) {
            gameStats.losses++;
            gameStats.total++;
            saveStats();

            // Stop gameplay music and play lose sound
            stopSFX('gameplayMusic');
            playSFX('gameLose');

            // Show lose overlay
            const loseOverlay = document.getElementById('loseOverlay');
            loseOverlay.classList.add('show');
        } else if (gameState.enemyLife <= 0) {
            gameStats.wins++;
            gameStats.total++;
            saveStats();

            // Stop gameplay music and play victory sound
            stopSFX('gameplayMusic');
            playSFX('gameVictory');

            // Show victory overlay
            const victoryOverlay = document.getElementById('victoryOverlay');
            victoryOverlay.classList.add('show');
        }
    }

    // Update UI
    function updateUI() {
        // Update life totals
        document.getElementById('playerLife').textContent = gameState.playerLife;
        document.getElementById('enemyLife').textContent = gameState.enemyLife;

        // Update deck counters
        updateDeckCounters();

        // Update mana pools
        updateManaDisplay('playerMana', gameState.playerMana);
        updateManaDisplay('enemyMana', gameState.enemyMana);

        // Update player hand
        const handEl = document.getElementById('playerHand');
        handEl.innerHTML = '';
        gameState.playerHand.forEach(card => {
            const cardEl = createCardElement(card, false);
            attachDesktopTooltip(cardEl, card);

            if (card.type === 'land') {
                if (gameState.landsPlayedThisTurn < 1) {
                    cardEl.classList.add('playable');
                }
            } else if (canPayCost(card.cost, gameState.playerMana)) {
                cardEl.classList.add('playable');
            }

            if (card.type !== 'land' && !canPayCost(card.cost, gameState.playerMana)) {
                cardEl.classList.add('unplayable');
            }
            if (card.type === 'land' && gameState.landsPlayedThisTurn >= 1) {
                cardEl.classList.add('unplayable');
            }
            
            // Click to play
            cardEl.onclick = () => playCard(card.id);
            
            // Right-click or long-press to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
            };

            let longPressTimer;
            let touchMoved = false;

            cardEl.ontouchstart = (e) => {
                touchMoved = false;
                // IMPROVED: Faster long-press response (350ms instead of 500ms)
                longPressTimer = setTimeout(() => {
                    if (!touchMoved) {
                        // Add haptic feedback on mobile devices
                        if (navigator.vibrate) {
                            navigator.vibrate(50); // Short vibration for feedback
                        }
                        showCardDetail(card);
                    }
                }, 350);
            };

            cardEl.ontouchmove = () => {
                touchMoved = true;
                clearTimeout(longPressTimer);
            };

            cardEl.ontouchend = (e) => {
                clearTimeout(longPressTimer);
                if (!touchMoved) {
                    e.preventDefault();
                    playCard(card.id);
                }
            };

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

            // "Tap all" button (shown on hover / long-press)
            if (untappedCount > 1) {
                const tapAllBtn = document.createElement('div');
                tapAllBtn.className = 'land-stack-tap-all';
                tapAllBtn.textContent = '⚡';
                tapAllBtn.title = 'Tap all untapped';
                tapAllBtn.onclick = (e) => {
                    e.stopPropagation();
                    tapAllLandsOfType(element);
                };
                stackCard.appendChild(tapAllBtn);
            }

            // Click to tap one untapped land
            stackCard.onclick = () => {
                const untappedLand = stack.find(c => !c.tapped);
                if (untappedLand) {
                    tapLand(untappedLand.id);
                } else {
                    // All tapped - untap the last tapped one
                    const tappedLand = stack.find(c => c.tapped);
                    if (tappedLand) {
                        tapLand(tappedLand.id);
                    }
                }
            };

            // Right-click to tap ALL untapped lands of this type
            stackCard.oncontextmenu = (e) => {
                e.preventDefault();
                if (untappedCount > 0) {
                    tapAllLandsOfType(element);
                } else {
                    showCardDetail(representativeCard);
                }
            };

            // Long-press: show tap-all indicator, then tap all on release
            let landStackLongPressTimer;
            let landStackTouchMoved = false;
            let landStackLongPressed = false;

            stackCard.ontouchstart = (e) => {
                landStackTouchMoved = false;
                landStackLongPressed = false;
                landStackLongPressTimer = setTimeout(() => {
                    if (!landStackTouchMoved) {
                        landStackLongPressed = true;
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }
                        if (untappedCount > 1) {
                            tapAllLandsOfType(element);
                        } else {
                            showCardDetail(representativeCard);
                        }
                    }
                }, 350);
            };

            stackCard.ontouchmove = () => {
                landStackTouchMoved = true;
                clearTimeout(landStackLongPressTimer);
                stackCard.classList.remove('show-tap-all');
            };

            stackCard.ontouchend = (e) => {
                clearTimeout(landStackLongPressTimer);
                stackCard.classList.remove('show-tap-all');
                if (landStackLongPressed) {
                    e.preventDefault();
                    return;
                }

                if (!landStackTouchMoved) {
                    e.preventDefault();
                    const untappedLand = stack.find(c => !c.tapped);
                    if (untappedLand) {
                        tapLand(untappedLand.id);
                    } else {
                        const tappedLand = stack.find(c => c.tapped);
                        if (tappedLand) {
                            tapLand(tappedLand.id);
                        }
                    }
                }
            };

            boardEl.appendChild(stackCard);
        });

        // Display non-land cards normally
        nonLands.forEach(card => {
            const cardEl = createCardElement(card, true);
            attachDesktopTooltip(cardEl, card);
            
            if (card.type === 'creature' && attackPhase) {
                cardEl.onclick = () => selectAttacker(card.id);
                if (gameState.attackers.includes(card.id)) {
                    cardEl.classList.add('attacking');
                }
            } else if (card.type === 'artifact' && !attackPhase) {
                cardEl.onclick = () => activateArtifact(card.id);
            }

            // Right-click or long-press to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
            };

            let boardLongPressTimer;
            let boardTouchMoved = false;

            cardEl.ontouchstart = (e) => {
                boardTouchMoved = false;
                boardLongPressTimer = setTimeout(() => {
                    if (!boardTouchMoved) {
                        // Haptic feedback for mobile
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }
                        showCardDetail(card);
                    }
                }, 350);
            };

            cardEl.ontouchmove = () => {
                boardTouchMoved = true;
                clearTimeout(boardLongPressTimer);
            };

            cardEl.ontouchend = (e) => {
                clearTimeout(boardLongPressTimer);
                if (!boardTouchMoved) {
                    e.preventDefault();
                    if (card.type === 'creature' && attackPhase) {
                        selectAttacker(card.id);
                    } else if (card.type === 'artifact' && !attackPhase) {
                        activateArtifact(card.id);
                    }
                }
            };

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

            // Long-press to view card detail (display only, no tap interaction)
            stackCard.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(representativeCard);
            };

            let enemyLandStackLPTimer;
            let enemyLandStackTouchMoved = false;

            stackCard.ontouchstart = () => {
                enemyLandStackTouchMoved = false;
                enemyLandStackLPTimer = setTimeout(() => {
                    if (!enemyLandStackTouchMoved) {
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }
                        showCardDetail(representativeCard);
                    }
                }, 350);
            };

            stackCard.ontouchmove = () => {
                enemyLandStackTouchMoved = true;
                clearTimeout(enemyLandStackLPTimer);
            };

            stackCard.ontouchend = () => {
                clearTimeout(enemyLandStackLPTimer);
            };

            enemyBoardEl.appendChild(stackCard);
        });

        // Display enemy non-land cards normally
        enemyNonLands.forEach(card => {
            const cardEl = createCardElement(card, true, true);
            attachDesktopTooltip(cardEl, card);

            // Right-click or long-press to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
            };

            let enemyBoardLongPressTimer;
            let enemyBoardTouchMoved = false;

            cardEl.ontouchstart = (e) => {
                enemyBoardTouchMoved = false;
                enemyBoardLongPressTimer = setTimeout(() => {
                    if (!enemyBoardTouchMoved) {
                        // Haptic feedback for mobile
                        if (navigator.vibrate) {
                            navigator.vibrate(50);
                        }
                        showCardDetail(card);
                    }
                }, 350);
            };

            cardEl.ontouchmove = () => {
                enemyBoardTouchMoved = true;
                clearTimeout(enemyBoardLongPressTimer);
            };

            cardEl.ontouchend = () => {
                clearTimeout(enemyBoardLongPressTimer);
            };

            enemyBoardEl.appendChild(cardEl);
        });

        // Manage button states - disable during enemy turn and when processing actions
        const attackBtn = document.getElementById('attackBtn');
        const endTurnBtn = document.getElementById('endTurnBtn');
        const isPlayerTurn = gameState.turn === 'player' && gameState.phase !== 'enemy';

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
            const shouldDisableEndTurn = !isPlayerTurn || isProcessingAction || attackPhase;
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

    function createCardElement(card, onBoard, isEnemy = false) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        
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
        // Emoji - centered
        const emojiEl = document.createElement('div');
        emojiEl.textContent = card.emoji;
        emojiEl.style.fontSize = '32px';
        emojiEl.style.display = 'flex';
        emojiEl.style.alignItems = 'center';
        emojiEl.style.justifyContent = 'center';
        emojiEl.style.flex = '1';
        emojiEl.style.width = '100%';
        cardEl.appendChild(emojiEl);

        // Cost
        if (card.cost && !onBoard && Object.keys(card.cost).length > 0) {
            const costEl = document.createElement('div');
            costEl.className = 'card-cost';
            const costStr = Object.entries(card.cost)
                .map(([el, val]) => `${ELEMENTS[el].emoji}${val}`)
                .join(' ');
            costEl.textContent = costStr;
            cardEl.appendChild(costEl);
        }

        // Power/Toughness
        if (card.type === 'creature') {
            const powerEl = document.createElement('div');
            powerEl.className = 'card-power';
            powerEl.textContent = `${card.power}/${card.toughness}`;
            cardEl.appendChild(powerEl);

            // Abilities
            if (card.abilities && card.abilities.length > 0) {
                const abilitiesEl = document.createElement('div');
                abilitiesEl.className = 'card-abilities';
                card.abilities.forEach(ability => {
                    const abilityEl = document.createElement('div');
                    abilityEl.className = 'ability-icon';
                    abilityEl.textContent = ability[0].toUpperCase();
                    abilitiesEl.appendChild(abilityEl);
                });
                cardEl.appendChild(abilitiesEl);
            }
        }

        return cardEl;
    }

    // Resize canvas with debouncing for better performance
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }, 100); // Debounce resize for better performance
    });

    // DESKTOP ENHANCEMENT: Keyboard shortcuts for better desktop experience
    document.addEventListener('keydown', (e) => {
        // Only enable keyboard shortcuts during active gameplay (not in menus)
        if (document.getElementById('gameContainer').style.display !== 'flex') {
            return;
        }

        // Prevent shortcuts if a modal is open
        const pauseModal = document.getElementById('pauseModal');
        const cardDetailPopup = document.getElementById('cardDetailPopup');
        const graveyardModal = document.getElementById('graveyardModal');
        if (pauseModal.classList.contains('show') || cardDetailPopup.classList.contains('show') || graveyardModal.classList.contains('show')) {
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
                if (endTurnBtn && !endTurnBtn.disabled) {
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

            case 'escape': // ESC = Pause game
                e.preventDefault();
                pauseGame();
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
            if (gameState.turn === 'player' && isProcessingAction) {
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
