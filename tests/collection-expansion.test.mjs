import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useGameBrowser,openGame,startMatch} from './lib/game.mjs';
useGameBrowser();
test('binder pages and individual purchases preserve wallet and collection',async t=>{
 const page=await openGame(t,{contextOptions:{viewport:{width:360,height:740},isMobile:true,hasTouch:true}});
 const r=await page.evaluate(()=>{
  document.getElementById('startModal').style.display='flex'; showBinder();
  const before=[...document.querySelectorAll('#binderList .binder-row:not([hidden])')].map(x=>x.dataset.cardId);
  document.querySelector('#binderPager button:last-child').click();
  const after=[...document.querySelectorAll('#binderList .binder-row:not([hidden])')].map(x=>x.dataset.cardId);
  showPackShop(); renderSingleCardShop();
  const id=document.getElementById('singleCardSelect').value, card=__CARD_BY_ID[id],price=singleCardPrice(card),credits=getShopCredits(),owned=gameMeta.collection[id]||0;
  const bought=purchaseSingleCard();
  const balance=getShopCredits(),copies=gameMeta.collection[id];
  const save=metaSave;metaSave=()=>false;const failed=purchaseSingleCard();metaSave=save;
  return {before,after,bought,credits,price,balance,owned,copies,failed,rollback:getShopCredits()===balance&&gameMeta.collection[id]===copies,packs:PACK_THEMES.map(p=>({key:p.key,size:getThemePool(p.key).length,pack:generatePack(p.key)}))};
 });
 assert.equal(r.before.length,4);assert.notDeepEqual(r.before,r.after);assert.equal(r.bought,true);assert.equal(r.balance,r.credits-r.price);assert.equal(r.copies,r.owned+1);assert.equal(r.failed,false);assert.equal(r.rollback,true);
 assert.equal(r.packs.length,12);for(const p of r.packs){assert.ok(p.size>=5,p.key);assert.equal(p.pack.length,5,p.key);assert.equal(new Set(p.pack).size,5,p.key);}
});
test('lead messages follow life thresholds without repeating on each render',async t=>{
 const page=await openGame(t);await startMatch(page);
 assert.deepEqual(await page.evaluate(()=>{
 gameState.playerLife=30;gameState.enemyLife=20;updateBattleMusicMood();const won=document.getElementById('leadNotice').textContent;
 battleMusicPending=null;gameState.playerLife=10;updateBattleMusicMood();return [won,document.getElementById('leadNotice').textContent];
 }),['GAINED THE LEAD','LOSING']);
});
test('all 250 new achievement progress predicates honor their thresholds',async t=>{
 const page=await openGame(t);
 const result=await page.evaluate(()=>Achievements.catalog.slice(150).map(a=>{
  const x={wins:a.goal-1,c:new Proxy({},{get:()=>a.goal-1})};const before=a.progress(x);x.wins=a.goal;x.c=new Proxy({},{get:()=>a.goal});return before<a.goal&&a.progress(x)>=a.goal;
 }));assert.equal(result.length,250);assert.ok(result.every(Boolean));
});
