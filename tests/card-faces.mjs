#!/usr/bin/env node
// Card presentation audit for EMOJI ELEMENTS: hand, battlefield, card details and pack reveals at phone,
// short-landscape and desktop sizes.
//
//   node tests/card-faces.mjs                       # all profiles (npm run cards:ui)
//   node tests/card-faces.mjs --profile=phone
//   node tests/card-faces.mjs --label=before --report-only
//
// It renders representative cards of every type, element and rarity through the game's own renderers
// (createCardElement, performUIUpdate, showCardDetail, the pack reveal), on a crowded board with tapped,
// summoning-sick, damaged and attacking creatures, and checks:
//   faces     every cost is shown exactly (each element and colorless, free artifacts as 0); creatures show
//             power/toughness; each face carries its element identity (mono, dual, colorless, all five) and
//             a type marker; element backgrounds differ; dual cards differ from both of their colours
//   rarity    rarities are told apart by their border, and no rarity animates forever
//   states    tapped, summoning-sick, damaged, attacking and playable/unplayable each differ from the plain
//             card by something other than colour (shape, position, border style or a marker)
//   keywords  details show each keyword's badge, label and KEYWORD_RULES text; Flash is shown as inactive
//             on the board and in details
//   details   type, rarity, element names, cost, power/toughness, rules line, and the card's board state
//   pack      reveals show rarity, type, cost and power/toughness
//   layout    no horizontal overflow; badges stay inside their card; text at least 10 px; compact cards on
//             phones; controls on screen with a crowded board
//   input     tap plays, long-press inspects without playing (bindCardPress unchanged)
// Screenshots and card-faces.json go to test-results/cards/<label>/ (gitignored). Exit 1 if a check fails.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadPlaywright, startServer } from './lib/harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
}));
const LABEL = args.label || 'current';
const OUT = path.join(ROOT, 'test-results', 'cards', LABEL);
const { chromium, devices } = loadPlaywright();

const PROFILES = {
    phone: { touch: true, options: { ...devices['Galaxy S8'] } },                     // 360×740
    landscape: { touch: true, options: { ...devices['Pixel 7 landscape'] } },         // 863×360
    desktop: { touch: false, options: { viewport: { width: 1366, height: 768 } } }
};

