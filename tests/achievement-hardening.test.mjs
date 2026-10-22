import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { useGameBrowser, openGamePage, startMatch, setup, act } from './lib/game.mjs';
useGameBrowser();
const STORE = 'emoji_elements_achievements_v1';
const counters = c => ({ [STORE]: JSON.stringify({ version:1,unlocked:{},counters:c,prefs:{notify:true} }) });
async function open(t, opts) { const s=await openGamePage(opts); t.after(s.close); await s.page.clock.pauseAt(new Date('2026-01-02')); return s.page; }
const progress = p => p.evaluate(() => ({ counters:Achievements.counters(), unlocked:Achievements.catalog.filter(d=>Achievements.isUnlocked(d.id)).map(d=>d.id) }));
const reload = async p => { await p.reload(); await p.evaluate(()=>profileReady); };

test('the 499/500 threshold advances only on a real player land tap', async t => {
    const p=await open(t,{storage:counters({landTaps:498})}); await startMatch(p);
    const tap=async()=> { await setup(p,{playerBoard:['lands-volcanic-peak']}); await act(p,()=>tapLand(gameState.playerBoard[0].id)); };
    await tap(); assert.equal(await p.evaluate(()=>Achievements.isUnlocked('taps-500')),false);
    assert.equal((await progress(p)).counters.landTaps,499);
    await p.evaluate(()=>{ __rt.setup({enemyBoard:['lands-volcanic-peak']}); aiTapManaSources(); });
    assert.equal((await progress(p)).counters.landTaps,499,'AI mana is not player progress');
    await tap(); assert.equal(await p.evaluate(()=>Achievements.isUnlocked('taps-500')),true);
    const at=await p.evaluate(()=>Achievements.unlockedAt('taps-500'));
    await reload(p); assert.equal(await p.evaluate(()=>Achievements.unlockedAt('taps-500')),at);
});

test('AI creature plays cannot satisfy the 99/100 player creature threshold', async t => {
    const p=await open(t,{storage:counters({'played.creature':99})}); await startMatch(p);
    await setup(p,{enemyHand:['creatures-fire-lobster'],enemyBoard:['lands-volcanic-peak','lands-volcanic-peak'],enemyDeck:['creatures-ember-beetle'],playerHand:[],playerBoard:[]});
    await p.evaluate(()=>endTurn()); await p.clock.runFor(14000);
    assert.ok(await p.evaluate(()=>gameState.enemyBoard.some(c=>c.type==='creature')),'AI actually played');
    assert.equal((await progress(p)).counters['played.creature'],99);
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('creatures-100')),false);
    await setup(p,{playerHand:['creatures-fire-lobster'],playerMana:{fire:20}});
    await act(p,()=>playCard(gameState.playerHand[0].id));
    assert.equal((await progress(p)).counters['played.creature'],100);
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('creatures-100')),true);
});

test('fixtures, previews, detail rendering and cosmetic effects grant no progress', async t => {
    const p=await open(t,{storage:counters({cardDetails:49})}); await startMatch(p);
    const before=await progress(p);
    await p.evaluate(()=>{
        __rt.setup({playerBoard:Array(8).fill('creatures-fire-lobster')});
        for(let i=0;i<5;i++) {
            previewCombat(gameState.playerBoard,gameState.enemyBoard,true);
            updateUI({immediate:true}); showCardDetail(gameState.playerBoard[0]); hideCardDetail();
            applyVisualTheme(['arcane','neon','deep-space'][i%3]); createParticles(10,10,'#fff',5);
        }
    });
    assert.deepEqual(await progress(p),before);
    const b=await p.locator('#playerBoard .card').first().boundingBox();
    await p.mouse.click(b.x+b.width/2,b.y+b.height/2,{button:'right'});
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('card-inspector')),true,'trusted inspection is the earning action');
});

test('winning at 9/10 unlocks once; stats/progress resets retain earned achievements and notice preference', async t => {
    const meta=JSON.parse(fs.readFileSync(new URL('./fixtures/saves/existing.json',import.meta.url),'utf8'));
    meta.stats={wins:9,losses:0,packsOpened:0};
    const p=await open(t,{storage:{emoji_elements_meta_v1:JSON.stringify(meta)}});
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('wins-10')),false);
    await startMatch(p); await p.evaluate(()=>{gameState.enemyLife=0;checkGameOver();finalizeMatch('win');Achievements.setNotify(false);});
    const at=await p.evaluate(()=>Achievements.unlockedAt('wins-10')); assert.ok(at);
    assert.equal(await p.evaluate(()=>gameMeta.stats.wins),10);
    await p.evaluate(()=>{resetStats();document.getElementById('gameConfirmYesBtn').click();resetMetaProgress();document.getElementById('gameConfirmYesBtn').click();});
    await reload(p);
    assert.equal(await p.evaluate(()=>Achievements.unlockedAt('wins-10')),at);
    assert.equal(await p.evaluate(()=>Achievements.notify),false);
    assert.equal(await p.evaluate(()=>gameMeta.stats.wins),0);
});

test('an immediate reload flushes below-threshold counters, without waiting 500 ms', async t => {
    const p=await open(t); await startMatch(p);
    await setup(p,{playerBoard:['lands-volcanic-peak']});
    await p.evaluate(()=>tapLand(gameState.playerBoard[0].id));
    await reload(p); assert.equal((await progress(p)).counters.landTaps,1);
});

