import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useGameBrowser,openGame} from './lib/game.mjs';
useGameBrowser();
test('locked acquisition, legendary-only pack, and reward save rollback',async t=>{
 const page=await openGame(t);
 const r=await page.evaluate(()=>{
  showPackShop();
  const card=__CARD_BY_ID['creatures-ancient-dragon'];
  const blocked=!canAcquireCard(card)&&!getPackSlotPlan('fantasy').pool.includes(card);
  document.getElementById('singleCardSelect').value=card.__id;
  const before=gameMeta.wallet.credits;
  const denied=purchaseSingleCard()===false&&gameMeta.wallet.credits===before;
  const vault=generatePack('legendary');
  gameMeta.stats.wins=10; reportAchievement('match:end',{result:'win'});
  const available=canAcquireCard(card),count=gameMeta.collection[card.__id]||0;
  const save=metaSave;metaSave=()=>false;const failed=!claimAchievementCard('wins-10')&&(gameMeta.collection[card.__id]||0)===count;metaSave=save;
  const claimed=claimAchievementCard('wins-10'),twice=claimAchievementCard('wins-10');
  return {blocked,denied,vault:vault.map(id=>__CARD_BY_ID[id].__rarity),available,failed,claimed,twice,count,after:gameMeta.collection[card.__id],receipt:validateMeta(gameMeta).achievementRewards};
 });
 assert.ok(r.blocked);assert.ok(r.denied);assert.equal(r.vault.length,5);assert.ok(r.vault.every(x=>x==='legendary'));assert.ok(r.available);assert.ok(r.failed);assert.ok(r.claimed);assert.equal(r.twice,false);assert.equal(r.after,r.count+1);assert.deepEqual(r.receipt,['wins-10']);
 await page.reload();await page.evaluate(()=>profileReady);
 assert.equal(await page.evaluate(()=>claimAchievementCard('wins-10')),false);
});
for(const [width,height] of [[360,740],[320,568],[740,360]])test(`shop pages ${width}x${height}`,async t=>{
 const page=await openGame(t,{contextOptions:{viewport:{width,height},isMobile:true,hasTouch:true}});
 const r=await page.evaluate(()=>{document.getElementById('startModal').style.display='flex';showPackShop();shopPage=0;renderShopPage();const first=document.querySelector('.shop-pack:not([hidden])').dataset.theme;shopPage++;renderShopPage();const last=document.querySelector('.shop-pack:not([hidden])').dataset.theme;const box=document.getElementById('shopPager').getBoundingClientRect();showAchievements();return {first,last,bottom:box.bottom,vh:innerHeight,icons:document.querySelectorAll('#achievementsMenuView .ach-icon svg').length};});assert.notEqual(r.first,r.last);assert.ok(r.bottom<r.vh,JSON.stringify(r));assert.equal(r.icons,400);
});
test('card search combines deck status, quantity and color with stable sorting',async t=>{
 const page=await openGame(t);
 const r=await page.evaluate(()=>{
  showPackShop();setShopTab('cards');
  const filters=cardFilterState.shopFilters;
  Object.assign(filters,{element:'fire',deck:'in',quantity:'multiple',sort:'least'});
  renderSingleCardShop();
  const cards=[...document.getElementById('singleCardSelect').options].map(o=>__CARD_BY_ID[o.value]);
  const deck=gameMeta.decks[gameMeta.selectedDeckKey].cardIds;
  return {count:cards.length,valid:cards.every(c=>getCardIdentity(c).includes('fire')&&deck.includes(c.__id)&&gameMeta.collection[c.__id]>=2),counts:cards.map(c=>gameMeta.collection[c.__id])};
 });assert.ok(r.count>0);assert.ok(r.valid);assert.deepEqual(r.counts,[...r.counts].sort((a,b)=>a-b));
});