const results = [];
function check(profile, area, label, ok, detail = '') {
    results.push({ profile, area, label, ok: !!ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} [${area}] ${label}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}

function seededInit() {
    let state = 20261021;
    Math.random = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Representative catalog ids, chosen in the page from the live catalog
function pickRepresentatives() {
    const all = window.__ALL_CARDS;
    const colours = card => Object.keys(card.cost || {}).filter(k => k !== 'colorless');
    const first = fn => all.find(fn)?.__id;
    const out = {};
    for (const el of ['fire', 'water', 'earth', 'swamp', 'light']) {
        out[`creature-${el}`] = first(c => c.type === 'creature' && c.__rarity === 'common' && colours(c).join() === el && !(c.abilities || []).length);
        out[`instant-${el}`] = first(c => c.type === 'instant' && colours(c).join() === el);
        out[`artifact-${el}`] = first(c => c.type === 'artifact' && colours(c).join() === el);
        out[`land-${el}`] = first(c => c.type === 'land' && c.element === el);
    }
    out['creature-dual'] = first(c => c.type === 'creature' && colours(c).length === 2);
    out['instant-dual'] = first(c => c.type === 'instant' && colours(c).length === 2);
    out['artifact-dual'] = first(c => c.type === 'artifact' && colours(c).length === 2);
    out['artifact-colorless'] = first(c => c.type === 'artifact' && c.cost?.colorless && colours(c).length === 0);
    out['artifact-free'] = first(c => c.type === 'artifact' && Object.keys(c.cost || {}).length === 0);
    out['land-colorless'] = first(c => c.type === 'land' && c.element === 'colorless');
    out['land-dual'] = first(c => c.type === 'land' && c.elements?.length === 2);
    out['land-rainbow'] = first(c => c.type === 'land' && c.elements?.length === 5);
    for (const rarity of ['rare', 'epic', 'legendary']) out[`creature-${rarity}`] = first(c => c.type === 'creature' && c.__rarity === rarity);
    out['creature-keywords'] = first(c => c.type === 'creature' && (c.abilities || []).length >= 2);
    out['creature-flash'] = first(c => c.type === 'creature' && (c.abilities || []).includes('flash'));
    return Object.fromEntries(Object.entries(out).filter(([, id]) => id));
}

// The element identity a face should carry: cost colours, a land's colour(s), else colorless
const identityOf = card => {
    if (card.type === 'land') return (card.elements || [card.element]).filter(Boolean).sort().join(' ');
    const colours = Object.keys(card.cost || {}).filter(k => k !== 'colorless').sort();
    return colours.length ? colours.join(' ') : 'colorless';
};

async function boot(page, touch, url) {
    await page.goto(url);
    await page.evaluate(() => { document.getElementById('clickToStart').style.display = 'none'; });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        showElementSelection(); setDeckMode('dual'); selectElement('fire'); selectElement('water'); startGame();
    });
    await page.waitForFunction(() => document.getElementById('gameContainer').style.display === 'flex');
    await page.waitForFunction(() => gameState.turn === 'player' && !isProcessingAction, null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

// A gallery of faces rendered by createCardElement, in hand form and board form
async function gallery(page, reps, onBoard) {
    await page.evaluate(({ reps, onBoard }) => {
        document.getElementById('cardGallery')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'cardGallery';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:5000;overflow:auto;padding:10px;display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;background:#120a20';
        Object.entries(reps).forEach(([key, id]) => {
            const card = { ...window.__CARD_BY_ID[id], id: Math.random() };
            const el = createCardElement(card, onBoard);
            el.dataset.rep = key;
            wrap.appendChild(el);
        });
        document.body.appendChild(wrap);
    }, { reps, onBoard });
    await page.waitForTimeout(200);
}

function readFaces(page) {
    return page.evaluate(() => [...document.querySelectorAll('#cardGallery .card')].map(el => {
        const cs = getComputedStyle(el);
        const anims = el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations === Infinity).length;
        const pseudo = ['::before', '::after'].map(p => getComputedStyle(el, p).content).filter(c => c && c !== 'none' && c !== 'normal' && c !== '""');
        return {
            rep: el.dataset.rep,
            text: el.innerText.replace(/\s+/g, ' ').trim(),
            elements: el.dataset.elements || '',
            typeMarker: !!el.querySelector('.card-type-icon') || !!pseudo.length,
            background: cs.backgroundImage + cs.backgroundColor,
            border: `${cs.borderTopColor} ${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.boxShadow}`,
            infinite: anims
        };
    }));
}

const COST_EMOJI = { fire: '🔥', water: '💧', earth: '🌍', swamp: '💀', light: '☀️', colorless: '◇' };

async function faceChecks(ctx, reps) {
    const { page, profile } = ctx;
    const cards = await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, window.__CARD_BY_ID[id]])), reps);
    await gallery(page, reps, false);
    await page.screenshot({ path: path.join(OUT, profile, '01-gallery-hand.png') });
    const faces = Object.fromEntries((await readFaces(page)).map(f => [f.rep, f]));

    const costBad = Object.entries(cards).filter(([k, c]) => c.type !== 'land').filter(([k, c]) => {
        const text = faces[k].text;
        const entries = Object.entries(c.cost || {});
        if (!entries.length) return !/(^|\s)0(\s|$)|free/i.test(text);
        return !entries.every(([el, n]) => text.includes(COST_EMOJI[el]) && new RegExp(`(^|\\D)${n}(\\D|$)`).test(text.replace(`${c.power}/${c.toughness}`, '')));
    }).map(([k]) => `${k} "${faces[k].text}"`);
    check(profile, 'faces', 'hand faces show every cost exactly (elements, colorless ◇, free = 0)', costBad.length === 0, costBad.join('; '));
    const ptBad = Object.entries(cards).filter(([, c]) => c.type === 'creature').filter(([k, c]) => !faces[k].text.includes(`${c.power}/${c.toughness}`)).map(([k]) => k);
    check(profile, 'faces', 'creatures show power/toughness', ptBad.length === 0, ptBad.join(', '));
    const idBad = Object.entries(cards).filter(([k, c]) => faces[k].elements.split(' ').sort().join(' ') !== identityOf(c)).map(([k, c]) => `${k}: "${faces[k].elements}" ≠ "${identityOf(c)}"`);
    check(profile, 'faces', 'each face carries its element identity (mono, dual, colorless, rainbow)', idBad.length === 0, idBad.slice(0, 5).join('; '));
    const els = ['fire', 'water', 'earth', 'swamp', 'light'];
    const bgs = new Set(els.map(e => faces[`creature-${e}`]?.background));
    check(profile, 'faces', 'element backgrounds differ (five creatures, five backgrounds)', bgs.size === 5, `${bgs.size} distinct`);
    const dual = cards['creature-dual'];
    const dualColours = Object.keys(dual.cost).filter(k => k !== 'colorless');
    check(profile, 'faces', `dual card (${dual.name}) differs from both of its colours`,
        dualColours.every(e => faces['creature-dual'].background !== faces[`creature-${e}`].background) && faces['creature-dual'].elements.split(' ').length === 2);
    check(profile, 'faces', 'colorless artifact and colorless land have a neutral (non-element) face',
        faces['artifact-colorless'].elements === 'colorless' && els.every(e => faces['artifact-colorless'].background !== faces[`artifact-${e}`]?.background));
    const typeBad = Object.entries(faces).filter(([k, f]) => !k.startsWith('creature') && !f.typeMarker).map(([k]) => k);
    check(profile, 'faces', 'instants, artifacts and lands carry a type marker on the face', typeBad.length === 0, typeBad.join(', '));
    const rarityBorders = new Set(['creature-fire', 'creature-rare', 'creature-epic', 'creature-legendary'].map(k => faces[k].border.split(' ').slice(0, 4).join(' ')));
    check(profile, 'rarity', 'common, rare, epic and legendary borders differ', rarityBorders.size === 4, [...rarityBorders].join(' | '));
    const animated = Object.values(faces).filter(f => f.infinite).map(f => f.rep);
    check(profile, 'rarity', 'no card face animates forever (restrained rarity)', animated.length === 0, animated.join(', '));

    await gallery(page, reps, true);
    await page.screenshot({ path: path.join(OUT, profile, '02-gallery-board.png') });
    await page.evaluate(() => document.getElementById('cardGallery')?.remove());
}

