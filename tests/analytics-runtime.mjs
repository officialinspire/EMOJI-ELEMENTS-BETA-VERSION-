import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const pending = [], events = [], id = '33333333-3333-4333-8333-333333333333';
const element = () => ({ style: { display: 'flex' }, classList: { add(){}, remove(){} } });
const elements = new Map();
const box = { navigator: {}, crypto: webcrypto, URL, URLSearchParams, Date, Math,
 location: { href: `https://example.test/EMOJI-ELEMENTS-BETA-VERSION-/?utm_source=newsletter#inspire_launch_id=${id}&inspire_launch_at=${Date.now()}` },
 sessionStorage: { getItem(){return null}, setItem(){} }, history: { replaceState(){} },
 document: {getElementById(key){if(!elements.has(key))elements.set(key,element());return elements.get(key)}},
 setTimeout(fn){pending.push(fn)}, addEventListener(){},
 fetch(_url, options){events.push(JSON.parse(options.body));return Promise.resolve({ok:true})},
 isStartingGame: false, gameState: {selectedElements: [], difficulty: 'medium'},
 getRequiredElementCount:()=>1, isMetaRuntimeEnabled:()=>false,
 createPlayerDeck:()=>[1,2,3], generateDeck:()=>[1,2,3], gameplayRandom:()=>0,
 ELEMENTS:{fire:{}}, getDeckKeyFromElements:()=> 'fire', matchDelay(fn){box.finishStart=fn},
};
for (const fn of ['showGameLog','cancelMatchWork','clearMatchPause','resetAiActivityMarks','playSFX','resetMatchHistory','recordHistory','shuffleDeck','drawCard','fadeMatchScene','transitionToGameplayMusic','releaseProcessingLock','setAttackControls','updateUI','updateDeckCounters','reportAchievement'])box[fn]=()=>{};
box.window=box;vm.createContext(box);
vm.runInContext(fs.readFileSync(new URL('../analytics.js',import.meta.url),'utf8'),box);
box.EmojiAnalytics.initAnalytics();while(pending.length)pending.shift()();
assert.equal(events.length,1);assert.equal(events[0].event,'game_opened');
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const start=source.indexOf('    function startGame() {');
const end=source.indexOf('\n    function ',start+10);
vm.runInContext(source.slice(start,end),box);
box.startGame();while(pending.length)pending.shift()();assert.equal(events.length,1,'invalid setup never starts');
box.gameState.selectedElements=['fire'];box.startGame();box.startGame();while(pending.length)pending.shift()();
const starts=events.filter(e=>e.event==='game_started');assert.equal(starts.length,1,'double start guarded');
assert.equal(starts[0].properties.launch_id,id);assert.equal(starts[0].properties.utm_source,'newsletter');
assert.equal(starts[0].properties.game_id,'EMOJI-ELEMENTS-BETA-VERSION-');
box.navigator.webdriver=true;box.finishStart();box.startGame();while(pending.length)pending.shift()();assert.equal(events.filter(e=>e.event==='game_started').length,1,'browser automation excluded');
box.navigator.webdriver=false;box.navigator.globalPrivacyControl=true;box.finishStart();box.startGame();while(pending.length)pending.shift()();assert.equal(events.filter(e=>e.event==='game_started').length,1,'privacy signal respected');
console.log('PASS real battle-start lifecycle: invalid setup, valid battle, duplicate guard, launch attribution, privacy');
