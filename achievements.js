// Achievements for EMOJI ELEMENTS (window.Achievements). Loaded after feedback.js, before index.js.
//
// index.js reports confirmed outcomes as events (emit): a card resolved, a combat finished, a match ended, a
// pack was opened. This file keeps the 150-entry catalog (ACHIEVEMENTS.md lists every trigger), lifetime
// counters, the current match's context, and the unlocked set, stored under its own versioned key. Nothing here
// reads hidden information: only the player's own plays, the public board, life totals and the saved profile.
//
// Each achievement unlocks once. Unlocks survive reloads and repeated renders because the stored set is checked
// first. With ?qa=1 (QA mode) nothing is saved, so QA tools and resets can't award a real profile anything.
(function () {
    'use strict';

    const STORE_KEY = 'emoji_elements_achievements_v1';
    const BACKUP_KEY = 'emoji_elements_achievements_backup';
    const VERSION = 1;

    // ---- Small helpers used by the catalog's triggers
    const has = (card, ability) => !!card?.abilities?.includes(ability);
    const named = id => card => card?.__id === id || card?.id === id;
    const creaturesOf = board => (board || []).filter(c => c.type === 'creature');
    const pool = mana => Object.values(mana || {}).reduce((sum, n) => sum + (n || 0), 0);
    const onBoard = (board, ...ids) => ids.every(id => (board || []).some(named(id)));
    const isToken = card => card?.cardType === 'Creature Token';
    const UPKEEP_EFFECTS = ['draw', 'heal', 'damage'];

    // ---- The catalog. on: the events that can unlock it. test(e, x): true when e (the event) earns it, with x =
    // { m: this match, c: lifetime counters, game, meta, el(card), rarity(card) }. goal + progress(x): a counted
    // achievement (shown as a bar). backfill: also provable from the saved profile alone.
    const DECKS = [
        ['FIRE', 'Pyromaniac', '🔥', 'Win a match with the Fire deck.'],
        ['WATER', 'Making Waves', '💧', 'Win a match with the Water deck.'],
        ['EARTH', 'Down to Earth', '🌍', 'Win a match with the Earth deck.'],
        ['SWAMP', 'Swamp Thing', '💀', 'Win a match with the Swamp deck.'],
        ['LIGHT', 'Enlightened', '☀️', 'Win a match with the Light deck.'],
        ['FIRE_WATER', 'Steam Engine', '♨️', 'Win a match with the Fire + Water deck.'],
        ['FIRE_EARTH', 'Magma Flow', '🌋', 'Win a match with the Fire + Earth deck.'],
        ['FIRE_SWAMP', 'Hellfire', '😈', 'Win a match with the Fire + Swamp deck.'],
        ['FIRE_LIGHT', 'Solar Flare', '🌞', 'Win a match with the Fire + Light deck.'],
        ['WATER_EARTH', 'Mudslide', '🟫', 'Win a match with the Water + Earth deck.'],
        ['WATER_SWAMP', 'Bog Standard', '🐸', 'Win a match with the Water + Swamp deck.'],
        ['WATER_LIGHT', 'Rainbow Maker', '🌦️', 'Win a match with the Water + Light deck.'],
        ['EARTH_SWAMP', 'Compost Heap', '🍂', 'Win a match with the Earth + Swamp deck.'],
        ['EARTH_LIGHT', 'Photosynthesis', '🌻', 'Win a match with the Earth + Light deck.'],
        ['SWAMP_LIGHT', 'Twilight', '🌗', 'Win a match with the Swamp + Light deck.']
    ];
    const ELEMENT_PLAYS = [
        ['fire', 'Kindling Collector', '🪵', 'Fire'],
        ['water', 'Hydrated', '🚰', 'Water'],
        ['earth', 'Rooted', '🌳', 'Earth'],
        ['swamp', 'Swamp Gas', '🫧', 'Swamp'],
        ['light', 'Sunbather', '😎', 'Light']
    ];

    const won = e => e.result === 'win';
    const CATALOG = [
        // ---- First steps
        { id: 'first-match', cat: 'first', name: 'Shuffle Up', icon: '🃏', tier: 'common', desc: 'Finish your first match, win or lose.', on: ['match:end'], test: () => true, backfill: x => x.wins + x.losses >= 1 },
        { id: 'first-win', cat: 'first', name: "Beginner's Luck", icon: '🍀', tier: 'common', desc: 'Win a match.', on: ['match:end'], test: won, backfill: x => x.wins >= 1 },
        { id: 'first-land', cat: 'first', name: 'Plot of Land', icon: '🌱', tier: 'common', desc: 'Play a land.', on: ['card:played'], test: e => e.card.type === 'land' },
        { id: 'first-creature', cat: 'first', name: "It's Alive!", icon: '🐣', tier: 'common', desc: 'Summon a creature.', on: ['card:played'], test: e => e.card.type === 'creature' },
        { id: 'first-instant', cat: 'first', name: 'Abracadabra', icon: '✨', tier: 'common', desc: 'Cast an instant.', on: ['card:played'], test: e => e.card.type === 'instant' },
        { id: 'first-artifact', cat: 'first', name: 'Shiny Object', icon: '💎', tier: 'common', desc: 'Play an artifact.', on: ['card:played'], test: e => e.card.type === 'artifact' },
        { id: 'first-attack', cat: 'first', name: 'Charge!', icon: '⚔️', tier: 'common', desc: 'Attack with a creature.', on: ['combat'], test: e => e.side === 'player' },
        { id: 'first-pack', cat: 'first', name: 'Rip It Open', icon: '📦', tier: 'common', desc: 'Open a booster pack.', on: ['pack:opened'], test: () => true, backfill: x => x.packsOpened >= 1 },
        { id: 'first-deck', cat: 'first', name: 'Deckwright', icon: '🛠️', tier: 'common', desc: 'Save a deck in the Deck Builder.', on: ['deck:saved'], test: () => true },
        { id: 'first-mulligan', cat: 'first', name: 'Take-Backsies', icon: '🔄', tier: 'common', desc: 'Take a mulligan.', on: ['mulligan'], test: () => true },

        // ---- Wins and losses
        { id: 'wins-10', cat: 'matches', name: 'Double Digits', icon: '🔟', tier: 'rare', desc: 'Win 10 matches.', on: ['match:end'], goal: 10, progress: x => x.wins, backfill: x => x.wins >= 10 },
        { id: 'wins-50', cat: 'matches', name: 'Seasoned Summoner', icon: '🎖️', tier: 'epic', desc: 'Win 50 matches.', on: ['match:end'], goal: 50, progress: x => x.wins, backfill: x => x.wins >= 50 },
        { id: 'first-loss', cat: 'matches', name: 'Character Building', icon: '🩹', tier: 'common', desc: 'Lose a match. It happens to the best of us.', on: ['match:end'], test: e => e.result === 'loss', backfill: x => x.losses >= 1 },
        { id: 'matches-100', cat: 'matches', name: 'Regular', icon: '🗓️', tier: 'epic', desc: 'Finish 100 matches.', on: ['match:end'], goal: 100, progress: x => x.wins + x.losses, backfill: x => x.wins + x.losses >= 100 },
        { id: 'streak-3', cat: 'matches', name: 'Hat Trick', icon: '🎩', tier: 'rare', desc: 'Win 3 matches in a row.', on: ['match:end'], goal: 3, progress: x => x.c.streak || 0 },
        { id: 'streak-10', cat: 'matches', name: 'Unstoppable', icon: '🚂', tier: 'legendary', desc: 'Win 10 matches in a row.', on: ['match:end'], goal: 10, progress: x => x.c.streak || 0 },
        { id: 'comeback', cat: 'matches', name: 'Comeback Kid', icon: '🔁', tier: 'rare', desc: 'Win a match in which your life fell to 3 or less.', on: ['match:end'], test: (e, x) => won(e) && x.m.minLife <= 3 },
        { id: 'flawless', cat: 'matches', name: 'Untouchable', icon: '🫥', tier: 'epic', desc: 'Win without losing any life.', on: ['match:end'], test: (e, x) => won(e) && x.m.lifeLost === 0 },
        { id: 'speedrun', cat: 'matches', name: 'Speedrun', icon: '⏱️', tier: 'epic', desc: 'Win on your turn 7 or earlier.', on: ['match:end'], test: (e, x) => won(e) && x.game.round <= 7 },
        { id: 'marathon', cat: 'matches', name: 'War of Attrition', icon: '🐢', tier: 'rare', desc: 'Win a match that reached turn 20.', on: ['match:end'], test: (e, x) => won(e) && x.game.round >= 20 },
        { id: 'so-close', cat: 'matches', name: 'So Close', icon: '🤏', tier: 'common', desc: 'Lose while the enemy had 3 life or less.', on: ['match:end'], test: (e, x) => e.result === 'loss' && x.game.enemyLife <= 3 },
        { id: 'rematch', cat: 'matches', name: 'Rematch Royale', icon: '🥊', tier: 'common', desc: 'Win the match right after a loss.', on: ['match:end'], test: (e, x) => won(e) && x.c.previousResult === 'loss' },

        // ---- Difficulty
        { id: 'win-easy', cat: 'difficulty', name: 'Training Wheels', icon: '🚲', tier: 'common', desc: 'Win on Easy.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'easy' },
        { id: 'win-medium', cat: 'difficulty', name: 'Fair Fight', icon: '⚖️', tier: 'common', desc: 'Win on Medium.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'medium' },
        { id: 'win-hard', cat: 'difficulty', name: 'Big Brain', icon: '🧠', tier: 'rare', desc: 'Win on Hard.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'hard' },
        { id: 'hard-5', cat: 'difficulty', name: 'Hard Mode Regular', icon: '🏋️', tier: 'epic', desc: 'Win 5 matches on Hard.', on: ['match:end'], goal: 5, progress: x => x.c.hardWins || 0 },
        { id: 'hard-dominant', cat: 'difficulty', name: 'Not Even Close', icon: '💅', tier: 'epic', desc: 'Win on Hard with 15 or more life left.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'hard' && x.game.playerLife >= 15 },
        { id: 'hard-mono', cat: 'difficulty', name: 'Purist', icon: '💠', tier: 'rare', desc: 'Win on Hard with a single-element deck.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'hard' && x.m.elements.length === 1 },
        { id: 'hard-clutch', cat: 'difficulty', name: 'Clutch', icon: '🫀', tier: 'epic', desc: 'Win on Hard after your life fell to 5 or less.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'hard' && x.m.minLife <= 5 },
        { id: 'all-difficulties', cat: 'difficulty', name: 'Full Spectrum', icon: '🎚️', tier: 'rare', desc: 'Win on Easy, Medium and Hard.', on: ['match:end'], goal: 3, progress: x => (x.c.difficultiesWon || []).length },
        { id: 'hard-underdog', cat: 'difficulty', name: 'Underdog', icon: '🐕', tier: 'epic', desc: 'Win on Hard while the enemy has more creatures on the battlefield than you.', on: ['match:end'], test: (e, x) => won(e) && x.m.difficulty === 'hard' && creaturesOf(x.game.enemyBoard).length > creaturesOf(x.game.playerBoard).length },

        // ---- The 15 decks
        ...DECKS.map(([key, name, icon, desc]) => ({ id: `deck-${key.toLowerCase().replace('_', '-')}`, cat: 'decks', name, icon, tier: key.includes('_') ? 'rare' : 'common', desc, on: ['match:end'], test: (e, x) => won(e) && x.m.deckKey === key })),

        // ---- Elements: thirty plays each, and one feat each
        ...ELEMENT_PLAYS.map(([element, name, icon, label]) => ({ id: `${element}-30`, cat: 'elements', name, icon, tier: 'common', desc: `Play 30 ${label} cards (not lands).`, on: ['card:played'], goal: 30, progress: x => x.c[`plays.${element}`] || 0 })),
        { id: 'fire-meteor', cat: 'elements', name: 'Spontaneous Combustion', icon: '☄️', tier: 'rare', desc: 'Deal 6 or more damage to the enemy with one instant.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.type === 'instant' && e.enemyLifeChange <= -6 },
        { id: 'water-tsunami', cat: 'elements', name: 'Tidal Wave', icon: '🌊', tier: 'rare', desc: 'Send 2 enemy creatures back to the hand with one Tsunami.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.effect === 'bounce' && e.bounced.length >= 2 },
        { id: 'earth-heavy', cat: 'elements', name: 'Heavyweight', icon: '🦣', tier: 'rare', desc: 'Control an Earth creature with 7 or more power.', on: ['board'], test: (e, x) => creaturesOf(x.game.playerBoard).some(c => x.el(c).includes('earth') && c.power >= 7) },
        { id: 'swamp-necro', cat: 'elements', name: 'Grave Robber', icon: '⚰️', tier: 'common', desc: 'Bring a creature back with Necromancy.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.__id === 'spells-necromancy' && !!e.revived },
        { id: 'light-heal', cat: 'elements', name: 'Holy Glow', icon: '😇', tier: 'rare', desc: 'Gain 10 or more life in one match.', on: ['life:changed'], test: (e, x) => x.m.lifeGained >= 10 },

        // ---- Card types
        { id: 'creatures-100', cat: 'types', name: 'Zookeeper', icon: '🦁', tier: 'rare', desc: 'Summon 100 creatures.', on: ['card:played'], goal: 100, progress: x => x.c['played.creature'] || 0 },
        { id: 'instants-50', cat: 'types', name: 'Spell Slinger', icon: '🪄', tier: 'rare', desc: 'Cast 50 instants.', on: ['card:played'], goal: 50, progress: x => x.c['played.instant'] || 0 },
        { id: 'artifacts-25', cat: 'types', name: 'Gadgeteer', icon: '🔧', tier: 'rare', desc: 'Play 25 artifacts.', on: ['card:played'], goal: 25, progress: x => x.c['played.artifact'] || 0 },
        { id: 'lands-100', cat: 'types', name: 'Real Estate Mogul', icon: '🏘️', tier: 'rare', desc: 'Play 100 lands.', on: ['card:played'], goal: 100, progress: x => x.c['played.land'] || 0 },
        { id: 'creatures-match-8', cat: 'types', name: 'Full House', icon: '🏠', tier: 'rare', desc: 'Summon 8 creatures in one match.', on: ['card:played'], test: (e, x) => x.m.creatures >= 8 },
        { id: 'instants-turn-3', cat: 'types', name: 'Combo Caster', icon: '🎇', tier: 'epic', desc: 'Cast 3 instants in one turn.', on: ['card:played'], test: (e, x) => x.m.instantsThisTurn >= 3 },
        { id: 'tokens-10', cat: 'types', name: 'Token Gesture', icon: '🎟️', tier: 'common', desc: 'Create 10 tokens.', on: ['spell:resolved'], goal: 10, progress: x => x.c.tokens || 0 },
        { id: 'legendary-play', cat: 'types', name: 'Legend Has It', icon: '🌟', tier: 'rare', desc: 'Play a Legendary card.', on: ['card:played'], test: (e, x) => x.rarity(e.card) === 'legendary' },

        // ---- Mana and lands
        { id: 'taps-500', cat: 'mana', name: 'Tap Dancer', icon: '🩰', tier: 'rare', desc: 'Tap lands for mana 500 times.', on: ['land:tapped'], goal: 500, progress: x => x.c.landTaps || 0 },
        { id: 'mana-7', cat: 'mana', name: 'Overflowing', icon: '🫗', tier: 'common', desc: 'Have 7 or more mana in your pool.', on: ['land:tapped', 'mana:artifact'], test: (e, x) => pool(x.game.playerMana) >= 7 },
        { id: 'mana-10', cat: 'mana', name: 'Mana Geyser', icon: '⛲', tier: 'epic', desc: 'Have 10 or more mana in your pool.', on: ['land:tapped', 'mana:artifact'], test: (e, x) => pool(x.game.playerMana) >= 10 },
        { id: 'exact-change', cat: 'mana', name: 'Exact Change', icon: '🪙', tier: 'rare', desc: 'Play a card that spends every mana in a pool of 5 or more.', on: ['card:played'], test: e => e.manaBefore >= 5 && e.manaAfter === 0 && e.card.type !== 'land' },
        { id: 'lands-8', cat: 'mana', name: 'Landowner', icon: '🏞️', tier: 'common', desc: 'Have 8 lands on your battlefield.', on: ['board'], test: (e, x) => (x.game.playerBoard || []).filter(c => c.type === 'land').length >= 8 },
        { id: 'rainbow', cat: 'mana', name: 'Taste the Rainbow', icon: '🌈', tier: 'rare', desc: 'Tap the Rainbow land for mana.', on: ['land:tapped'], test: e => e.cards.some(named('lands-rainbow')) },
        { id: 'distant-planet', cat: 'mana', name: 'Off-World Property', icon: '🪐', tier: 'rare', desc: 'Play the Distant Planet.', on: ['card:played'], test: e => e.card.__id === 'lands-distant-planet' },
        { id: 'mana-artifact', cat: 'mana', name: 'Batteries Included', icon: '🔋', tier: 'common', desc: 'Tap an artifact for mana.', on: ['mana:artifact'], test: () => true },
        { id: 'tap-all', cat: 'mana', name: 'Bulk Discount', icon: '🧺', tier: 'common', desc: 'Tap 3 or more lands at once (long-press a land stack).', on: ['land:tapped'], test: e => e.cards.length >= 3 },
        { id: 'prism', cat: 'mana', name: 'Prism', icon: '🔺', tier: 'rare', desc: 'Have 3 different kinds of mana in your pool at once.', on: ['land:tapped', 'mana:artifact'], test: (e, x) => Object.values(x.game.playerMana || {}).filter(n => n > 0).length >= 3 },

        // ---- Combat and keywords
        { id: 'air-mail', cat: 'combat', name: 'Air Mail', icon: '✉️', tier: 'common', desc: 'An unblocked flyer of yours hits the enemy.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => has(p.attacker, 'flying') && !p.blockers.length && p.lifeChange.enemy < 0) },
        { id: 'swat-team', cat: 'combat', name: 'Swat Team', icon: '🪰', tier: 'rare', desc: 'Your Reach creature blocks a flying attacker.', on: ['combat'], test: e => e.side === 'enemy' && e.pairs.some(p => has(p.attacker, 'flying') && p.blockers.some(b => has(b, 'reach'))) },
        { id: 'steamroller', cat: 'combat', name: 'Steamroller', icon: '🛞', tier: 'rare', desc: 'Trample 3 or more damage past a blocker.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => has(p.attacker, 'trample') && p.blockers.length && p.lifeChange.enemy <= -3) },
        { id: 'vampiric', cat: 'combat', name: 'Vampiric Tendencies', icon: '🧛', tier: 'rare', desc: 'Gain 4 or more life from lifelink in one attack.', on: ['combat'], test: e => e.side === 'player' && e.pairs.reduce((sum, p) => sum + Math.max(0, p.lifeChange.player), 0) >= 4 },
        { id: 'tiny-deadly', cat: 'combat', name: 'Tiny but Deadly', icon: '🦂', tier: 'rare', desc: 'A deathtouch creature of yours with 2 power or less destroys a creature with 4 or more toughness.', on: ['combat'], test: e => e.pairs.some(p => {
            const mine = e.side === 'player' ? [p.attacker] : p.blockers;
            const theirs = e.side === 'player' ? p.blockers.filter(b => p.blockersDie.includes(b.id)) : (p.attackerDies ? [p.attacker] : []);
            return mine.some(c => has(c, 'deathtouch') && c.power <= 2) && theirs.some(c => c.toughness >= 4);
        }) },
        { id: 'quick-draw', cat: 'combat', name: 'Quick Draw', icon: '🤠', tier: 'rare', desc: 'Your first striker kills a blocker that would otherwise have killed it.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => has(p.attacker, 'first_strike') && !p.attackerDies && p.blockers.length === 1 && p.blockersDie.includes(p.blockers[0].id) && p.blockers[0].power >= p.attacker.toughness) },
        { id: 'double-strike', cat: 'combat', name: 'Once in a Blue Moon', icon: '🌕', tier: 'rare', desc: 'A double strike creature of yours (hello, Werewolf) hits the enemy.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => has(p.attacker, 'double_strike') && p.lifeChange.enemy < 0) },
        { id: 'scary-face', cat: 'combat', name: 'Scary Face', icon: '😱', tier: 'common', desc: 'Your Menace creature goes unblocked while the enemy has an untapped creature.', on: ['combat'], test: e => e.side === 'player' && e.untappedDefenders >= 1 && e.pairs.some(p => has(p.attacker, 'menace') && !p.blockers.length) },
        { id: 'night-watch', cat: 'combat', name: 'Night Watch', icon: '🔦', tier: 'rare', desc: 'Attack with a Vigilance creature, then block with it on the enemy\'s next turn.', on: ['combat'], test: (e, x) => e.side === 'enemy' && e.pairs.some(p => p.blockers.some(b => x.m.vigilanceAttackers.includes(b.id))) },
        { id: 'no-time', cat: 'combat', name: 'No Time to Waste', icon: '⚡', tier: 'common', desc: 'Attack with a creature on the turn you played it.', on: ['combat'], test: (e, x) => e.side === 'player' && e.pairs.some(p => x.m.playedThisTurn.includes(p.attacker.id)) },
        { id: 'brick-wall', cat: 'combat', name: 'Brick Wall', icon: '🧱', tier: 'common', desc: 'Your Defender blocks an attacker and survives.', on: ['combat'], test: e => e.side === 'enemy' && e.pairs.some(p => p.blockers.some(b => has(b, 'defender') && !p.blockersDie.includes(b.id))) },
        { id: 'shell-game', cat: 'combat', name: 'Shell Game', icon: '🐚', tier: 'rare', desc: 'Control 3 hexproof creatures at once.', on: ['board'], test: (e, x) => creaturesOf(x.game.playerBoard).filter(c => has(c, 'hexproof')).length >= 3 },
        { id: 'slippery', cat: 'combat', name: 'Slippery Otter', icon: '🦦', tier: 'rare', desc: 'An unblockable creature of yours hits the enemy.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => has(p.attacker, 'unblockable') && p.lifeChange.enemy < 0) },
        { id: 'bodyguard', cat: 'combat', name: 'Bodyguard', icon: '🕴️', tier: 'common', desc: 'One of your automatic blocks destroys the attacker.', on: ['combat'], test: e => e.side === 'enemy' && e.pairs.some(p => p.blockers.length && p.attackerDies) },
        { id: 'double-team', cat: 'combat', name: 'Double Team', icon: '👯', tier: 'rare', desc: 'Block a Menace attacker with two of your creatures.', on: ['combat'], test: e => e.side === 'enemy' && e.pairs.some(p => has(p.attacker, 'menace') && p.blockers.length >= 2) },
        { id: 'alpha-strike', cat: 'combat', name: 'Alpha Strike', icon: '💥', tier: 'epic', desc: 'Deal 10 or more combat damage to the enemy in one attack.', on: ['combat'], test: e => e.side === 'player' && -e.pairs.reduce((sum, p) => sum + Math.min(0, p.lifeChange.enemy), 0) >= 10 },
        { id: 'coup', cat: 'combat', name: 'Coup de Grâce', icon: '🗡️', tier: 'common', desc: 'Win with combat damage.', on: ['match:end'], test: (e, x) => won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'combat' },
        { id: 'all-in', cat: 'combat', name: 'All In', icon: '🎲', tier: 'rare', desc: 'Attack with 5 or more creatures at once.', on: ['combat'], test: e => e.side === 'player' && e.pairs.length >= 5 },
        { id: 'fair-trade', cat: 'combat', name: 'Fair Trade', icon: '🤝', tier: 'common', desc: 'Your attacker and its blocker destroy each other.', on: ['combat'], test: e => e.side === 'player' && e.pairs.some(p => p.attackerDies && p.blockers.length && p.blockers.every(b => p.blockersDie.includes(b.id))) },
        { id: 'clean-sweep', cat: 'combat', name: 'Clean Sweep', icon: '🧹', tier: 'epic', desc: 'Destroy 3 or more enemy creatures in one attack.', on: ['combat'], test: e => e.side === 'player' && e.pairs.reduce((sum, p) => sum + p.blockersDie.length, 0) >= 3 },

        // ---- Spells and artifacts
        { id: 'hot-potato', cat: 'effects', name: 'Hot Potato', icon: '🥔', tier: 'rare', desc: 'Deal 15 damage to the enemy with instants in one match.', on: ['spell:resolved'], test: (e, x) => x.m.instantDamage >= 15 },
        { id: 'burned-out', cat: 'effects', name: 'Burned Out', icon: '🧯', tier: 'rare', desc: 'Win with damage from an instant.', on: ['match:end'], test: (e, x) => won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'instant' },
        { id: 'avalanche', cat: 'effects', name: 'Avalanche Warning', icon: '🏔️', tier: 'rare', desc: 'Your Earthquake or Avalanche destroys 3 or more creatures at once.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.target === 'all' && e.deaths.length >= 3 },
        { id: 'kaboom', cat: 'effects', name: 'Kaboom', icon: '💣', tier: 'rare', desc: 'Your Bomb destroys 2 or more enemy creatures.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.effect === 'aoe' && e.deaths.filter(d => d.owner === 'enemy').length >= 2 },
        { id: 'giant-slayer', cat: 'effects', name: 'Giant Slayer', icon: '🪓', tier: 'epic', desc: 'Destroy an enemy Legendary creature with a spell.', on: ['spell:resolved'], test: (e, x) => e.side === 'player' && e.destroyed.some(c => x.rarity(c) === 'legendary') },
        { id: 'chill-out', cat: 'effects', name: 'Chill Out', icon: '🥶', tier: 'rare', desc: 'Deep Freeze an enemy creature that was already tapped.', on: ['spell:resolved'], test: e => e.side === 'player' && e.frozeTapped },
        { id: 'brink', cat: 'effects', name: 'Back from the Brink', icon: '🩺', tier: 'epic', desc: 'Climb from 5 life or less back to 15 or more in one match.', on: ['life:changed'], test: (e, x) => e.side === 'player' && x.m.minLife <= 5 && e.after >= 15 },
        { id: 'blood-bank', cat: 'effects', name: 'Blood Bank', icon: '🩸', tier: 'epic', desc: 'Win with Drain Life.', on: ['match:end'], test: (e, x) => won(e) && e.reason === 'life' && x.m.lastEnemyLoss === 'drain' },
        { id: 'second-coming', cat: 'effects', name: 'Second Coming', icon: '👼', tier: 'epic', desc: 'Bring a Legendary creature back from your graveyard.', on: ['spell:resolved'], test: (e, x) => e.side === 'player' && !!e.revived && x.rarity(e.revived) === 'legendary' },
        { id: 'token-horde', cat: 'effects', name: 'Token Horde', icon: '🧟', tier: 'rare', desc: 'Control 6 or more tokens at once.', on: ['board'], test: (e, x) => (x.game.playerBoard || []).filter(isToken).length >= 6 },
        { id: 'pumped', cat: 'effects', name: 'Pumped Up', icon: '💪', tier: 'common', desc: 'Give a creature +3 or more power with one card.', on: ['spell:resolved'], test: e => e.side === 'player' && e.card.effect === 'buff' && e.card.value >= 3 && e.buffed > 0 },
        { id: 'road-rage', cat: 'effects', name: 'Road Rage', icon: '🤬', tier: 'epic', desc: 'Win on a turn you cast Anger.', on: ['match:end'], test: (e, x) => won(e) && x.m.angerThisTurn },
        { id: 'mind-wipe', cat: 'effects', name: 'Mind Wipe', icon: '🌀', tier: 'rare', desc: 'Make the enemy discard their last card.', on: ['spell:resolved'], test: e => e.side === 'player' && e.discarded > 0 && e.enemyHandAfter === 0 },
        { id: 'return-sender', cat: 'effects', name: 'Return to Sender', icon: '📮', tier: 'rare', desc: 'Send an enemy creature that costs 5 or more back to the hand.', on: ['spell:resolved'], test: e => e.side === 'player' && e.bounced.some(c => pool(c.cost) >= 5) },
        { id: 'bookworm', cat: 'effects', name: 'Bookworm', icon: '📚', tier: 'rare', desc: 'Draw 3 or more extra cards in one turn.', on: ['spell:resolved', 'upkeep'], test: (e, x) => x.m.extraDrawsThisTurn >= 3 },
        { id: 'upkeep-3', cat: 'effects', name: 'Slow and Steady', icon: '⏳', tier: 'rare', desc: 'Control 3 artifacts that act at the start of your turn.', on: ['board'], test: (e, x) => (x.game.playerBoard || []).filter(c => c.type === 'artifact' && UPKEEP_EFFECTS.includes(c.effect)).length >= 3 },

        // ---- Collection and packs (the collection is saved, so these can be recognised from an existing profile)
        { id: 'own-175', cat: 'collection', name: 'Growing Binder', icon: '📗', tier: 'common', desc: 'Own 175 different cards.', on: ['collection'], goal: 175, progress: x => x.owned, backfill: x => x.owned >= 175 },
        { id: 'own-200', cat: 'collection', name: 'Binder Overflow', icon: '📒', tier: 'rare', desc: 'Own 200 different cards.', on: ['collection'], goal: 200, progress: x => x.owned, backfill: x => x.owned >= 200 },
        { id: 'own-250', cat: 'collection', name: 'Almost There', icon: '🧩', tier: 'epic', desc: 'Own 250 different cards.', on: ['collection'], goal: 250, progress: x => x.owned, backfill: x => x.owned >= 250 },
        { id: 'own-all', cat: 'collection', name: "Gotta Emoji 'Em All", icon: '🏆', tier: 'legendary', desc: 'Own every card: all 268.', on: ['collection'], goal: 268, progress: x => x.owned, backfill: x => x.owned >= x.catalogSize },
        { id: 'own-legendary', cat: 'collection', name: 'Living Legend', icon: '🏅', tier: 'rare', desc: 'Own a Legendary card.', on: ['collection'], test: (e, x) => x.ownedBy('legendary') >= 1, backfill: x => x.ownedBy('legendary') >= 1 },
        { id: 'own-all-legendary', cat: 'collection', name: 'Hall of Legends', icon: '🏛️', tier: 'legendary', desc: 'Own all 9 Legendary cards.', on: ['collection'], goal: 9, progress: x => x.ownedBy('legendary'), backfill: x => x.ownedBy('legendary') >= 9 },
        { id: 'own-all-epic', cat: 'collection', name: 'Epic Saga', icon: '📜', tier: 'epic', desc: 'Own all 14 Epic cards.', on: ['collection'], goal: 14, progress: x => x.ownedBy('epic'), backfill: x => x.ownedBy('epic') >= 14 },
        { id: 'own-scifi', cat: 'collection', name: 'Sci-Fi Nerd', icon: '🤓', tier: 'epic', desc: 'Own all 56 Science Fiction cards.', on: ['collection'], goal: 56, progress: x => x.ownedTheme('Science Fiction'), backfill: x => x.ownedTheme('Science Fiction') >= 56 },
        { id: 'packs-10', cat: 'collection', name: 'Pack Rat', icon: '🐀', tier: 'common', desc: 'Open 10 booster packs.', on: ['pack:opened'], goal: 10, progress: x => x.packsOpened, backfill: x => x.packsOpened >= 10 },
        { id: 'packs-50', cat: 'collection', name: 'Shrink-Wrap Shredder', icon: '✂️', tier: 'epic', desc: 'Open 50 booster packs.', on: ['pack:opened'], goal: 50, progress: x => x.packsOpened, backfill: x => x.packsOpened >= 50 },
        { id: 'pack-sampler', cat: 'collection', name: 'Sampler Platter', icon: '🍱', tier: 'rare', desc: 'Open one of each of the 6 pack types.', on: ['pack:opened'], goal: 6, progress: x => (x.c.packTypes || []).length },
        { id: 'golden-ticket', cat: 'collection', name: 'Golden Ticket', icon: '🎫', tier: 'rare', desc: 'Pull a Legendary card from a pack.', on: ['pack:opened'], test: e => e.cards.some(c => c.rarity === 'legendary') },
        { id: 'fresh-stock', cat: 'collection', name: 'Fresh Stock', icon: '🆕', tier: 'common', desc: 'Open a pack in which all 5 cards are new to you.', on: ['pack:opened'], test: e => e.cards.length === 5 && e.cards.every(c => c.isNew) },
        { id: 'deja-vu', cat: 'collection', name: 'Déjà Vu', icon: '🪞', tier: 'common', desc: 'Open a pack with no new cards in it.', on: ['pack:opened'], test: e => e.cards.length > 0 && e.cards.every(c => !c.isNew) },
        { id: 'jackpot', cat: 'collection', name: 'Jackpot', icon: '🎰', tier: 'epic', desc: 'Pull a Rare and a Legendary from the same pack.', on: ['pack:opened'], test: e => e.cards.some(c => c.rarity === 'rare') && e.cards.some(c => c.rarity === 'legendary') },
        { id: 'savings', cat: 'collection', name: 'Savings Account', icon: '🏦', tier: 'rare', desc: 'Have 500 credits.', on: ['wallet'], test: (e, x) => x.credits >= 500, backfill: x => x.credits >= 500 },
        { id: 'big-spender', cat: 'collection', name: 'Big Spender', icon: '💸', tier: 'rare', desc: 'Spend 1,000 credits on packs.', on: ['pack:purchased'], goal: 1000, progress: x => x.c.creditsSpent || 0 },
        { id: 'triple-crown', cat: 'collection', name: 'Triple Crown', icon: '👑', tier: 'legendary', desc: 'Own 3 copies of the same Legendary card.', on: ['collection'], test: (e, x) => x.maxCopiesOf('legendary') >= 3, backfill: x => x.maxCopiesOf('legendary') >= 3 },

        // ---- Rare match conditions
        { id: 'library', cat: 'rare', name: 'Library Card Revoked', icon: '📭', tier: 'epic', desc: 'Win because the enemy ran out of cards to draw.', on: ['match:end'], test: e => won(e) && e.reason === 'decked' },
        { id: 'overdrawn', cat: 'rare', name: 'Overdrawn', icon: '🫠', tier: 'rare', hidden: true, desc: 'Lose because you ran out of cards to draw.', on: ['match:end'], test: e => e.result === 'loss' && e.reason === 'decked' },
        { id: 'overkill', cat: 'rare', name: 'Overkill', icon: '🔨', tier: 'rare', desc: 'Finish the enemy with a single hit that deals 5 or more damage beyond their last life point.', on: ['life:changed'], test: e => e.side === 'enemy' && e.after === 0 && -e.amount - e.before >= 5 },
        { id: 'by-a-thread', cat: 'rare', name: 'By a Thread', icon: '🧵', tier: 'epic', desc: 'Win with exactly 1 life.', on: ['match:end'], test: (e, x) => won(e) && x.game.playerLife === 1 },
        { id: 'healthy', cat: 'rare', name: 'Healthier Than Ever', icon: '💚', tier: 'epic', desc: 'Win with 30 or more life.', on: ['match:end'], test: (e, x) => won(e) && x.game.playerLife >= 30 },
        { id: 'spellbound', cat: 'rare', name: 'Spellbound', icon: '📖', tier: 'epic', desc: 'Win without summoning a creature.', on: ['match:end'], test: (e, x) => won(e) && x.m.creatures === 0 },
        { id: 'pacifist', cat: 'rare', name: 'Pacifist', icon: '☮️', tier: 'epic', desc: 'Win without attacking.', on: ['match:end'], test: (e, x) => won(e) && x.m.attacks === 0 },
        { id: 'lone-wolf', cat: 'rare', name: 'Lone Wolf', icon: '🐺', tier: 'rare', desc: 'Win while you control exactly one creature.', on: ['match:end'], test: (e, x) => won(e) && creaturesOf(x.game.playerBoard).length === 1 },
        { id: 'scorched-earth', cat: 'rare', name: 'Scorched Earth', icon: '🏜️', tier: 'rare', desc: 'Win while the enemy controls no creatures and you control 5 or more.', on: ['match:end'], test: (e, x) => won(e) && creaturesOf(x.game.enemyBoard).length === 0 && creaturesOf(x.game.playerBoard).length >= 5 },
        { id: 'shoestring', cat: 'rare', name: 'Shoestring Budget', icon: '🥾', tier: 'rare', desc: 'Win having played 3 lands or fewer.', on: ['match:end'], test: (e, x) => won(e) && x.m.lands <= 3 },

        // ---- Special combinations (every set fits in one deck)
        { id: 'spooky-season', cat: 'combo', name: 'Spooky Season', icon: '🎃', tier: 'rare', desc: 'Control Risen Zombie, Restless Ghost and Skeleton Warrior at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-risen-zombie', 'creatures-restless-ghost', 'creatures-skeleton-warrior') },
        { id: 'phoenix-rising', cat: 'combo', name: 'Phoenix Rising', icon: '🐦‍🔥', tier: 'epic', desc: 'Control Phoenix and Phoenix Firebird at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-phoenix', 'creatures-phoenix-firebird') },
        { id: 'shark-week', cat: 'combo', name: 'Shark Week', icon: '🦈', tier: 'epic', desc: 'Control Great Shark and Great White Shark at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-great-shark', 'creatures-great-white-shark') },
        { id: 'fairy-tale', cat: 'combo', name: 'Fairy Tale', icon: '🦄', tier: 'epic', desc: 'Control Sacred Unicorn, Winged Pegasus and Forest Fairy at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-sacred-unicorn', 'creatures-winged-pegasus', 'creatures-forest-fairy') },
        { id: 'big-cat-energy', cat: 'combo', name: 'Big Cat Energy', icon: '🐈', tier: 'rare', desc: 'Control Blazing Tiger, Bengal Tiger and Fire Lion at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-blazing-tiger', 'creatures-bengal-tiger', 'creatures-fire-lion') },
        { id: 'some-assembly', cat: 'combo', name: 'Some Assembly Required', icon: '⚙️', tier: 'epic', desc: 'Control Battle Mech, Combat Robot and Mech Part at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-battle-mech', 'creatures-combat-robot', 'creatures-mech-part') },

        // ---- Playful
        { id: 'flash-mob', cat: 'playful', name: 'Flash Mob', icon: '📸', tier: 'rare', desc: 'Control 3 creatures with Flash. Flash still does nothing; they are just very fast at standing still.', on: ['board'], test: (e, x) => creaturesOf(x.game.playerBoard).filter(c => has(c, 'flash')).length >= 3 },
        { id: 'poop-happens', cat: 'playful', name: 'Poop Happens', icon: '💩', tier: 'common', hidden: true, desc: 'Play the Poop. With Menace, apparently.', on: ['card:played'], test: e => e.card.__id === 'creatures-poop' },
        { id: 'rage-quit', cat: 'playful', name: 'Rage Quit', icon: '🙃', tier: 'common', hidden: true, desc: 'Leave a match from the pause menu while 10 or more life behind.', on: ['match:quit'], test: (e, x) => x.game.enemyLife - x.game.playerLife >= 10 },
        { id: 'card-inspector', cat: 'playful', name: 'Card Inspector', icon: '🔍', tier: 'common', desc: 'Look at card details 50 times.', on: ['card:details'], goal: 50, progress: x => x.c.cardDetails || 0 },
        { id: 'decorator', cat: 'playful', name: 'Interior Decorator', icon: '🎨', tier: 'common', desc: 'Try all three visual themes.', on: ['theme'], goal: 3, progress: x => (x.c.themes || []).length },
        { id: 'clown-car', cat: 'playful', name: 'Clown Car', icon: '🤡', tier: 'rare', hidden: true, desc: 'Control Demonic Clown and Dread Clown at once.', on: ['board'], test: (e, x) => onBoard(x.game.playerBoard, 'creatures-demonic-clown', 'creatures-dread-clown') }
    ];

    const CATEGORIES = [
        ['first', 'First steps', '👣'], ['matches', 'Wins & losses', '🏁'], ['difficulty', 'Difficulty', '🎚️'], ['decks', 'Decks', '🃏'],
        ['elements', 'Elements', '🔥'], ['types', 'Card types', '🗂️'], ['mana', 'Mana & lands', '⚡'], ['combat', 'Combat', '⚔️'],
        ['effects', 'Spells & artifacts', '🪄'], ['collection', 'Collection & packs', '📦'], ['rare', 'Rare feats', '💎'],
        ['combo', 'Combinations', '🧩'], ['playful', 'Just for fun', '🎈']
    ];

    const byId = new Map(CATALOG.map(a => [a.id, a]));
    const byEvent = new Map();
    CATALOG.forEach(a => a.on.forEach(type => {
        if (!byEvent.has(type)) byEvent.set(type, []);
        byEvent.get(type).push(a);
    }));

    // ---- Storage: { version, unlocked: { id: { at, backfilled? } }, counters: {}, prefs: {} }
    let store = null;
    let persist = true;
    let hooks = null;
    let saveTimer = null;
    const listeners = [];

    function emptyStore() {
        return { version: VERSION, unlocked: {}, counters: {}, prefs: { notify: true } };
    }

    function load() {
        let raw = null;
        try { raw = localStorage.getItem(STORE_KEY); } catch (_) { /* blocked storage */ }
        if (!raw) return emptyStore();
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
            // A newer version than this build knows: use it read-only, so it is never overwritten with less
            if (Number(parsed.version) > VERSION) {
                persist = false;
                return { ...emptyStore(), ...parsed };
            }
            return migrate(parsed);
        } catch (_) {
            // Unreadable: keep a copy, start again (the backfill below recognises what the profile proves)
            try { localStorage.setItem(BACKUP_KEY, raw); } catch (__) { /* blocked */ }
            return emptyStore();
        }
    }

    // Version 1 is the first format. Unknown fields are dropped, unknown ids are kept (a later catalog may know them).
    function migrate(saved) {
        const out = emptyStore();
        const unlocked = saved.unlocked && typeof saved.unlocked === 'object' ? saved.unlocked : {};
        Object.entries(unlocked).forEach(([id, info]) => {
            if (typeof id === 'string' && info) out.unlocked[id] = { at: typeof info.at === 'string' ? info.at : new Date(0).toISOString(), ...(info.backfilled ? { backfilled: true } : {}) };
        });
        const counters = saved.counters && typeof saved.counters === 'object' ? saved.counters : {};
        Object.entries(counters).forEach(([key, value]) => {
            if (Array.isArray(value)) out.counters[key] = value.filter(v => typeof v === 'string');
            else if (Number.isFinite(value)) out.counters[key] = value;
            else if (typeof value === 'string') out.counters[key] = value;
        });
        if (saved.prefs && typeof saved.prefs.notify === 'boolean') out.prefs.notify = saved.prefs.notify;
        return out;
    }

    function saveNow() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (!persist || !store) return;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* full or blocked: kept for this visit */ }
    }

    // Counters change often (every land tap); they are written at most twice a second, unlocks at once
    function saveSoon() {
        if (!persist || saveTimer) return;
        saveTimer = setTimeout(saveNow, 500);
    }

    // ---- Counters
    const count = (key, by = 1) => { store.counters[key] = (store.counters[key] || 0) + by; };
    const addToSet = (key, value) => {
        const set = store.counters[key] || (store.counters[key] = []);
        if (!set.includes(value)) set.push(value);
    };

    // ---- The current match (not saved: a reload starts a new match anyway)
    let m = null;
    function newMatch(e) {
        return {
            deckKey: e.deckKey, elements: e.elements || [], difficulty: e.difficulty,
            minLife: 20, lifeLost: 0, lifeGained: 0,
            creatures: 0, instants: 0, lands: 0, attacks: 0, instantDamage: 0,
            instantsThisTurn: 0, extraDrawsThisTurn: 0, angerThisTurn: false,
            playedThisTurn: [], vigilanceAttackers: [], lastEnemyLoss: null
        };
    }

    function context() {
        const meta = hooks.meta() || {};
        const collection = meta.collection || {};
        const cards = hooks.cards();
        const ownedIds = Object.keys(collection).filter(id => cards[id] && collection[id] > 0);
        return {
            m: m || newMatch({}),
            c: store.counters,
            game: hooks.game(),
            meta,
            el: hooks.identity,
            rarity: hooks.rarity,
            wins: Math.max(0, Number(meta.stats?.wins) || 0),
            losses: Math.max(0, Number(meta.stats?.losses) || 0),
            packsOpened: Math.max(0, Number(meta.stats?.packsOpened) || 0),
            credits: Math.max(0, Number(meta.wallet?.credits) || 0),
            owned: ownedIds.length,
            catalogSize: Object.keys(cards).length,
            ownedBy: rarity => ownedIds.filter(id => hooks.rarity(cards[id]) === rarity).length,
            ownedTheme: theme => ownedIds.filter(id => cards[id].theme === theme).length,
            maxCopiesOf: rarity => Math.max(0, ...ownedIds.filter(id => hooks.rarity(cards[id]) === rarity).map(id => collection[id]))
        };
    }

    // ---- Unlocking
    function unlock(def, { backfilled = false } = {}) {
        if (store.unlocked[def.id]) return false;
        store.unlocked[def.id] = { at: new Date().toISOString(), ...(backfilled ? { backfilled: true } : {}) };
        saveNow();
        listeners.forEach(fn => { try { fn(def, { backfilled }); } catch (_) { /* a listener's problem */ } });
        return true;
    }

    function earned(def, e, x) {
        if (def.goal) return def.progress(x) >= def.goal;
        return !!def.test(e, x);
    }

    function evaluate(type, e) {
        const defs = byEvent.get(type);
        if (!defs) return;
        let x = null;
        defs.forEach(def => {
            if (store.unlocked[def.id]) return;
            x = x || context();
            try {
                if (earned(def, e, x)) unlock(def);
            } catch (_) { /* a trigger that can't read its event just doesn't fire */ }
        });
    }

    // ---- Events: update the counters and the match, then check the achievements that listen for it
    const REDUCERS = {
        'match:start': e => { m = newMatch(e); },
        'turn:start': e => {
            if (!m || e.side !== 'player') return;
            m.instantsThisTurn = 0;
            m.extraDrawsThisTurn = 0;
            m.angerThisTurn = false;
            m.playedThisTurn = [];
            m.vigilanceAttackers = [];
        },
        'card:played': e => {
            count(`played.${e.card.type}`);
            if (e.card.type !== 'land') hooks.identity(e.card).forEach(element => { if (element !== 'colorless') count(`plays.${element}`); });
            if (!m) return;
            if (e.card.type === 'creature') { m.creatures++; m.playedThisTurn.push(e.card.id); }
            if (e.card.type === 'instant') { m.instants++; m.instantsThisTurn++; }
            if (e.card.type === 'land') m.lands++;
            if (e.card.__id === 'spells-anger') m.angerThisTurn = true;
        },
        'land:tapped': e => count('landTaps', e.cards.length),
        combat: e => {
            if (!m || e.side !== 'player') return;
            m.attacks++;
            // Vigilance attackers stay untapped; remember them for the enemy's next turn (Night Watch)
            m.vigilanceAttackers = e.pairs.filter(p => has(p.attacker, 'vigilance')).map(p => p.attacker.id);
        },
        'spell:resolved': e => {
            if (e.side === 'player') count('tokens', e.tokens || 0);
            if (!m || e.side !== 'player') return;
            m.extraDrawsThisTurn += e.drawn || 0;
        },
        upkeep: e => {
            if (!m || e.side !== 'player') return;
            m.extraDrawsThisTurn += e.drawn || 0;
        },
        'life:changed': e => {
            if (!m) return;
            if (e.side === 'player') {
                if (e.change < 0) m.lifeLost += -e.change;
                else m.lifeGained += e.change;
                m.minLife = Math.min(m.minLife, e.after);
            } else if (e.change < 0 && e.source) {
                // The source of the enemy's latest loss decides "win with ..." (it is set before the match ends)
                m.lastEnemyLoss = e.source;
                if (e.source === 'instant' || e.source === 'drain') m.instantDamage += -e.change;
            }
        },
        'match:end': e => {
            if (e.result === 'win') {
                count('streak');
                if (m?.difficulty === 'hard') count('hardWins');
                if (m?.difficulty) addToSet('difficultiesWon', m.difficulty);
            } else {
                store.counters.streak = 0;
            }
        },
        'pack:opened': e => { if (e.themeKey) addToSet('packTypes', e.themeKey); },
        'pack:purchased': e => count('creditsSpent', e.price || 0),
        'card:details': () => count('cardDetails'),
        theme: e => addToSet('themes', e.theme)
    };

    // Events after which the board may have changed: the "control X at once" achievements check then
    const BOARD_EVENTS = ['card:played', 'spell:resolved', 'combat', 'turn:start', 'match:start'];

    function emit(type, e = {}) {
        if (!store || !hooks) return;
        try {
            REDUCERS[type]?.(e);
            evaluate(type, e);
            if (BOARD_EVENTS.includes(type)) evaluate('board', e);
            if (type === 'match:end') {
                // Saved after the checks that read it ("the match right after a loss"). The match context stays
                // until the next match starts: the spell or combat that ended it is reported just after this.
                store.counters.previousResult = e.result;
            }
            saveSoon();
        } catch (error) {
            if (hooks.debug) console.warn('[achievements]', type, error);
        }
    }

    // Unlocks provable from the saved profile alone: wins, losses, packs opened, collection and credits.
    // Nothing about past plays is ever invented.
    function backfill() {
        const x = context();
        const recognised = [];
        CATALOG.forEach(def => {
            if (def.backfill && !store.unlocked[def.id]) {
                try {
                    if (def.backfill(x) && unlock(def, { backfilled: true })) recognised.push(def);
                } catch (_) { /* skip */ }
            }
        });
        return recognised;
    }

    function init(options) {
        hooks = options;
        persist = options.persist !== false;
        store = load();
        if (!store.counters.themes && options.currentTheme) addToSet('themes', options.currentTheme);
        const recognised = backfill();
        saveNow();
        return recognised;
    }

    function progressOf(def) {
        if (!def.goal || !store) return null;
        try {
            const value = def.progress(context());
            return { value: Math.min(def.goal, Math.max(0, value)), goal: def.goal };
        } catch (_) {
            return { value: 0, goal: def.goal };
        }
    }

    window.Achievements = {
        VERSION,
        STORE_KEY,
        catalog: CATALOG,
        categories: CATEGORIES,
        get: id => byId.get(id),
        init,
        emit,
        isUnlocked: id => !!store?.unlocked[id],
        unlockedAt: id => store?.unlocked[id]?.at || null,
        wasBackfilled: id => !!store?.unlocked[id]?.backfilled,
        unlockedCount: () => CATALOG.filter(a => store?.unlocked[a.id]).length,
        progressOf,
        onUnlock: fn => listeners.push(fn),
        get persisting() { return persist; },
        get notify() { return store?.prefs.notify !== false; },
        setNotify(on) { if (!store) return; store.prefs.notify = !!on; saveNow(); },
        counters: () => ({ ...(store?.counters || {}) }),
        flush: saveNow
    };
})();