// A crowded match: stacked lands of every kind, creatures in each state, artifacts, a mixed hand
async function crowd(page, reps) {
    await page.evaluate(reps => {
        const make = (id, extra = {}) => {
            const card = { ...window.__CARD_BY_ID[id], id: Math.random(), ...extra };
            if (card.type !== 'instant') card.tapped = card.tapped ?? false;
            if (card.type === 'creature') { card.summoningSick = card.summoningSick ?? false; card.damage = card.damage ?? 0; }
            return card;
        };
        gameState.playerBoard = [
            ...['land-fire', 'land-fire', 'land-water', 'land-dual', 'land-rainbow', 'land-colorless'].map(k => make(reps[k])),
            make(reps['land-water'], { tapped: true }),
            make(reps['creature-fire'], { tapped: true }),
            make(reps['creature-water'], { summoningSick: true }),
            make(reps['creature-earth'], { damage: 1 }),
            make(reps['creature-legendary']),
            make(reps['creature-keywords']),
            make(reps['creature-flash']),
            make(reps['creature-dual']),
            make(reps['creature-epic'], { tapped: true, damage: 2 }),
            make(reps['artifact-colorless']), make(reps['artifact-fire'])
        ];
        gameState.enemyBoard = [
            ...['land-earth', 'land-earth', 'land-swamp'].map(k => make(reps[k])),
            make(reps['creature-swamp']), make(reps['creature-rare'], { tapped: true }), make(reps['creature-light'], { summoningSick: true }),
            make(reps['creature-dual'], { damage: 1 }), make(reps['artifact-light'])
        ];
        gameState.playerHand = ['land-earth', 'creature-light', 'instant-fire', 'creature-legendary', 'artifact-free', 'instant-dual', 'artifact-dual', 'creature-swamp']
            .map(k => make(reps[k]));
        gameState.landsPlayedThisTurn = 0;
        gameState.playerMana = { fire: 2, water: 1 };
        updateUI({ immediate: true });
    }, reps);
    await page.waitForTimeout(250);
}

