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

    // Helper function to play sound effect
    function playSFX(soundName, loop = false) {
        if (audioSystem[soundName]) {
            try {
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

    // Game State
    const gameState = {
        playerLife: 20,
        enemyLife: 20,
        playerMana: {},
        enemyMana: {},
        playerHand: [],
        playerBoard: [],
        playerDeck: [],
        enemyHand: [],
        enemyBoard: [],
        enemyDeck: [],
        selectedCard: null,
        selectedElements: [],
        phase: 'main',
        turn: 'player',
        attackers: [],
        blockers: {},
        difficulty: 'easy',
        previousPlayerLife: 20,
        previousEnemyLife: 20
    };

    // Stats tracking
    let gameStats = {
        wins: 0,
        losses: 0,
        total: 0
    };

    // Load stats from localStorage
    function loadStats() {
        const saved = localStorage.getItem('emojiElementsStats');
        if (saved) {
            gameStats = JSON.parse(saved);
        }
    }

    function saveStats() {
        localStorage.setItem('emojiElementsStats', JSON.stringify(gameStats));
    }

    loadStats();

    // Detect iOS devices
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Intro Video Logic with Click to Start
    window.addEventListener('DOMContentLoaded', () => {
        const clickToStart = document.getElementById('clickToStart');
        const introContainer = document.getElementById('introContainer');
        const introVideo = document.getElementById('introVideo');
        const startModal = document.getElementById('startModal');

        // Preload video and ensure audio is ready
        introVideo.load();

        // Prepare video for playback with audio (especially important for iOS)
        introVideo.removeAttribute('muted');
        introVideo.volume = 1.0;

        // Click to start handler
        clickToStart.addEventListener('click', () => {
            // Hide click to start overlay
            clickToStart.style.opacity = '0';
            setTimeout(() => {
                clickToStart.style.display = 'none';
                // Show and play intro video with audio
                introContainer.style.display = 'flex';
                playVideoWithAudio();
            }, 300);
        });

        // Play video with audio - CRITICAL FIX for audio playback
        const playVideoWithAudio = async () => {
            // IMPORTANT: Explicitly unmute and set volume BEFORE playing
            // This is critical for mobile browsers (iOS, Android)
            introVideo.muted = false;
            introVideo.volume = 1.0;
            introVideo.removeAttribute('muted');

            // Log device type for debugging
            console.log(`📱 Device: ${isIOS ? 'iOS' : isMobile ? 'Mobile' : 'Desktop'}`);

            try {
                // Start playback with audio
                await introVideo.play();
                console.log('✅ Video playing with audio');
                console.log(`🔊 Volume: ${introVideo.volume}, Muted: ${introVideo.muted}`);

                // Continuously enforce unmuted state for the first few seconds
                // This is critical for iOS devices
                const enforceAudio = setInterval(() => {
                    if (introVideo.paused || introVideo.ended) {
                        clearInterval(enforceAudio);
                        return;
                    }
                    introVideo.muted = false;
                    introVideo.volume = 1.0;
                }, 100);

                // Stop enforcing after 3 seconds
                setTimeout(() => clearInterval(enforceAudio), 3000);

                // Check if video has audio tracks
                setTimeout(() => {
                    if (introVideo.audioTracks) {
                        console.log(`🎵 Audio tracks: ${introVideo.audioTracks.length}`);
                    }
                    // Log current playback state
                    console.log(`▶️ Playing: ${!introVideo.paused}, Volume: ${introVideo.volume}, Muted: ${introVideo.muted}`);
                }, 500);

            } catch (e) {
                console.error('❌ Video play failed:', e);
                // If play fails completely, skip to menu
                skipIntro();
            }
        };

        // When video ends, seamlessly transition to start menu
        introVideo.addEventListener('ended', skipIntro);

        // Allow clicking/tapping to skip video
        introContainer.addEventListener('click', skipIntro);

        function skipIntro() {
            // Smooth fade out of video
            introContainer.classList.add('hidden');
            setTimeout(() => {
                introContainer.style.display = 'none';
                startModal.style.display = 'flex';
                // Seamlessly start menu music after video ends
                // Using setTimeout to ensure smooth transition
                setTimeout(() => {
                    playSFX('startMenuMusic', true);
                }, 100);
            }, 500);
        }
    });

    // Mulligan state
    let mulliganUsed = false;

    // Mana System
    const ELEMENTS = {
        fire: { emoji: '🔥', color: '#ff4444' },
        water: { emoji: '💧', color: '#4444ff' },
        earth: { emoji: '🌍', color: '#44ff44' },
        swamp: { emoji: '💀', color: '#8844ff' },
        light: { emoji: '☀️', color: '#ffff44' }
    };

    // Card Database - MASSIVELY EXPANDED with Themes and Card Types!
    const CARD_DATABASE = {
        // LANDS (Mana generators)
        lands: {
            fire: { emoji: '🔥', type: 'land', cardType: 'Land', element: 'fire', name: 'Volcanic Peak', theme: 'Nature' },
            water: { emoji: '💧', type: 'land', cardType: 'Land', element: 'water', name: 'Mystic Springs', theme: 'Nature' },
            earth: { emoji: '🌍', type: 'land', cardType: 'Land', element: 'earth', name: 'Ancient Grove', theme: 'Nature' },
            swamp: { emoji: '💀', type: 'land', cardType: 'Land', element: 'swamp', name: 'Cursed Bog', theme: 'Fantasy' },
            light: { emoji: '☀️', type: 'land', cardType: 'Land', element: 'light', name: 'Sacred Temple', theme: 'Fantasy' }
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
        },
        
        // SPELLS - GREATLY EXPANDED
        spells: {
            // Fire Spells
            fireball: { emoji: '💥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 3 }, effect: 'damage', value: 3, name: 'Fireball', desc: 'Deal 3 damage to target', theme: 'Fantasy' },
            explosion: { emoji: '🎆', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 4 }, effect: 'damage', value: 4, name: 'Explosion', desc: 'Deal 4 damage to target', theme: 'Fantasy' },
            inferno: { emoji: '🔥', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 5 }, effect: 'damage', value: 5, name: 'Inferno', desc: 'Deal 5 damage to target', theme: 'Fantasy' },
            meteor: { emoji: '☄️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 6 }, effect: 'damage', value: 6, name: 'Meteor Strike', desc: 'Devastating impact', theme: 'Nature' },
            flame: { emoji: '🕯️', type: 'instant', cardType: 'Instant/Spell', cost: { fire: 1 }, effect: 'damage', value: 1, name: 'Flame Jet', desc: 'Quick burn', theme: 'Fantasy' },

            // Water Spells
            freeze: { emoji: '❄️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'tap', name: 'Freeze', desc: 'Tap target creature', theme: 'Nature' },
            tsunami: { emoji: '🌊', type: 'instant', cardType: 'Instant/Spell', cost: { water: 5 }, effect: 'bounce', name: 'Tsunami', desc: 'Return creatures to hand', theme: 'Nature' },
            bubble: { emoji: '🫧', type: 'instant', cardType: 'Instant/Spell', cost: { water: 3 }, effect: 'buff_defense', value: 3, name: 'Bubble Shield', desc: '+0/+3 to creature', theme: 'Fantasy' },
            rain: { emoji: '🌧️', type: 'instant', cardType: 'Instant/Spell', cost: { water: 2 }, effect: 'heal', value: 2, name: 'Healing Rain', desc: 'Restore 2 life', theme: 'Nature' },
            whirlpool: { emoji: '🌀', type: 'instant', cardType: 'Instant/Spell', cost: { water: 4 }, effect: 'destroy', name: 'Whirlpool', desc: 'Destroy target creature', theme: 'Nature' },

            // Earth Spells
            earthquake: { emoji: '🌋', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 4 }, effect: 'damage', value: 2, target: 'all', name: 'Earthquake', desc: 'Deal 2 to all creatures', theme: 'Nature' },
            growth: { emoji: '🌱', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'buff', value: 2, name: 'Growth', desc: '+2/+2 to creature', theme: 'Nature' },
            roots: { emoji: '🌿', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 1 }, effect: 'buff_defense', value: 2, name: 'Tangling Roots', desc: '+0/+2 to creature', theme: 'Nature' },
            avalanche: { emoji: '🏔️', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 5 }, effect: 'damage', value: 3, target: 'all', name: 'Avalanche', desc: 'Deal 3 to all creatures', theme: 'Nature' },
            harvest: { emoji: '🌾', type: 'instant', cardType: 'Instant/Spell', cost: { earth: 2 }, effect: 'draw', value: 2, name: 'Harvest', desc: 'Draw 2 cards', theme: 'Nature' },

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
            resurrection: { emoji: '⛪', type: 'instant', cardType: 'Instant/Spell', cost: { light: 5 }, effect: 'revive', name: 'Resurrection', desc: 'Return creature from graveyard', theme: 'Fantasy' }
        },

        // ARTIFACTS - EXPANDED
        artifacts: {
            sword: { emoji: '⚔️', type: 'artifact', cardType: 'Artifact', cost: { fire: 2 }, effect: 'buff', value: 2, name: 'Flaming Sword', desc: 'Equipped creature gets +2/+0', theme: 'Fantasy' },
            shield: { emoji: '🛡️', type: 'artifact', cardType: 'Artifact', cost: { earth: 2 }, effect: 'buff_defense', value: 2, name: 'Earth Shield', desc: 'Equipped creature gets +0/+2', theme: 'Fantasy' },
            crown: { emoji: '👑', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'draw', value: 1, name: 'Crown of Power', desc: 'Draw extra card each turn', theme: 'Fantasy' },
            gem: { emoji: '💎', type: 'artifact', cardType: 'Artifact', cost: { water: 2 }, effect: 'mana', value: 1, name: 'Mana Gem', desc: 'Generate extra mana', theme: 'Fantasy' },
            bomb: { emoji: '💣', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'aoe', value: 2, name: 'Bomb', desc: 'Deal 2 to all enemies', theme: 'City' },
            chalice: { emoji: '🏆', type: 'artifact', cardType: 'Artifact', cost: { light: 3 }, effect: 'heal', value: 1, name: 'Holy Chalice', desc: 'Gain 1 life each turn', theme: 'Fantasy' },
            scroll: { emoji: '📜', type: 'artifact', cardType: 'Artifact', cost: { swamp: 2 }, effect: 'draw', value: 1, name: 'Dark Scroll', desc: 'Draw extra card', theme: 'Fantasy' },
            orb: { emoji: '🔮', type: 'artifact', cardType: 'Artifact', cost: { swamp: 3 }, effect: 'damage', value: 1, name: 'Cursed Orb', desc: 'Deal 1 to enemy each turn', theme: 'Fantasy' },
            horn: { emoji: '📯', type: 'artifact', cardType: 'Artifact', cost: { earth: 2 }, effect: 'buff', value: 1, name: 'War Horn', desc: 'All creatures get +1/+0', theme: 'City' },
            amulet: { emoji: '🪬', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'buff_defense', value: 1, name: 'Protective Amulet', desc: 'All creatures get +0/+1', theme: 'Fantasy' },
            ring: { emoji: '💍', type: 'artifact', cardType: 'Artifact', cost: { fire: 1, water: 1 }, effect: 'mana', value: 1, name: 'Magic Ring', desc: 'Boost mana production', theme: 'Fantasy' },
            armor: { emoji: '🦺', type: 'artifact', cardType: 'Artifact', cost: { earth: 3 }, effect: 'buff_defense', value: 3, name: 'Heavy Armor', desc: '+0/+3 to equipped', theme: 'City' },
            axe: { emoji: '🪓', type: 'artifact', cardType: 'Artifact', cost: { fire: 3 }, effect: 'buff', value: 3, name: 'Battle Axe', desc: '+3/+0 to equipped', theme: 'Fantasy' },
            bow: { emoji: '🏹', type: 'artifact', cardType: 'Artifact', cost: { earth: 2, light: 1 }, effect: 'buff', value: 2, name: 'Elven Bow', desc: '+2/+0 and flying', theme: 'Fantasy' },
            wand: { emoji: '🪄', type: 'artifact', cardType: 'Artifact', cost: { light: 2 }, effect: 'damage', value: 2, name: 'Magic Wand', desc: 'Deal 2 damage when activated', theme: 'Fantasy' }
        }
    };

    // Particle System
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let particles = [];

    class Particle {
        constructor(x, y, color, type = 'default') {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 4;
            this.vy = (Math.random() - 0.5) * 4;
            this.life = 1;
            this.decay = 0.02;
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
        for (let i = 0; i < count; i++) {
            particles.push(new Particle(x, y, color));
        }
    }

    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        particles = particles.filter(p => p.life > 0);
        
        particles.forEach(p => {
            p.update();
            p.draw();
        });

        requestAnimationFrame(animateParticles);
    }

    animateParticles();

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
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('elementSelectionScreen').style.display = 'block';
    }

    function showHowToPlay() {
        playSFX('menuOpen');
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('howToPlayScreen').style.display = 'block';
    }

    function showStats() {
        playSFX('menuOpen');
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('statsScreen').style.display = 'block';
        updateStatsDisplay();
    }

    function backToMenu() {
        playSFX('menuClose');
        document.getElementById('mainMenu').style.display = 'block';
        document.getElementById('elementSelectionScreen').style.display = 'none';
        document.getElementById('howToPlayScreen').style.display = 'none';
        document.getElementById('statsScreen').style.display = 'none';
    }

    // Pause/Resume Functions
    function pauseGame() {
        playSFX('menuOpen');
        document.getElementById('pauseModal').classList.add('show');
    }

    function resumeGame() {
        playSFX('menuClose');
        document.getElementById('pauseModal').classList.remove('show');
    }

    function confirmQuit() {
        if (confirm('Are you sure you want to quit to main menu? Current game will be lost.')) {
            location.reload();
        }
    }

    function updateStatsDisplay() {
        document.getElementById('gamesWon').textContent = gameStats.wins;
        document.getElementById('gamesLost').textContent = gameStats.losses;
        document.getElementById('totalGames').textContent = gameStats.total;
        const winRate = gameStats.total > 0 ? Math.round((gameStats.wins / gameStats.total) * 100) : 0;
        document.getElementById('winRate').textContent = winRate + '%';
    }

    function resetStats() {
        if (confirm('Are you sure you want to reset all statistics?')) {
            playSFX('select');
            gameStats = { wins: 0, losses: 0, total: 0 };
            saveStats();
            updateStatsDisplay();
        }
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
            html = `
                <div class="card-detail-section">
                    <div class="card-detail-info">
                        <span class="card-detail-label">Type:</span> Land
                    </div>
                    <div class="card-detail-info">
                        <span class="card-detail-label">Effect:</span> Tap to add ${ELEMENTS[card.element].emoji} to your mana pool
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
            const costStr = Object.entries(card.cost)
                .map(([el, val]) => `${ELEMENTS[el].emoji} ${val}`)
                .join(', ');

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
    }

    function hideCardDetail() {
        document.getElementById('cardDetailPopup').classList.remove('show');
    }

    // Close popup when clicking outside
    document.getElementById('cardDetailPopup').addEventListener('click', function(e) {
        if (e.target === this) {
            hideCardDetail();
        }
    });

    // Element Selection
    function selectElement(element) {
        playSFX('select');
        const btn = document.querySelector(`[data-element="${element}"]`);

        if (gameState.selectedElements.includes(element)) {
            gameState.selectedElements = gameState.selectedElements.filter(e => e !== element);
            btn.classList.remove('selected');
        } else if (gameState.selectedElements.length < 2) {
            gameState.selectedElements.push(element);
            btn.classList.add('selected');
        }

        document.getElementById('startBtn').disabled = gameState.selectedElements.length !== 2;
    }

    // Deck Generation with improved shuffling
    function generateDeck(elements) {
        const deck = [];
        
        // Add 25 lands (12-13 of each type)
        elements.forEach((element, index) => {
            const count = index === 0 ? 13 : 12;
            for (let i = 0; i < count; i++) {
                deck.push({...CARD_DATABASE.lands[element], id: Math.random()});
            }
        });

        // Add 35 spells/creatures/artifacts
        const availableCards = [];
        
        // Get creatures - ONLY if ALL cost elements are in player's selected elements
        Object.values(CARD_DATABASE.creatures).forEach(creature => {
            const costElements = Object.keys(creature.cost);
            // Check if ALL cost elements are available in player's elements
            if (costElements.every(e => elements.includes(e))) {
                availableCards.push(creature);
            }
        });

        // Get spells - ONLY if ALL cost elements are in player's selected elements
        Object.values(CARD_DATABASE.spells).forEach(spell => {
            const costElements = Object.keys(spell.cost);
            if (costElements.every(e => elements.includes(e))) {
                availableCards.push(spell);
            }
        });

        // Get artifacts - ONLY if ALL cost elements are in player's selected elements
        Object.values(CARD_DATABASE.artifacts).forEach(artifact => {
            const costElements = Object.keys(artifact.cost);
            if (costElements.every(e => elements.includes(e))) {
                availableCards.push(artifact);
            }
        });

        // Add 35 random cards from available pool
        for (let i = 0; i < 35; i++) {
            if (availableCards.length > 0) {
                const card = availableCards[Math.floor(Math.random() * availableCards.length)];
                deck.push({...card, id: Math.random()});
            }
        }

        // Improved shuffle algorithm (Fisher-Yates)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck;
    }

    // Start Game
    // Mulligan function
    function mulligan() {
        if (mulliganUsed) {
            alert('You can only mulligan once per game!');
            return;
        }
        
        if (!confirm('Mulligan? Put all cards back and draw 6 new cards?')) {
            return;
        }
        
        // Return hand to deck
        gameState.playerDeck = gameState.playerDeck.concat(gameState.playerHand);
        gameState.playerHand = [];
        
        // Shuffle
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
    }

    // Update deck counters
    function updateDeckCounters() {
        document.getElementById('playerDeckCount').textContent = gameState.playerDeck.length;
        document.getElementById('enemyDeckCount').textContent = gameState.enemyDeck.length;
    }

    function startGame() {
        playSFX('select');
        gameState.playerDeck = generateDeck(gameState.selectedElements);

        // AI picks random elements
        const aiElements = [];
        const elementKeys = Object.keys(ELEMENTS);
        while (aiElements.length < 2) {
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

        document.getElementById('startModal').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'flex';

        // Stop menu music and start gameplay music
        stopSFX('startMenuMusic');
        playSFX('gameplayMusic', true);

        // Reset mulligan button
        mulliganUsed = false;
        document.getElementById('mulliganBtn').disabled = false;
        document.getElementById('mulliganBtn').style.opacity = '1';

        updateUI();
        updateDeckCounters();
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
        const card = gameState.playerHand.find(c => c.id === cardId);
        if (!card) return;

        // Check if can pay cost
        if (!canPayCost(card.cost, gameState.playerMana)) {
            showCardDetail(card);
            setTimeout(() => alert('Not enough mana!'), 100);
            return;
        }

        // Pay cost
        payCost(card.cost, gameState.playerMana);

        // Remove from hand
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== cardId);

        // Play the card
        if (card.type === 'land') {
            // Lands go to board and generate mana
            gameState.playerBoard.push({...card, tapped: false});
            showGameLog(`🌍 You play ${card.name}`, false);
        } else if (card.type === 'creature') {
            gameState.playerBoard.push({...card, tapped: true, damage: 0}); // summoning sickness
            // Play appropriate creature summon sound based on theme
            if (card.theme === 'Science Fiction') {
                playSFX('summonCreatureScifi');
            } else {
                playSFX('summonCreatureFantasy');
            }
            showGameLog(`${card.emoji} You summon ${card.name}`, false, card.theme === 'Science Fiction');
        } else if (card.type === 'artifact') {
            gameState.playerBoard.push({...card, tapped: false});
            playSFX('summonInstant');
            showGameLog(`${card.emoji} You play ${card.name}`, false, card.theme === 'Science Fiction');
        } else if (card.type === 'instant') {
            playSFX('summonInstant');
            showGameLog(`${card.emoji} You cast ${card.name}`, false, card.theme === 'Science Fiction');
            resolveSpell(card, 'player');
        }

        // Particles
        const handEl = document.getElementById('playerHand');
        const rect = handEl.getBoundingClientRect();
        createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ffd700', 30);

        updateUI();
    }

    // Check if can pay cost
    function canPayCost(cost, mana) {
        for (let element in cost) {
            if (!mana[element] || mana[element] < cost[element]) {
                return false;
            }
        }
        return true;
    }

    // Pay cost
    function payCost(cost, mana) {
        for (let element in cost) {
            mana[element] -= cost[element];
        }
    }

    // Tap lands for mana
    function tapLand(cardId) {
        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card || card.type !== 'land') return;

        // If tapped, UNTAP it and refund mana
        if (card.tapped) {
            card.tapped = false;
            if (gameState.playerMana[card.element] > 0) {
                gameState.playerMana[card.element]--;
                playSFX('untap');
                showGameLog(`🔄 You untap ${card.name} (mana refunded)`, false);
                updateUI();
            }
            return;
        }

        // Otherwise tap it for mana
        card.tapped = true;
        gameState.playerMana[card.element] = (gameState.playerMana[card.element] || 0) + 1;

        playSFX('tapLand');
        showGameLog(`⚡ You tap ${card.name} for mana`, false);

        updateUI();
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
                
            case 'draw':
                for (let i = 0; i < card.value; i++) {
                    drawCard(caster);
                }
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
                break;

            case 'destroy':
                // Destroy target creature (simplified - destroys a random creature)
                const targetBoard = isCasterPlayer ? gameState.enemyBoard : gameState.playerBoard;
                const creatures = targetBoard.filter(c => c.type === 'creature');
                if (creatures.length > 0) {
                    const target = creatures[Math.floor(Math.random() * creatures.length)];
                    if (isCasterPlayer) {
                        gameState.enemyBoard = gameState.enemyBoard.filter(c => c.id !== target.id);
                    } else {
                        gameState.playerBoard = gameState.playerBoard.filter(c => c.id !== target.id);
                    }
                    playSFX('cardDestroyed');
                    showGameLog(`${target.emoji} ${target.name} is destroyed!`, !isCasterPlayer);
                }
                break;
        }
    }

    // Attack Phase
    let attackPhase = false;

    function enterAttackPhase() {
        attackPhase = true;
        gameState.attackers = [];
        gameState.phase = 'attack';
        document.getElementById('phaseIndicator').textContent = 'DECLARE ATTACKERS';
        document.getElementById('attackBtn').textContent = '✓ CONFIRM';
        document.getElementById('attackBtn').onclick = confirmAttackers;
        updateUI();
    }

    function selectAttacker(cardId) {
        if (!attackPhase) return;
        
        const card = gameState.playerBoard.find(c => c.id === cardId);
        if (!card || card.type !== 'creature' || card.tapped) return;

        if (gameState.attackers.includes(cardId)) {
            gameState.attackers = gameState.attackers.filter(id => id !== cardId);
        } else {
            gameState.attackers.push(cardId);
        }

        updateUI();
    }

    function confirmAttackers() {
        if (gameState.attackers.length === 0) {
            attackPhase = false;
            gameState.phase = 'main';
            document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
            document.getElementById('attackBtn').textContent = '⚔️ ATTACK';
            document.getElementById('attackBtn').onclick = enterAttackPhase;
            showGameLog('🛡️ You choose not to attack', false);
            return;
        }

        playSFX('attack');
        showGameLog(`⚔️ You attack with ${gameState.attackers.length} creature${gameState.attackers.length > 1 ? 's' : ''}!`, false);

        // AI declares blockers
        aiDeclareBlockers();

        // Resolve combat
        resolveCombat();

        attackPhase = false;
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        document.getElementById('attackBtn').textContent = '⚔️ ATTACK';
        document.getElementById('attackBtn').onclick = enterAttackPhase;

        checkGameOver();
        updateUI();
    }

    function aiDeclareBlockers() {
        gameState.blockers = {};

        const availableBlockers = gameState.enemyBoard.filter(c =>
            c.type === 'creature' && !c.tapped
        );

        let blockersAssigned = false;
        gameState.attackers.forEach(attackerId => {
            const attacker = gameState.playerBoard.find(c => c.id === attackerId);

            // AI logic: block with similarly powered creature if available
            const blocker = availableBlockers.find(b =>
                b.power >= attacker.power - 1 && !Object.values(gameState.blockers).includes(b.id)
            );

            if (blocker) {
                gameState.blockers[attackerId] = blocker.id;
                blockersAssigned = true;
            }
        });

        // Play block sound if any blockers were assigned
        if (blockersAssigned) {
            playSFX('block');
        }
    }

    function resolveCombat() {
        gameState.attackers.forEach(attackerId => {
            const attacker = gameState.playerBoard.find(c => c.id === attackerId);
            if (!attacker) return;

            attacker.tapped = true;

            const blockerId = gameState.blockers[attackerId];
            
            if (blockerId) {
                // Combat between creatures
                const blocker = gameState.enemyBoard.find(c => c.id === blockerId);
                if (blocker) {
                    // Apply damage
                    attacker.damage = (attacker.damage || 0) + blocker.power;
                    blocker.damage = (blocker.damage || 0) + attacker.power;

                    // Trample effect
                    if (attacker.abilities?.includes('trample')) {
                        const excessDamage = attacker.power - blocker.toughness;
                        if (excessDamage > 0) {
                            changeEnemyLife(-excessDamage);
                            shakeScreen();
                            const enemyArea = document.querySelector('.enemy-area');
                            const rect = enemyArea.getBoundingClientRect();
                            createTrampleEffect(rect.left + rect.width / 2, rect.top + rect.height / 2);
                            createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ff8c00', 30);
                        }
                    }

                    // Lifelink effect
                    if (attacker.abilities?.includes('lifelink')) {
                        changePlayerLife(attacker.power);
                        const playerInfo = document.querySelector('.player-area:not(.enemy-area) .player-info');
                        const rect = playerInfo.getBoundingClientRect();
                        createSparkles(rect.left + 50, rect.top + rect.height / 2);
                    }

                    // Check deaths
                    if (attacker.damage >= attacker.toughness) {
                        gameState.playerBoard = gameState.playerBoard.filter(c => c.id !== attackerId);
                        playSFX('cardDestroyed');
                    }
                    if (blocker.damage >= blocker.toughness) {
                        gameState.enemyBoard = gameState.enemyBoard.filter(c => c.id !== blockerId);
                        playSFX('cardDestroyed');
                    }
                }
            } else {
                // Direct damage to enemy
                changeEnemyLife(-attacker.power);

                // Lifelink effect
                if (attacker.abilities?.includes('lifelink')) {
                    changePlayerLife(attacker.power);
                    const playerInfo = document.querySelector('.player-area:not(.enemy-area) .player-info');
                    const rect = playerInfo.getBoundingClientRect();
                    createSparkles(rect.left + 50, rect.top + rect.height / 2);
                }

                // Particles
                const enemyArea = document.querySelector('.enemy-area');
                const rect = enemyArea.getBoundingClientRect();
                createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#dc143c', 40);
            }
        });

        gameState.attackers = [];
        gameState.blockers = {};
    }

    // End Turn
    function endTurn() {
        // Show end turn message
        showGameLog('✅ You end your turn', false);
        
        // Untap all player permanents
        gameState.playerBoard.forEach(card => card.tapped = false);

        // Reset mana
        gameState.playerMana = {};

        gameState.turn = 'enemy';
        gameState.phase = 'enemy';
        document.getElementById('phaseIndicator').textContent = 'ENEMY TURN';
        
        updateUI();

        // AI turn
        setTimeout(() => {
            aiTurn();
        }, 1500);
    }

    // Start player turn
    function startPlayerTurn() {
        gameState.turn = 'player';
        gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        
        // Draw card at start of turn
        drawCard('player');
        showGameLog('📜 You draw a card', false);
        
        // Untap and reset mana
        gameState.playerBoard.forEach(card => card.tapped = false);
        gameState.playerMana = {};
        
        updateUI();
    }

    // AI Turn
    function aiTurn() {
        // Untap enemy permanents
        gameState.enemyBoard.forEach(card => card.tapped = false);
        gameState.enemyMana = {};

        // Draw card
        drawCard('enemy');
        showGameLog('🎴 Enemy draws a card', true);
        
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
                        gameState.enemyMana[card.element] = (gameState.enemyMana[card.element] || 0) + 1;
                        manaTapped = true;
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
                            gameState.enemyBoard.push({...creature, tapped: true, damage: 0});
                            showGameLog(`${creature.emoji} Enemy summons ${creature.name}`, true, creature.theme === 'scifi');
                            creaturePlayed = true;
                        }
                    });

                    if (creaturePlayed) {
                        updateUI();
                    }

                    setTimeout(() => {
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
                                    spellPlayed = true;
                                }
                            });

                            if (spellPlayed) {
                                updateUI();
                            }
                        }

                        setTimeout(() => {
                            // Attack with creatures
                            const attackers = gameState.enemyBoard.filter(c => 
                                c.type === 'creature' && !c.tapped
                            );

                            let attackingCreatures = [];
                            if (gameState.difficulty === 'easy') {
                                attackingCreatures = attackers.filter(() => Math.random() > 0.5);
                            } else if (gameState.difficulty === 'medium') {
                                attackingCreatures = attackers.filter(c => !c.abilities?.includes('defender'));
                            } else {
                                const sorted = attackers
                                    .filter(c => !c.abilities?.includes('defender'))
                                    .sort((a, b) => (b.power + b.toughness) - (a.power + a.toughness));
                                
                                if (sorted.length > 1) {
                                    attackingCreatures = sorted.slice(1);
                                } else {
                                    attackingCreatures = sorted;
                                }
                            }

                            if (attackingCreatures.length > 0) {
                                showGameLog(`⚔️ Enemy attacks with ${attackingCreatures.length} creature${attackingCreatures.length > 1 ? 's' : ''}!`, true);
                            } else {
                                showGameLog('🛡️ Enemy does not attack', true);
                            }

                            attackingCreatures.forEach(attacker => {
                                attacker.tapped = true;
                                changePlayerLife(-attacker.power);

                                if (attacker.abilities?.includes('trample')) {
                                    shakeScreen();
                                    const playerArea = document.querySelector('.player-area:not(.enemy-area)');
                                    const rect = playerArea.getBoundingClientRect();
                                    createTrampleEffect(rect.left + rect.width / 2, rect.top + rect.height / 2);
                                }

                                if (attacker.abilities?.includes('lifelink')) {
                                    changeEnemyLife(attacker.power);
                                    const enemyInfo = document.querySelector('.enemy-area .player-info');
                                    const rect = enemyInfo.getBoundingClientRect();
                                    createSparkles(rect.left + 50, rect.top + rect.height / 2, 10);
                                }

                                const playerArea = document.querySelector('.player-area:not(.enemy-area)');
                                const rect = playerArea.getBoundingClientRect();
                                createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#dc143c', 30);
                            });

                            updateUI();
                            checkGameOver();

                            setTimeout(() => {
                                startPlayerTurn();
                            }, 1500);
                        }, 1500);
                    }, 1500);
                }, 1500);
            }, 1500);
        }, 1000);
    }

    // Helper functions for lifepoint changes with sound and animation
    function changePlayerLife(amount) {
        const oldLife = gameState.playerLife;
        gameState.playerLife = Math.max(0, Math.min(20, gameState.playerLife + amount));
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
        gameState.enemyLife = Math.max(0, Math.min(20, gameState.enemyLife + amount));
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

            setTimeout(() => {
                location.reload();
            }, 4000);
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

            setTimeout(() => {
                location.reload();
            }, 4000);
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
            
            // Click to play
            cardEl.onclick = () => playCard(card.id);
            
            // Right-click or long-press to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
            };
            
            let longPressTimer;
            cardEl.ontouchstart = (e) => {
                longPressTimer = setTimeout(() => {
                    showCardDetail(card);
                }, 500);
            };
            cardEl.ontouchend = () => {
                clearTimeout(longPressTimer);
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
                if (!landStacks[card.element]) {
                    landStacks[card.element] = [];
                }
                landStacks[card.element].push(card);
            } else {
                nonLands.push(card);
            }
        });

        // Display land stacks
        Object.keys(landStacks).forEach(element => {
            const stack = landStacks[element];
            const stackContainer = document.createElement('div');
            stackContainer.className = 'card-stack';
            stackContainer.style.position = 'relative';
            stackContainer.style.minWidth = '60px';
            stackContainer.style.height = '80px';
            stackContainer.style.marginRight = '10px';
            
            // Display cards in stack with slight offset
            stack.forEach((card, index) => {
                const cardEl = createCardElement(card, true);
                cardEl.style.position = 'absolute';
                cardEl.style.left = (index * 3) + 'px';
                cardEl.style.top = (index * 3) + 'px';
                cardEl.style.zIndex = index;
                
                cardEl.onclick = () => tapLand(card.id);
                
                // Right-click to view details
                cardEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    showCardDetail(card);
                };
                
                stackContainer.appendChild(cardEl);
            });
            
            // Add count badge
            if (stack.length > 1) {
                const badge = document.createElement('div');
                badge.className = 'stack-count';
                badge.textContent = stack.length;
                badge.style.position = 'absolute';
                badge.style.bottom = '-5px';
                badge.style.right = '-5px';
                badge.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)';
                badge.style.color = '#2a1a0a';
                badge.style.borderRadius = '50%';
                badge.style.width = '24px';
                badge.style.height = '24px';
                badge.style.display = 'flex';
                badge.style.alignItems = 'center';
                badge.style.justifyContent = 'center';
                badge.style.fontSize = '12px';
                badge.style.fontWeight = 'bold';
                badge.style.border = '2px solid #8b7355';
                badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.5)';
                badge.style.zIndex = stack.length + 1;
                stackContainer.appendChild(badge);
            }
            
            boardEl.appendChild(stackContainer);
        });

        // Display non-land cards normally
        nonLands.forEach(card => {
            const cardEl = createCardElement(card, true);
            
            if (card.type === 'creature' && attackPhase) {
                cardEl.onclick = () => selectAttacker(card.id);
                if (gameState.attackers.includes(card.id)) {
                    cardEl.classList.add('attacking');
                }
            }
            
            // Right-click to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
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
                if (!enemyLandStacks[card.element]) {
                    enemyLandStacks[card.element] = [];
                }
                enemyLandStacks[card.element].push(card);
            } else {
                enemyNonLands.push(card);
            }
        });

        // Display enemy land stacks
        Object.keys(enemyLandStacks).forEach(element => {
            const stack = enemyLandStacks[element];
            const stackContainer = document.createElement('div');
            stackContainer.className = 'card-stack';
            stackContainer.style.position = 'relative';
            stackContainer.style.minWidth = '60px';
            stackContainer.style.height = '80px';
            stackContainer.style.marginRight = '10px';
            
            // Display cards in stack with slight offset
            stack.forEach((card, index) => {
                const cardEl = createCardElement(card, true, true);
                cardEl.style.position = 'absolute';
                cardEl.style.left = (index * 3) + 'px';
                cardEl.style.top = (index * 3) + 'px';
                cardEl.style.zIndex = index;
                
                // Right-click to view details
                cardEl.oncontextmenu = (e) => {
                    e.preventDefault();
                    showCardDetail(card);
                };
                
                stackContainer.appendChild(cardEl);
            });
            
            // Add count badge
            if (stack.length > 1) {
                const badge = document.createElement('div');
                badge.className = 'stack-count';
                badge.textContent = stack.length;
                badge.style.position = 'absolute';
                badge.style.bottom = '-5px';
                badge.style.right = '-5px';
                badge.style.background = 'linear-gradient(135deg, #dc143c 0%, #ff6b6b 100%)';
                badge.style.color = '#fff';
                badge.style.borderRadius = '50%';
                badge.style.width = '24px';
                badge.style.height = '24px';
                badge.style.display = 'flex';
                badge.style.alignItems = 'center';
                badge.style.justifyContent = 'center';
                badge.style.fontSize = '12px';
                badge.style.fontWeight = 'bold';
                badge.style.border = '2px solid #8b0000';
                badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.5)';
                badge.style.zIndex = stack.length + 1;
                stackContainer.appendChild(badge);
            }
            
            enemyBoardEl.appendChild(stackContainer);
        });

        // Display enemy non-land cards normally
        enemyNonLands.forEach(card => {
            const cardEl = createCardElement(card, true, true);
            
            // Right-click to view details
            cardEl.oncontextmenu = (e) => {
                e.preventDefault();
                showCardDetail(card);
            };
            
            enemyBoardEl.appendChild(cardEl);
        });
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
        if (card.theme === 'scifi') {
            cardEl.classList.add('scifi');
        }
        if (card.tapped) {
            cardEl.classList.add('tapped');
        }
        if (isEnemy) {
            cardEl.classList.add('enemy-card');
        }

        // Emoji
        const emojiEl = document.createElement('div');
        emojiEl.textContent = card.emoji;
        emojiEl.style.fontSize = '32px';
        cardEl.appendChild(emojiEl);

        // Cost
        if (card.cost && !onBoard) {
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

    // Resize canvas
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