test('achievement quota failure preserves its original; Retry saving persists one unlock', async t => {
    const p=await open(t); await startMatch(p);
    const before=await p.evaluate(k=>localStorage.getItem(k),STORE);
    await p.evaluate(()=>{window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='emoji_elements_achievements_v1')throw new DOMException('quota','QuotaExceededError');return window.__set.call(this,k,v);};});
    await setup(p,{playerBoard:['lands-volcanic-peak']}); await act(p,()=>tapLand(gameState.playerBoard[0].id));
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),STORE),before);
    await p.evaluate(()=>{Storage.prototype.setItem=window.__set;saveStats();saveStats();});
    await reload(p); assert.equal((await progress(p)).counters.landTaps,1);
});

test('achievement repair with a failed backup never replaces its original bytes', async t => {
    const p=await open(t,{storage:{[STORE]:'{broken'},initScript:()=>{
        const set=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){if(k==='emoji_elements_achievements_backup')throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v);};
    }});
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),STORE),'{broken');
    await p.evaluate(()=>{Achievements.flush();saveStats();});
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),STORE),'{broken');
    assert.equal(await p.evaluate(()=>Achievements.persisting),false);
});

test('a shared-profile reader cannot overwrite achievements or their preferences', async t => {
    const p=await open(t); const q=await p.context().newPage(); await q.goto(p.url());await q.evaluate(()=>profileReady);
    await p.evaluate(()=>{Achievements.setNotify(false);});
    const saved=await p.evaluate(k=>localStorage.getItem(k),STORE);
    await q.evaluate(()=>{Achievements.setNotify(true);Achievements.emit('card:details',{});Achievements.flush();});
    assert.equal(await p.evaluate(k=>localStorage.getItem(k),STORE),saved);
});

test('QA and runtime QA fixtures never grant or persist achievements', async t => {
    const qa=await open(t,{storage:{emojiElementsQA:'1'}});await startMatch(qa);
    await qa.evaluate(()=>{gameState.enemyLife=0;checkGameOver();Achievements.flush();});
    assert.equal(await qa.evaluate(()=>Achievements.unlockedCount()),0);
    assert.equal(await qa.evaluate(k=>localStorage.getItem(k),STORE),null);
    assert.equal(await qa.evaluate(()=>localStorage.getItem('emoji_elements_meta_v1')),null,'QA payouts never alter the real profile');
    await qa.evaluate(()=>localStorage.removeItem('emojiElementsQA')); await reload(qa);
    assert.equal(await qa.evaluate(()=>gameMeta.stats.wins),0,'QA wins cannot be backfilled into real achievements');
    assert.equal(await qa.evaluate(()=>Achievements.isUnlocked('first-win')),false);
    const normal=await open(t);await startMatch(normal);const before=await progress(normal);
    await normal.evaluate(()=>{window.__QA_FORCE_META_OFF=true;gameState.enemyLife=0;checkGameOver();Achievements.emit('card:details',{});});
    assert.deepEqual(await progress(normal),before);
    await normal.evaluate(()=>{window.__QA_FORCE_META_OFF=false;saveStats();});
    await reload(normal);assert.equal(await normal.evaluate(()=>Achievements.isUnlocked('first-win')),false);
});

test('malformed counters cannot fabricate thresholds; unrecognised versions stay byte-for-byte read-only', async t => {
    const p=await open(t,{storage:counters({streak:'many',landTaps:'Infinity',cardDetails:-5,themes:['arcane','arcane','invented']})});
    const c=(await progress(p)).counters;
    assert.equal(c.streak,0); assert.equal(c.landTaps,0); assert.equal(c.cardDetails,0);
    assert.deepEqual(c.themes,['arcane']);
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('decorator')),false);
    for(const version of ['future',2,-1]) {
        const original=JSON.stringify({version,unlocked:{},counters:{landTaps:7},prefs:{notify:false},future:'keep'});
        const q=await open(t,{storage:{[STORE]:original}});
        await q.evaluate(()=>{Achievements.setNotify(true);Achievements.flush();});
        assert.equal(await q.evaluate(k=>localStorage.getItem(k),STORE),original);
        assert.equal(await q.evaluate(()=>Achievements.persisting),false);
    }
});

test('failed purchases grant no spending progress; same-clock acquisitions and reloads count once', async t => {
    const p=await open(t,{storage:counters({creditsSpent:980})});
    await p.evaluate(()=>{window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='emoji_elements_meta_v1')throw new DOMException('quota','QuotaExceededError');return window.__set.call(this,k,v);};});
    assert.equal((await p.evaluate(()=>purchasePack('lands'))).ok,false);
    assert.equal((await progress(p)).counters.creditsSpent,980);
    assert.equal(await p.evaluate(()=>Achievements.isUnlocked('big-spender')),false);
    await p.evaluate(()=>{Storage.prototype.setItem=window.__set;purchasePack('lands');closePackOpeningOverlay();});
    const first=await p.evaluate(()=>({...gameMeta.lastPack}));
    await p.evaluate(()=>{purchasePack('robot');closePackOpeningOverlay();});
    const second=await p.evaluate(()=>({...gameMeta.lastPack}));
    assert.equal(first.openedAt,second.openedAt,'two acquisitions deliberately share a stopped clock');
    assert.notEqual(first.acquisitionId,second.acquisitionId);
    assert.equal((await progress(p)).counters.creditsSpent,1080);
    assert.deepEqual((await progress(p)).counters.packTypes,['lands','robot']);
    const before=await progress(p);await reload(p);
    await p.evaluate(()=>{openPackOpeningOverlayFromMeta('shop');closePackOpeningOverlay();openPackOpeningOverlayFromMeta('shop');closePackOpeningOverlay();});
    assert.deepEqual(await progress(p),before,'reopening the saved pack is presentation only');
});