async function stateChecks(ctx, reps) {
    const { page, profile } = ctx;
    await crowd(page, reps);
    // Attack selection on the keyword creature
    const keywordName = await page.evaluate(id => window.__CARD_BY_ID[id].name, reps['creature-keywords']);
    await page.evaluate(id => {
        enterAttackPhase();
        const card = gameState.playerBoard.find(c => c.__id === id);
        if (card) selectAttacker(card.id);
    }, reps['creature-keywords']);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, profile, '03-crowded-board.png') });
    // Crowded rows scroll sideways on small screens; show the creature end of each row too
    await page.evaluate(() => ['playerBoard', 'enemyBoard', 'playerHand'].forEach(id => { document.getElementById(id).scrollLeft = 9999; }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, profile, '03b-crowded-board-scrolled.png') });
    await page.evaluate(() => ['playerBoard', 'enemyBoard', 'playerHand'].forEach(id => { document.getElementById(id).scrollLeft = 0; }));
    await page.waitForTimeout(300);

    const states = await page.evaluate(() => {
        const describe = el => {
            if (!el) return null;
            const cs = getComputedStyle(el);
            const pseudo = ['::before', '::after'].map(p => getComputedStyle(el, p).content).filter(c => c && c !== 'none' && c !== 'normal').join(' ');
            return { transform: cs.transform, borderStyle: cs.borderTopStyle, outline: cs.outlineStyle, text: el.innerText.replace(/\s+/g, ' '), pseudo, classes: el.className };
        };
        const byState = (row, fn) => [...document.querySelectorAll(`#${row} .card`)].find(el => {
            const id = Number(el.dataset.cardId);
            const card = [...gameState.playerBoard, ...gameState.playerHand, ...gameState.enemyBoard].find(c => c.id === id);
            return card && fn(card, el);
        });
        const plain = byState('playerBoard', c => c.type === 'creature' && !c.tapped && !c.summoningSick && !c.damage && !gameState.attackers.includes(c.id));
        return {
            plain: describe(plain),
            tapped: describe(byState('playerBoard', c => c.tapped && !c.damage)),
            sick: describe(byState('playerBoard', c => c.summoningSick)),
            damaged: describe(byState('playerBoard', c => c.damage && !c.tapped)),
            attacking: describe(byState('playerBoard', c => gameState.attackers.includes(c.id))),
            enemySick: describe(byState('enemyBoard', c => c.summoningSick)),
            playable: describe(document.querySelector('#playerHand .card.playable')),
            unplayable: describe(document.querySelector('#playerHand .card.unplayable'))
        };
    });
    const nonColour = (a, b) => !!a && !!b && (a.transform !== b.transform || a.borderStyle !== b.borderStyle || a.outline !== b.outline ||
        a.pseudo !== b.pseudo || a.text !== b.text);
    check(profile, 'states', 'tapped differs from untapped by shape (rotation) or a marker', nonColour(states.tapped, states.plain), JSON.stringify(states.tapped));
    check(profile, 'states', 'summoning-sick differs by border style or a marker', nonColour(states.sick, states.plain));
    check(profile, 'states', 'damaged shows its damage as text (💔N)', /💔\s*\d/.test(states.damaged?.text || ''), states.damaged?.text);
    check(profile, 'states', 'attacking differs by position or a marker', nonColour(states.attacking, states.plain), JSON.stringify(states.attacking));
    check(profile, 'states', "enemy summoning-sick creatures are marked too", !!states.enemySick && /sick|💤/.test(`${states.enemySick.classes} ${states.enemySick.text} ${states.enemySick.pseudo}`));
    check(profile, 'states', 'playable and unplayable hand cards differ by more than colour', nonColour(states.playable, states.unplayable),
        `${JSON.stringify(states.playable)} vs ${JSON.stringify(states.unplayable)}`);

    // Flash badge on the board is visibly inactive
    const flash = await page.evaluate(() => {
        const badge = [...document.querySelectorAll('#playerBoard .ability-icon')].find(b => /^Flash/.test(b.title));
        if (!badge) return null;
        const cs = getComputedStyle(badge);
        return { title: badge.title, inactive: badge.classList.contains('is-inactive') || cs.textDecorationLine.includes('line-through') || Number(cs.opacity) < 0.8 };
    });
    check(profile, 'keywords', 'Flash badge on the board is marked inactive ("No effect yet")', !!flash && /no effect/i.test(flash.title) && flash.inactive, JSON.stringify(flash));

    const layout = await page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
        const parts = '.card-power, .card-cost, .card-abilities, .card-damage, .card-type-icon, .card-state';
        const spill = [...document.querySelectorAll('#gameContainer .card')].filter(card => {
            const cr = card.getBoundingClientRect();
            if (card.classList.contains('tapped')) return false; // rotated: its box is sideways
            return [...card.querySelectorAll(parts)].some(p => {
                const s = getComputedStyle(p);
                if (s.display === 'none' || s.visibility === 'hidden') return false;
                const pr = p.getBoundingClientRect();
                return pr.width > 0 && (pr.left < cr.left - 2 || pr.right > cr.right + 2 || pr.top < cr.top - 2 || pr.bottom > cr.bottom + 2);
            });
        }).map(card => card.getAttribute('aria-label')?.split(',')[0]);
        const tiny = [];
        document.querySelectorAll('#gameContainer .card *, #gameContainer .land-stack-card *').forEach(el => {
            if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
            const s = getComputedStyle(el);
            if (s.display === 'none') return;
            const size = parseFloat(s.fontSize);
            if (size < 10) tiny.push(`${el.className} ${size}px`);
        });
        const hand = document.querySelector('#playerHand .card').getBoundingClientRect();
        const board = document.querySelector('#playerBoard .card:not(.tapped)').getBoundingClientRect();
        const onScreen = ['endTurnBtn', 'attackBtn', 'playerLife', 'enemyLife', 'playerHand', 'playerBoard', 'enemyBoard'].filter(id => {
            const r = document.getElementById(id).getBoundingClientRect();
            return !(r.width > 0 && r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1);
        });
        return { overflowX, spill, tiny: [...new Set(tiny)], hand: [Math.round(hand.width), Math.round(hand.height)], board: [Math.round(board.width), Math.round(board.height)], offScreen: onScreen };
    });
    check(profile, 'layout', 'crowded board: no horizontal page overflow', layout.overflowX <= 1, `${layout.overflowX}px`);
    check(profile, 'layout', 'crowded board: costs, stats, badges and markers stay inside their card', layout.spill.length === 0, layout.spill.join('; '));
    check(profile, 'layout', 'card text at least 10 px', layout.tiny.length === 0, layout.tiny.slice(0, 6).join('; '));
    check(profile, 'layout', 'crowded board: controls, life totals and both rows on screen', layout.offScreen.length === 0, layout.offScreen.join(', '));
    if (profile === 'phone') {
        // No larger than the cards phones had before this pass (58×78 plus borders)
        check(profile, 'layout', `phone cards stay compact (hand ${layout.hand.join('×')}, board ${layout.board.join('×')}; at most 62×82)`,
            layout.hand[0] <= 62 && layout.hand[1] <= 82 && layout.board[0] <= 62 && layout.board[1] <= 82);
    }
    await page.evaluate(() => {
        // Leave attack selection without attacking (the game itself only leaves it through CONFIRM)
        attackPhase = false; gameState.attackers = []; gameState.phase = 'main';
        document.getElementById('phaseIndicator').textContent = 'MAIN PHASE';
        const attackBtn = document.getElementById('attackBtn');
        attackBtn.innerHTML = '<span class="btn-text">⚔️ ATTACK</span>';
        attackBtn.onclick = enterAttackPhase;
        updateUI({ immediate: true });
    });
}

async function detailChecks(ctx, reps) {
    const { page, profile } = ctx;
    const show = (rep, fromBoard) => page.evaluate(({ id, fromBoard }) => {
        const card = fromBoard
            ? gameState.playerBoard.find(c => c.__id === id && c.tapped && c.damage) || gameState.playerBoard.find(c => c.__id === id)
            : window.__CARD_BY_ID[id];
        showCardDetail(card);
        const popup = document.getElementById('cardDetailPopup');
        return { text: popup.innerText.replace(/\s+/g, ' '), badges: [...popup.querySelectorAll('.card-detail-keyword')].map(k => k.innerText.replace(/\s+/g, ' ')) };
    }, { id: reps[rep], fromBoard });
    const card = rep => page.evaluate(id => window.__CARD_BY_ID[id], reps[rep]);
    const rules = await page.evaluate(() => KEYWORD_RULES);
    const rarityName = r => r.charAt(0).toUpperCase() + r.slice(1);

    const kw = await card('creature-keywords');
    const kwDetail = await show('creature-keywords');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, profile, '04-detail-keywords.png') });
    const kwBad = kw.abilities.filter(a => !kwDetail.badges.some(b => b.includes(rules[a].badge) && b.includes(rules[a].label) && b.includes(rules[a].text)));
    check(profile, 'keywords', `details show badge, label and rules text for each keyword (${kw.name})`, kwBad.length === 0, kwBad.join(', '));
    check(profile, 'details', `creature details: type, rarity, element, cost, power/toughness (${kw.name})`,
        /creature/i.test(kwDetail.text) && kwDetail.text.includes(rarityName(kw.__rarity)) && kwDetail.text.includes(`${kw.power}/${kw.toughness}`) &&
        Object.entries(kw.cost).every(([el, n]) => kwDetail.text.includes(COST_EMOJI[el]) && kwDetail.text.includes(String(n))) &&
        Object.keys(kw.cost).every(el => new RegExp(el, 'i').test(kwDetail.text)), kwDetail.text.slice(0, 200));

    const fl = await card('creature-flash');
    const flDetail = await show('creature-flash');
    const flashLine = flDetail.badges.find(b => b.includes(rules.flash.label)) || '';
    check(profile, 'keywords', `Flash is shown with "no effect" and not as a working ability (${fl.name})`, /no effect/i.test(flashLine), flashLine);

    const dual = await card('creature-dual');
    const dualDetail = await show('creature-dual');
    check(profile, 'details', `dual card names both elements and both costs (${dual.name})`,
        Object.entries(dual.cost).every(([el, n]) => new RegExp(el, 'i').test(dualDetail.text) && dualDetail.text.includes(COST_EMOJI[el])), dualDetail.text.slice(0, 160));

    const art = await card('artifact-colorless');
    const artDetail = await show('artifact-colorless');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, profile, '05-detail-artifact.png') });
    check(profile, 'details', `colorless artifact shows a colorless cost and its rules line (${art.name})`,
        /colorless/i.test(artDetail.text) && artDetail.text.includes('◇') && artDetail.text.includes(`Rules: `), artDetail.text.slice(0, 200));

    const land = await card('land-dual');
    const landDetail = await show('land-dual');
    check(profile, 'details', `dual land shows both mana colours (${land.name})`, land.elements.every(el => landDetail.text.includes(COST_EMOJI[el])), landDetail.text.slice(0, 160));

    const boardDetail = await show('creature-epic', true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, profile, '06-detail-board-state.png') });
    check(profile, 'details', 'a board creature shows its state (tapped, damage)', /tapped/i.test(boardDetail.text) && /2 damage/i.test(boardDetail.text), boardDetail.text.slice(0, 220));
    await page.evaluate(() => hideCardDetail());
}

async function packChecks(ctx, reps) {
    const { page, profile } = ctx;
    const ids = ['creature-legendary', 'artifact-colorless', 'creature-dual', 'land-rainbow'].map(k => reps[k]);
    await page.evaluate(ids => {
        gameMeta.lastPack = { cardIds: ids, theme: 'fantasy', source: 'audit' };
        openPackOpeningOverlayFromMeta('shop');
        showPackRevealStage();
        revealCurrentPackCard();
    }, ids);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, profile, '07-pack-legendary.png') });
    const read = () => page.evaluate(() => document.getElementById('packCardViewport').innerText.replace(/\s+/g, ' '));
    const legendary = await page.evaluate(id => window.__CARD_BY_ID[id], ids[0]);
    const first = await read();
    check(profile, 'pack', `pack reveal shows rarity, type, cost and power/toughness (${legendary.name})`,
        /legendary/i.test(first) && /creature/i.test(first) && first.includes(`${legendary.power}/${legendary.toughness}`) &&
        Object.entries(legendary.cost).every(([el, n]) => first.includes(COST_EMOJI[el]) && first.includes(String(n))), first);
    await page.evaluate(() => { setPackOpeningCard(1); revealCurrentPackCard(); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, profile, '08-pack-artifact.png') });
    const second = await read();
    check(profile, 'pack', 'pack reveal shows a colorless cost as ◇', second.includes('◇'), second);
    await page.evaluate(() => closePackOpeningOverlay());
}

async function inputChecks(ctx) {
    const { page, profile, touch } = ctx;
    if (!touch) return;
    await page.waitForFunction(() => !document.getElementById('packOpeningOverlay').classList.contains('show'));
    await page.waitForTimeout(800); // the pack overlay fades out
    await page.evaluate(() => {
        gameState.landsPlayedThisTurn = 0;
        updateUI({ immediate: true });
    });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => ({ hand: gameState.playerHand.length, board: gameState.playerBoard.length }));
    const creature = page.locator('#playerHand .card:not(.land)').first();
    await creature.scrollIntoViewIfNeeded();
    const box = await creature.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(300);
    const afterPress = await page.evaluate(() => ({ hand: gameState.playerHand.length, detail: document.getElementById('cardDetailPopup').classList.contains('show') }));
    check(profile, 'input', 'long-press a hand card shows details without playing it', afterPress.detail && afterPress.hand === before.hand, JSON.stringify(afterPress));
    await page.evaluate(() => hideCardDetail());
    await page.waitForTimeout(300);
    await page.locator('#playerHand .card.land').first().tap();
    await page.waitForTimeout(400);
    const afterTap = await page.evaluate(() => ({ hand: gameState.playerHand.length, lands: gameState.landsPlayedThisTurn }));
    check(profile, 'input', 'one tap plays one land', afterTap.hand === before.hand - 1 && afterTap.lands === 1, JSON.stringify(afterTap));
}

async function auditProfile(browser, url, profile) {
    const { touch, options } = PROFILES[profile];
    console.log(`\n[${profile}] ${options.viewport.width}×${options.viewport.height}${touch ? ' touch' : ' mouse'}`);
    fs.mkdirSync(path.join(OUT, profile), { recursive: true });
    const context = await browser.newContext({ ...options });
    await context.addInitScript(seededInit);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('dialog', d => d.accept());
    const ctx = { page, profile, touch };

    await boot(page, touch, url);
    const reps = await page.evaluate(pickRepresentatives);
    await faceChecks(ctx, reps);
    await stateChecks(ctx, reps);
    await detailChecks(ctx, reps);
    await packChecks(ctx, reps);
    await inputChecks(ctx);
    check(profile, 'errors', 'no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
try {
    const only = args.profile ? [args.profile] : Object.keys(PROFILES);
    for (const profile of only) await auditProfile(browser, url, profile);
} finally {
    await browser.close();
    server.close();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'card-faces.json'), JSON.stringify({ label: LABEL, results }, null, 2));
const failed = results.filter(r => !r.ok);
const byArea = {};
results.forEach(r => { byArea[r.area] = byArea[r.area] || [0, 0]; byArea[r.area][r.ok ? 0 : 1] += 1; });
console.log('\nBy area (pass/fail):', Object.entries(byArea).map(([a, [p, f]]) => `${a} ${p}/${f}`).join(' · '));
console.log(`Summary: ${results.length - failed.length} passed · ${failed.length} failed → ${path.relative(ROOT, OUT)}/`);
if (failed.length && !args['report-only']) process.exit(1);
