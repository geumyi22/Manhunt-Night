import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createExpansion} from '../BP/scripts/expansion.js';
import {createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS,nearbyHunters,wildRespawnBudget,wildRespawnsRemaining,hunterKilledRunner} from '../BP/scripts/runner.js';
import {createRunnerSpecial} from '../BP/scripts/runner-special.js';
import {createSummon} from '../BP/scripts/summon.js';
import {createTrackerCrafting} from '../BP/scripts/tracker-crafting.js';
import {createTrackerDisplay,TRACKER_NAME} from '../BP/scripts/tracker-display.js';
import * as core from '../BP/scripts/core.js';

// The pre-1.5 tests exercise the explicitly retained legacy compass mode and 3-life setting.
// Fresh-world 1.5 tests below pass fresh=true and use the new random-crafting defaults.
function harness(saved,fresh=false){
 const signals={},tasks=[],intervals=[],commands=new Map(),messages=[],formResponses=[],shownForms=[];let tick=0;
 const event=(name)=>signals[name]??=( {handlers:[],subscribe(fn){this.handlers.push(fn);},emit(e){this.handlers.forEach(fn=>fn(e));}} );
 const events=new Proxy({}, {get:(_,key)=>event(key)});
 const dropped=[];const dims=new Map(['overworld','nether','the_end'].map(n=>['minecraft:'+n,{id:'minecraft:'+n,heightRange:{min:-64,max:320},runCommand(){},getBlock:loc=>loc.y===64?{typeId:'minecraft:stone',isAir:false,isWaterlogged:false}:{typeId:'minecraft:air',isAir:true,isWaterlogged:false},spawnItem(item){dropped.push(item);}}]));
 class ItemStack{constructor(typeId,amount=1){this.typeId=typeId;this.amount=amount;}setLore(v){this.lore=v;}getLore(){return this.lore??[];}clone(){const copy=new ItemStack(this.typeId,this.amount);Object.assign(copy,structuredClone({...this}));return copy;}getComponent(){return undefined;}getDynamicProperty(k){return this.props?.[k];}setDynamicProperty(k,v){(this.props??={})[k]=v;}getDynamicPropertyIds(){return Object.keys(this.props??{});}}
 class Player{
  constructor(name){this.camera={clear(){},setCamera(){}};this.name=name;this.id=name;this.typeId='minecraft:player';this.dimension=dims.get('minecraft:overworld');this.location={x:0,y:65,z:0};this.selectedSlotIndex=0;this.isSneaking=false;this.isValid=true;this.effects=[];this.slots=Array(36);this.health=20;this.inputPermissions={setPermissionCategory:(_,v)=>this.moving=v};this.onScreenDisplay={setTitle:(t)=>this.title=t,setActionBar:(t)=>this.hud=t};const self=this;this.inv={size:36,get emptySlotsCount(){return self.slots.filter(x=>x).length===36?0:36-self.slots.filter(x=>x).length;},getItem:i=>self.slots[i],setItem:(i,v)=>self.slots[i]=v,clearAll:()=>self.slots=Array(36),addItem:v=>{const slot=self.slots.findIndex(x=>!x);if(slot<0)return v;self.slots[slot]=v;return undefined;}};}
  getComponent(n){const p=this;return n==='minecraft:inventory'?{container:this.inv}:n==='minecraft:health'?{get currentValue(){return p.health;},get effectiveMax(){return 20+(p.getEffect('health_boost')?4*(p.getEffect('health_boost').amplifier+1):0);},setCurrentValue:v=>p.health=v}:n==='minecraft:equippable'?{setEquipment(slot,item){p.equipment??={};p.equipment[slot]=item;},getEquipment(slot){return p.equipment?.[slot];}}:undefined;}
  getGameMode(){return this.mode;}getEffects(){return this.effects;}getEffect(id){return this.effects.find(e=>e.typeId===id);}removeEffect(id){this.effects=this.effects.filter(e=>e.typeId!==id);if(id==='health_boost')this.health=Math.min(20,this.health);}addEffect(id,duration,opts){this.effects=this.effects.filter(e=>e.typeId!==id);this.effects.push({typeId:id,duration,amplifier:opts?.amplifier??0});}
  getDynamicProperty(k){return this.props?.[k];}setDynamicProperty(k,v){(this.props??={})[k]=v;}
  extinguishFire(){}resetLevel(){}setGameMode(m){this.mode=m;}teleport(p,o){this.location={...p};if(o?.dimension)this.dimension=o.dimension;}tryTeleport(p,o){if(this.teleportFailure)return false;this.teleport(p,o);(this.summonMoves??=[]).push({...p});return true;}setSpawnPoint(p){this.spawn=p;}sendMessage(m){messages.push(m);(this.messages??=[]).push(m);}playSound(){}getRotation(){return {x:0,y:this.yaw??0};}
 }
 const people=['Runner','Hunter1','Hunter2'].map(n=>new Player(n));
 let state=saved??{...core.newState(),...(fresh?{}:{config:core.normalizeConfig({grace:60,food:8,friendlyFire:false,keepInventory:false,trackerDelayMinutes:15},true)}),host:'Runner',choice:'Runner',start:{x:10,y:65,z:10},lobby:{x:10,y:305,z:10}};
 let data=JSON.stringify(state);
 const world={getAllPlayers:()=>people,getDimension:n=>dims.get(n.startsWith('minecraft:')?n:'minecraft:'+n),getDynamicProperty:()=>data,setDynamicProperty:(_,v)=>data=v,gameRules:{},setDefaultSpawnLocation(){},setTimeOfDay(){},sendMessage:m=>messages.push(m),afterEvents:events,beforeEvents:events};
 const system={get currentTick(){return tick;},beforeEvents:events,run:fn=>tasks.push(fn),runTimeout:fn=>tasks.push(fn),runInterval:(fn,ticks)=>intervals.push({fn,ticks}),clearRun(){},runJob:gen=>{for(const _ of gen){}}};
 class Form{constructor(){this.buttons=[];}title(text){this.titleText=text;return this;}body(text){this.bodyText=text;return this;}button(text){this.buttons.push(text);return this;}button1(text){this.buttons[0]=text;return this;}button2(text){this.buttons[1]=text;return this;}slider(){return this;}toggle(){return this;}dropdown(){return this;}textField(){return this;}show(player){shownForms.push({player:player.name,title:this.titleText,body:this.bodyText,buttons:[...this.buttons]});const response=formResponses.shift()??{canceled:true};return Promise.resolve(typeof response==='function'?response():response);}}
 const context={...core,createExpansion,createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS,wildRespawnBudget,wildRespawnsRemaining,hunterKilledRunner,createRunnerSpecial,createSummon,createTrackerCrafting,createTrackerDisplay,TRACKER_NAME,world,system,Player,ItemStack,ItemLockMode:{inventory:'inventory'},GameMode:{Adventure:'adventure',Survival:'survival',Spectator:'spectator'},InputPermissionCategory:{Movement:'move'},CommandPermissionLevel:{Any:0,Host:3},CustomCommandStatus:{Success:0,Failure:1},EquipmentSlot:{Head:'head',Chest:'chest',Legs:'legs',Feet:'feet',Offhand:'offhand'},console,ActionFormData:Form,ModalFormData:Form,MessageFormData:Form};
 const text=fs.readFileSync(new URL('../BP/scripts/main.js',import.meta.url),'utf8').replace(/import[\s\S]*?from ['"][^'"]+['"];\r?\n/g,'');
 vm.runInNewContext(text+'\nglobalThis.testApi={startRound,pause,resume,reset,initializePlayer,settings,settingsSection,extraSettings,diagnostics,showMenu,recoverSummon,runnerRules,runnerSpecial,trackerCraft,trackerDisplay,summon,getState:()=>s,getErrors:()=>lastErrors};',context);
 const components=new Map();event('startup').emit({itemComponentRegistry:{registerCustomComponent:(id,handler)=>components.set(id,handler)},customCommandRegistry:{registerCommand:(d,f)=>commands.set(d.name,{d,f})}});event('worldLoad').emit({});
 const flush=()=>{while(tasks.length)tasks.shift()();};
 const second=()=>{tick+=20;intervals.filter(x=>x.ticks===20).forEach(x=>x.fn());flush();};
 const hudTick=()=>{tick+=5;intervals.filter(x=>x.ticks===5).forEach(x=>x.fn());flush();};
 const displayTick=()=>{tick+=2;intervals.filter(x=>x.ticks===2).forEach(x=>x.fn());flush();};
 return {api:context.testApi,people,Player,ItemStack,world,signals,dims,event,flush,second,hudTick,displayTick,commands,components,messages,formResponses,shownForms,dropped,get saved(){return JSON.parse(data);}};
}
test('full 3-player flow: permissions, countdown, grace, tracking, damage, reconnect, victory, reset',()=>{
 const h=harness(),[r,a,b]=h.people;
 h.api.startRound(a);assert.equal(h.api.getState().phase,'lobby');
 h.api.startRound(r);assert.equal(h.api.getState().phase,'countdown');assert.equal(a.moving,false);assert.equal(h.world.gameRules.spawnRadius,0);
 for(let i=0;i<5;i++)h.second();assert.equal(h.api.getState().phase,'grace');assert.equal(r.location.y,65);assert.equal(a.location.y,305);
 const protect={hurtEntity:a,damageSource:{damagingEntity:r},cancel:false};h.event('entityHurt').emit(protect);assert.equal(protect.cancel,true);
 for(let i=0;i<60;i++)h.second();assert.equal(h.api.getState().phase,'running');assert.equal(a.location.y,65);assert.equal(a.moving,true);
 const team={hurtEntity:a,damageSource:{damagingEntity:b},cancel:false};h.event('entityHurt').emit(team);assert.equal(team.cancel,true);
 const enemy={hurtEntity:r,damageSource:{damagingEntity:b},cancel:false};h.event('entityHurt').emit(enemy);assert.equal(enemy.cancel,false);
 h.event('playerDimensionChange').emit({player:r,fromDimension:r.dimension,toDimension:h.dims.get('minecraft:nether'),fromLocation:{x:80,y:64,z:160},toLocation:{x:10,y:65,z:20}});
 assert.equal(h.saved.routes['minecraft:overworld'].x,80);
 const visitor=new h.Player('Visitor');h.people.push(visitor);h.api.initializePlayer(visitor);assert.equal(visitor.mode,'spectator');h.people.pop();
 h.people.pop();h.event('playerLeave').emit({playerName:b.name,playerId:b.id});assert.equal(h.saved.phase,'paused');const t=h.saved.seconds;h.second();assert.equal(h.saved.seconds,t);
 h.api.resume(r);assert.equal(h.saved.phase,'paused');h.people.push(b);h.api.initializePlayer(b);h.api.resume(r);assert.equal(h.saved.phase,'running');
 a.spawn={x:91,y:70,z:84,dimension:h.dims.get('minecraft:overworld')};a.slots=Array(36);h.event('playerSpawn').emit({player:a,initialSpawn:false});h.flush();assert.ok(!a.slots.some(i=>i?.typeId.startsWith('mh:tracker_')),'tracker must not respawn early');assert.equal(a.spawn.x,91,'bed spawn must not be overwritten on respawn');
 while(h.saved.seconds<900)h.second();assert.ok(!a.slots.some(i=>i?.typeId.startsWith('mh:tracker_')),'hunter must craft rather than receive a free tracker');
 a.slots[0]={typeId:'minecraft:compass',amount:1};h.hudTick();assert.ok(a.slots[0]?.typeId.startsWith('mh:tracker_'),'crafted compass activates after unlock');
 r.health=0;h.event('entityDie').emit({deadEntity:r,damageSource:{damagingEntity:a}});h.flush();assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.wins.Hunter1,1);assert.equal(r.health,0,'dead players must not be healed before engine respawn');
 r.health=20;h.event('playerSpawn').emit({player:r,initialSpawn:false});h.flush();assert.equal(r.location.y,305);
 h.api.reset(r);assert.equal(h.saved.phase,'lobby');assert.equal(h.saved.roster.length,0);assert.equal(r.location.y,305);assert.equal(h.api.getErrors().size,0);
});
test('same-tick player kill outranks dragon event and awards no runner win',()=>{const h=harness(),r=h.people[0];h.api.startRound(r);for(let i=0;i<65;i++)h.second();r.dimension=h.dims.get('minecraft:the_end');h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:r.dimension}});h.event('entityDie').emit({deadEntity:r,damageSource:{damagingEntity:h.people[1]}});h.flush();assert.equal(h.saved.result,'헌터 승리');});
test('dragon death awards the surviving runner even across dimensions, then blocks a reused-dragon world',()=>{const h=harness(),r=h.people[0];h.api.startRound(r);for(let i=0;i<65;i++)h.second();const dragon={typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')};h.event('entityDie').emit({deadEntity:dragon});h.flush();assert.equal(h.saved.result,'러너 승리');assert.equal(h.saved.wins.Runner,1);h.api.reset(r);h.api.startRound(r);assert.equal(h.saved.phase,'lobby');});
test('save/reload pauses an active round and restores its roster and clock',()=>{const h=harness();h.api.startRound(h.people[0]);for(let i=0;i<17;i++)h.second();const resumed=harness(h.saved);assert.equal(resumed.saved.phase,'paused');assert.equal(resumed.saved.previous,'grace');assert.equal(resumed.saved.remaining,h.saved.remaining);assert.equal(resumed.people[0].moving,false);resumed.api.resume(resumed.people[0]);assert.equal(resumed.saved.phase,'grace');});

function started(grace=0){const h=harness();h.api.getState().config.grace=grace;h.api.startRound(h.people[0]);for(let i=0;i<5;i++)h.second();return h;}
function die(h,source={cause:'fall'}){const r=h.people[0];r.health=0;r.effects=[];h.event('entityDie').emit({deadEntity:r,damageSource:source});h.flush();}
function respawn(h){const r=h.people[0];r.health=20;h.event('playerSpawn').emit({player:r,initialSpawn:false});h.flush();}
test('runner has 40 HP, grace V/I/I, clean transition to passive I without automatic healing',()=>{
 const h=started(15),r=h.people[0],amp=id=>r.getEffect(id)?.amplifier;
 assert.equal(r.health,40);assert.equal(amp('health_boost'),4);assert.equal(amp('saturation'),4);assert.equal(amp('regeneration'),0);assert.equal(amp('slow_falling'),0);
 r.health=27;h.second();assert.equal(r.health,27,'passive refresh must not refill health');
 h.api.pause('test');assert.equal(amp('regeneration'),undefined);assert.equal(amp('saturation'),0);h.api.resume(r);assert.equal(amp('saturation'),4);
 for(let i=0;i<14;i++)h.second();assert.equal(h.saved.phase,'running');assert.equal(r.health,27);assert.equal(amp('health_boost'),4);assert.equal(amp('saturation'),0);assert.equal(amp('regeneration'),undefined);assert.equal(amp('slow_falling'),undefined);
 h.api.reset(r);assert.equal(amp('health_boost'),undefined);assert.equal(r.health,20);
});
test('exactly three environmental respawns refill both rows, fourth death ends match',()=>{
 const h=started(),r=h.people[0];
 for(let n=1;n<=3;n++){die(h,{cause:['fall','entityAttack','starve'][n-1],damagingEntity:n===2?{typeId:'minecraft:zombie',getComponent(){}}:undefined});assert.equal(h.saved.phase,'running');assert.equal(h.saved.runnerRespawns,n);assert.equal(r.health,0);h.event('entityDie').emit({deadEntity:r});assert.equal(h.api.getState().runnerRespawns,n,'duplicate event ignored');respawn(h);assert.equal(r.health,40);assert.equal(h.saved.runnerRespawning,false);}
 die(h);assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.runnerRespawns,3);assert.equal(h.saved.wins.Hunter1,1);respawn(h);assert.equal(r.health,20);assert.equal(r.location.y,305);
});
test('player melee and player-owned projectile are immediately fatal',()=>{
 for(const projectile of [false,true]){const h=started(),a=h.people[1];die(h,projectile?{damagingProjectile:{typeId:'minecraft:arrow',getComponent:()=>({owner:a})}}:{damagingEntity:a});assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.runnerRespawns,0);}
});
test('respawn during grace restores grace effects without restarting countdown',()=>{
 const h=started(60);for(let i=0;i<11;i++)h.second();die(h);const remaining=h.saved.remaining;respawn(h);assert.equal(h.saved.phase,'grace');assert.equal(h.saved.remaining,remaining);assert.equal(h.people[0].health,40);assert.equal(h.people[0].getEffect('saturation').amplifier,4);
});
test('save/reload preserves respawns and pending respawn completion',()=>{
 const h=started();die(h);respawn(h);die(h);const reload=harness(h.saved),r=reload.people[0];assert.equal(reload.saved.runnerRespawns,2);assert.equal(reload.saved.phase,'paused');reload.event('playerSpawn').emit({player:r,initialSpawn:true});reload.flush();assert.equal(r.health,40);assert.equal(reload.saved.runnerRespawning,false);reload.api.resume(r);assert.equal(reload.saved.runnerRespawns,2);
});
test('environmental death plus dragon waits for completed respawn before winning',()=>{
 for(const dragonFirst of [true,false]){const h=started(),event=()=>h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')}});if(dragonFirst)event();die(h);if(!dragonFirst)event();h.flush();assert.equal(h.saved.phase,'running');assert.equal(h.saved.pendingRunnerVictory,true);respawn(h);assert.equal(h.saved.result,'러너 승리');assert.equal(h.saved.wins.Runner,1);}
});
test('inventory toggle persists, applies to game rule and survives active/reload transitions',async()=>{
 const h=harness(),r=h.people[0];assert.equal(h.world.gameRules.keepInventory,false);h.formResponses.push({canceled:false,formValues:[30,4,false,true,true,true,true]});await h.api.settingsSection(r,0);assert.equal(h.saved.config.keepInventory,true);h.api.startRound(r);assert.equal(h.world.gameRules.keepInventory,true);const restored=harness(h.saved);assert.equal(restored.world.gameRules.keepInventory,true);
 const old={...core.newState(),host:'Runner',start:{x:10,y:65,z:10},lobby:{x:10,y:305,z:10}};delete old.config.keepInventory;const legacy=harness(old);assert.equal(legacy.api.getState().config.keepInventory,false);assert.equal(legacy.api.getErrors().size,0);
});
test('integrated proximity warning is private, includes exact outer threshold, excludes invalid hunters and suppresses repeat presence',()=>{
 const h=started(),[r,a,b]=h.people;h.api.runnerRules.clearAll();r.messages=[];a.messages=[];r.location={x:0,y:70,z:0};a.location={x:0,y:160,z:0};b.location={x:0,y:160.01,z:0};const outsider=new h.Player('Outsider');outsider.location={...r.location};h.people.push(outsider);
 assert.deepEqual(nearbyHunters(h.api.getState(),r,h.people,()=>false).map(p=>p.name),[a.name]);a.dimension=h.dims.get('minecraft:nether');assert.equal(nearbyHunters(h.api.getState(),r,h.people,()=>false).length,0);a.dimension=r.dimension;assert.equal(nearbyHunters(h.api.getState(),r,h.people,p=>p===a).length,0);
 const warnings=p=>(p.messages??[]).filter(m=>m.includes('기척')).length;h.api.runnerRules.tick();assert.equal(warnings(r),1);assert.equal(warnings(a),0);h.api.runnerRules.tick();assert.equal(warnings(r),1);h.people.pop();for(let i=0;i<10;i++)h.second();h.api.runnerRules.tick();assert.equal(warnings(r),1,'remaining inside does not repeat entry');a.location.y=170;b.location.y=170;h.api.runnerRules.tick();a.location.y=160;h.api.runnerRules.tick();assert.equal(warnings(r),2);
});
test('zero grace never adds grace effects; reconnect preserves damage; role change removes owned effects',()=>{
 const h=started(),r=h.people[0];assert.equal(r.getEffect('regeneration'),undefined);r.health=13;h.api.initializePlayer(r);h.flush();assert.equal(r.health,13);r.addEffect('speed',100,{amplifier:1});h.api.getState().runner=h.people[1].name;h.api.runnerRules.sync(r);assert.equal(r.getEffect('health_boost'),undefined);assert.equal(r.getEffect('speed').amplifier,1);
});

test('v1.2.1 menu is unlocked, may be discarded, stays gone, and /mh:item reissues at most one',()=>{
 const h=harness(),p=h.people[0];h.api.initializePlayer(p);
 const menus=()=>p.slots.filter(i=>i?.typeId==='mh:menu');
 assert.equal(menus().length,1);
 assert.equal(menus()[0].keepOnDeath,undefined,'menu is not forced to survive death');
 assert.equal(menus()[0].lockMode,undefined,'menu must not be inventory-locked');
 const slot=p.slots.findIndex(i=>i?.typeId==='mh:menu');p.slots[slot]=undefined;
 for(let i=0;i<10;i++)h.second();
 assert.equal(menus().length,0,'dropping menu does not invoke periodic auto-give');
 assert.ok(h.commands.has('mh:item'));
 h.commands.get('mh:item').f({sourceEntity:p});h.flush();
 assert.equal(menus().length,1,'manual command supplies one');
 h.commands.get('mh:item').f({sourceEntity:p});h.flush();
 assert.equal(menus().length,1,'manual command must be idempotent');
 assert.equal(h.api.getErrors().size,0);
});

test('v1.2.1 legacy locked menus are migrated, duplicate copies removed, other items untouched',()=>{
 const h=harness(),p=h.people[0];h.api.initializePlayer(p);
 const menu=p.slots.find(i=>i?.typeId==='mh:menu');
 assert.ok(menu);menu.keepOnDeath=true;menu.lockMode='inventory';
 p.slots[22]={typeId:'mh:menu',amount:1,lockMode:'inventory',keepOnDeath:true};
 p.slots[23]={typeId:'minecraft:diamond',amount:3};
 h.second();
 const menus=p.slots.filter(i=>i?.typeId==='mh:menu');
 assert.equal(menus.length,1);
 assert.equal(menus[0].keepOnDeath,undefined);
 assert.equal(menus[0].lockMode,undefined);
 assert.equal(p.slots[23].typeId,'minecraft:diamond');
 assert.equal(p.slots[23].amount,3);
 assert.equal(h.api.getErrors().size,0);
});

test('v1.2.1 manual menu command protects a full inventory without ejecting valuables',()=>{
 const h=harness(),p=h.people[0];
 p.slots=Array.from({length:36},()=>({typeId:'minecraft:diamond',amount:64}));
 h.commands.get('mh:item').f({sourceEntity:p});h.flush();
 assert.equal(p.slots.filter(i=>i?.typeId==='mh:menu').length,0);
 assert.equal(p.slots.filter(i=>i?.typeId==='minecraft:diamond').length,36);
 assert.ok(p.messages.some(m=>m.includes('빈 칸')));
});


test('v1.3.0 no free compass: 14:59 locked; 15:00 enables held crafted vanilla compass only',()=>{
 const h=started(60),[r,a,b]=h.people;
 const trackers=p=>p.slots.filter(i=>i?.typeId?.startsWith('mh:tracker_'));
 assert.equal(h.saved.phase,'grace');assert.equal(trackers(a).length,0);
 a.slots[1]={typeId:'mh:tracker_3',amount:1};h.second();assert.equal(trackers(a).length,1,'existing early item is preserved but unusable');a.selectedSlotIndex=1;h.hudTick();assert.doesNotMatch(a.hud,/러너 §f|마지막 이동 지점/);a.slots[1]=undefined;a.selectedSlotIndex=0;
 // Crafting a normal vanilla compass does not reveal the runner early.
 a.slots[0]={typeId:'minecraft:compass',amount:1};h.hudTick();assert.equal(a.slots[0].typeId,'minecraft:compass');
 assert.doesNotMatch(a.hud,/러너 §f|마지막 이동 지점/);
 while(h.saved.seconds<899)h.second();h.hudTick();assert.match(a.hud,/00:01/);
 assert.equal(h.saved.seconds,899);assert.equal(trackers(a).length,0);
 h.second();assert.equal(h.saved.seconds,900);
 assert.equal(trackers(a).length,0);assert.equal(trackers(b).length,0,'no auto item for any hunter');
 const notices=()=>h.messages.filter(x=>x.includes('추적 해금!')&&x.includes('나침반')).length;
 assert.equal(notices(),1);for(let i=0;i<20;i++)h.second();assert.equal(notices(),1);
 h.hudTick();assert.equal(trackers(a).length,1);assert.equal(a.slots[0].keepOnDeath,undefined);assert.equal(a.slots[0].lockMode,undefined);
 h.hudTick();assert.equal(trackers(a).length,1,'no duplicates from HUD refresh');
 a.slots=Array(36);h.event('playerSpawn').emit({player:a,initialSpawn:false});h.flush();assert.equal(trackers(a).length,0,'dead hunters must craft again');
 assert.equal(h.api.getErrors().size,0);
});

test('v1.3.0 pause/reload freezes unlock and does not grant or convert compasses early',()=>{
 const h=started(0),[r,a]=h.people;
 a.slots[0]={typeId:'minecraft:compass',amount:1};
 for(let i=0;i<80;i++)h.second();
 const mark=h.saved.seconds;h.api.pause('stop');for(let i=0;i<60;i++)h.second();
 assert.equal(h.saved.seconds,mark);h.hudTick();assert.equal(a.slots[0].typeId,'minecraft:compass');
 const reload=harness(h.saved);assert.equal(reload.saved.phase,'paused');
 reload.people[1].slots[0]={typeId:'minecraft:compass',amount:1};reload.api.resume(reload.people[0]);
 for(let i=0;i<899-mark;i++)reload.second();reload.hudTick();
 assert.equal(reload.saved.seconds,899);assert.equal(reload.people[1].slots[0].typeId,'minecraft:compass');
 reload.second();assert.equal(reload.people[1].slots[0].typeId,'minecraft:compass');
 reload.hudTick();assert.match(reload.people[1].slots[0].typeId,/^mh:tracker_/);
 assert.equal(reload.api.getErrors().size,0);
});

test('v1.3.0 pre-game countdown excluded and compass cannot convert during countdown',()=>{
 const h=harness(),[r,a]=h.people;h.api.getState().config.grace=0;
 h.api.startRound(r);a.slots[0]={typeId:'minecraft:compass',amount:1};
 for(let i=0;i<4;i++)h.second();h.hudTick();
 assert.equal(h.saved.seconds,0);assert.equal(h.saved.phase,'countdown');assert.equal(a.slots[0].typeId,'minecraft:compass');
 h.second();assert.equal(h.saved.phase,'running');assert.equal(h.saved.seconds,0);
 for(let i=0;i<899;i++)h.second();h.hudTick();assert.equal(a.slots[0].typeId,'minecraft:compass');
 h.second();h.hudTick();assert.match(a.slots[0].typeId,/^mh:tracker_/);
});

test('v1.3.0 hunter teammates are visible without compass before unlock, runner not shown',()=>{
 const h=started(0),[r,a,b]=h.people;
 a.location={x:0,y:60,z:0};b.location={x:20,y:65,z:0};r.location={x:10,y:60,z:0};
 h.hudTick();assert.match(a.hud,/팀원/);assert.match(a.hud,/Hunter2/);
 assert.doesNotMatch(a.hud,/Runner/);assert.doesNotMatch(r.hud,/팀원|Hunter2|Hunter1/);
 assert.match(b.hud,/팀원/);assert.match(b.hud,/Hunter1/);
 b.dimension=h.dims.get('minecraft:nether');h.hudTick();assert.match(a.hud,/Hunter2 네더/);
 assert.doesNotMatch(a.hud,/Hunter2 [↖↙↗↘↑←→↓]/);
});

test('v1.3.0 a full stack of compasses converts one only and preserves the rest',()=>{
 const h=started(0),[r,a]=h.people;
 while(h.saved.seconds<900)h.second();
 a.slots[0]={typeId:'minecraft:compass',amount:4};h.hudTick();
 assert.match(a.slots[0].typeId,/^mh:tracker_/);
 assert.equal(a.slots.filter(x=>x?.typeId==='minecraft:compass').reduce((t,x)=>t+x.amount,0),3);
 assert.equal(h.dropped.length,0);assert.equal(h.api.getErrors().size,0);
});

test('v1.3.0 full inventory does not destroy remainder of stacked compasses',()=>{
 const h=started(0),[r,a]=h.people;while(h.saved.seconds<900)h.second();
 a.slots=Array.from({length:36},()=>({typeId:'minecraft:stone',amount:64}));
 a.slots[0]={typeId:'minecraft:compass',amount:3};h.hudTick();
 assert.equal(h.dropped.length,1);assert.equal(h.dropped[0].typeId,'minecraft:compass');assert.equal(h.dropped[0].amount,2);
 assert.match(a.slots[0].typeId,/^mh:tracker_/);
});

test('v1.3.0 unlock does not grant trackers from diagnostics even after 15 minutes',async()=>{
 const h=started(0),hunter=h.people[1];while(h.saved.seconds<900)h.second();
 h.formResponses.push({canceled:false,selection:1});await h.api.diagnostics(hunter);
 assert.ok(!hunter.slots.some(i=>i?.typeId?.startsWith('mh:tracker_')));
});

test('v1.2.2 diagnostics cannot grant a tracker before unlock in an active round',async()=>{
 const h=started(60),hunter=h.people[1];
 h.formResponses.push({canceled:false,selection:1});
 await h.api.diagnostics(hunter);
 assert.ok(!hunter.slots.some(i=>i?.typeId?.startsWith('mh:tracker_')));
 assert.ok(hunter.messages.some(x=>x.includes('추적기 개방까지')));
 assert.equal(h.api.getErrors().size,0);
});

// v1.3.0 extra first-minute starter controls; do not interfere with normal survival inventory.
const command=(h,name,p)=>{assert.ok(h.commands.has(name));const reg=h.commands.get(name);assert.equal(reg.d.permissionLevel,0,'every participant may use this command');reg.f({sourceEntity:p});h.flush();};
const quantity=(p,pred)=>p.slots.filter(pred).reduce((n,it)=>n+it.amount,0);
const starterCount=p=>quantity(p,it=>it?.typeId==='minecraft:bread'&&it.getLore?.().some(x=>x.includes('MH-STARTER-')));

test('starting the game removes menu items from every participant, while keeping configured starter food',()=>{
 const h=harness(),[r,a,b]=h.people;
 assert.equal(starterCount(r),0);assert.ok(r.slots.some(it=>it?.typeId==='mh:menu'));
 a.slots[1]={typeId:'mh:menu',amount:1};b.slots[7]={typeId:'mh:tracker_0',amount:1};
 h.api.startRound(r);
 for(const p of [r,a,b]){
  assert.equal(quantity(p,it=>it?.typeId==='mh:menu'),0,'no menu in countdown');
  assert.equal(starterCount(p),8,'configured kit bread remains');
 }
 assert.equal(quantity(b,it=>it?.typeId?.startsWith('mh:tracker_')),0);
 command(h,'mh:item',a);assert.equal(quantity(a,it=>it?.typeId==='mh:menu'),0,'manual menu command cannot restore game item');
 for(let i=0;i<5;i++)h.second();
 r.slots[5]={typeId:'mh:menu',amount:1};h.second();assert.equal(quantity(r,it=>it?.typeId==='mh:menu'),0,'periodic cleanup removes legacy in-game menu');
 assert.equal(h.api.getErrors().size,0);
});

test('all players can toggle first minute starter bread; no extra food from repeated commands',()=>{
 const h=started(60),[r,a,b]=h.people;
 assert.equal(h.saved.seconds,0);
 // Keep earned bread separate from starter loaf and make sure food already eaten is never duplicated.
 const spent=a.slots.find(it=>it?.getLore?.().includes('§8MH-STARTER-1'));assert.ok(spent);spent.amount=3;
 a.slots[10]={typeId:'minecraft:bread',amount:12};b.slots[11]={typeId:'minecraft:diamond',amount:5};
 command(h,'mh:kitoff',b);
 assert.equal(h.saved.kit.enabled,false);
 assert.deepEqual([r,a,b].map(starterCount),[0,0,0]);
 assert.equal(quantity(a,it=>it?.typeId==='minecraft:bread'),12,'normal earned bread remains');
 assert.equal(b.slots[11].typeId,'minecraft:diamond');
 assert.equal(h.saved.kit.stored.Hunter1,3,'only remaining uneaten starter loaves recorded');
 command(h,'mh:kitoff',r);assert.equal(h.saved.kit.stored.Hunter1,3);
 command(h,'mh:kiton',a);
 assert.deepEqual([r,a,b].map(starterCount),[8,3,8]);
 command(h,'mh:kiton',b);assert.deepEqual([r,a,b].map(starterCount),[8,3,8]);
 command(h,'mh:kitoff',r);command(h,'mh:kiton',r);
 assert.deepEqual([r,a,b].map(starterCount),[8,3,8],'no dupes from roundtrip');
 assert.equal(h.api.getErrors().size,0);
});

test('kitoff allowed through 00:59 and blocked at 01:00, kiton can recover withheld items after minute',()=>{
 const h=started(0),[r,a]=h.people;
 for(let i=0;i<59;i++)h.second();assert.equal(h.saved.seconds,59);
 command(h,'mh:kitoff',a);assert.equal(starterCount(r),0);
 h.second();assert.equal(h.saved.seconds,60);
 command(h,'mh:kiton',r);assert.equal(starterCount(r),8,'recovery after minute stays possible');
 command(h,'mh:kitoff',r);assert.equal(starterCount(r),8,'no new disable after minute');
 assert.ok(r.messages.some(m=>m.includes('1분 안에만')));
});

test('kit bank survives pause and reload, and cannot be used to mint consumed or foreign food',()=>{
 const h=started(0),[r,a,b]=h.people;
 command(h,'mh:kitoff',b);assert.equal(h.saved.kit.stored.Runner,8);
 h.api.pause('test');for(let i=0;i<100;i++)h.second();assert.equal(h.saved.seconds,0);
 // The saved game state is retained across reload, including each player's withheld allotment.
 const restored=harness(h.saved);assert.equal(restored.saved.kit.enabled,false);
 assert.equal(restored.saved.kit.stored.Runner,8);
 command(restored,'mh:kiton',restored.people[1]);
 assert.deepEqual(restored.people.map(starterCount),[8,8,8]);
 assert.equal(restored.api.getErrors().size,0);
});

test('when kiton cannot fit an inventory, food remains banked and can be restored once space is freed',()=>{
 const h=started(0),[r,a]=h.people;
 command(h,'mh:kitoff',a);
 a.slots=Array.from({length:36},()=>({typeId:'minecraft:stone',amount:64}));
 command(h,'mh:kiton',r);
 assert.equal(h.saved.kit.stored.Hunter1,8);
 assert.equal(starterCount(a),0);
 a.slots[0]=undefined;
 command(h,'mh:kiton',a);
 assert.equal(h.saved.kit.stored.Hunter1,0);
 assert.equal(starterCount(a),8);
 assert.equal(h.api.getErrors().size,0);
});

test('menu hidden in offhand as well; offhand starter bread is banked, not deleted',()=>{
 const h=harness(),[r,a]=h.people;
 r.equipment={offhand:{typeId:'mh:menu',amount:1}};
 h.api.startRound(r);
 assert.equal(r.equipment.offhand,undefined,'menu offhand cleared at start');
 const starter=a.slots.find(it=>it?.getLore?.().some(x=>x.includes('MH-STARTER-')));
 assert.ok(starter);a.slots[a.slots.indexOf(starter)]=undefined;a.equipment={offhand:starter};
 command(h,'mh:kitoff',a);
 assert.equal(a.equipment.offhand,undefined);
 assert.equal(h.saved.kit.stored.Hunter1,8);
 command(h,'mh:kiton',r);
 assert.equal(starterCount(a),8);
 assert.equal(h.api.getErrors().size,0);
});

test('a spectator cannot alter starting inventory of the current roster',()=>{
 const h=started(30);
 const spectator=new h.Player('Spectator');h.people.push(spectator);
 command(h,'mh:kitoff',spectator);
 assert.equal(h.saved.kit.enabled,true);
 assert.equal(starterCount(h.people[0]),8);
 assert.ok(spectator.messages.some(m=>m.includes('경기 참가자만')));
});

// 1.4.0 configurable feature regression tests. Both settings UI and runtime effects matter.
async function setGroup(h,index,values){h.formResponses.push({canceled:false,formValues:values});await h.api.settingsSection(h.people[0],index);}

test('v1.4 five setting sections persist values without deleting unrelated settings',async()=>{
 const h=harness(),r=h.people[0];
 assert.equal(h.saved.config.features.teammateHud,true);
 await setGroup(h,0,[30,0,true,false,false,false,false]);
 assert.equal(h.saved.config.grace,30);assert.equal(h.saved.config.food,0);
 assert.equal(h.saved.config.features.autoPause,false);assert.equal(h.saved.config.features.lobbyMenuItem,false);
 await setGroup(h,1,[false,false,0,false,false,false,false]);
 assert.equal(h.saved.config.features.tracker,false);assert.equal(h.saved.config.features.teammateHud,false);
 await setGroup(h,2,[false,false,false,false,false]);
 await setGroup(h,3,[false,false,false]);
 await setGroup(h,4,[false,false,false]);
 assert.equal(h.saved.config.features.runnerHealth,false);
 assert.equal(h.saved.config.features.receiver,false);
 const reload=harness(h.saved);
 assert.equal(reload.saved.config.features.runnerHealth,false);
 assert.equal(reload.saved.config.features.tracker,false);
 assert.equal(reload.saved.config.food,0);
 assert.equal(reload.saved.config.features.autoPause,false);
 assert.equal(reload.api.getErrors().size,0);
});

test('v1.4 disabled tracker, teammate HUD and notices do not expose tracking or send messages',()=>{
 const h=harness(),[r,a]=h.people;
 Object.assign(h.api.getState().config.features,{tracker:false,teammateHud:false,dimensionNotice:false});
 h.api.startRound(r);for(let i=0;i<6;i++)h.second();
 h.api.getState().seconds=901;
 a.slots[0]={typeId:'minecraft:compass',amount:1};h.hudTick();
 assert.equal(a.slots[0].typeId,'minecraft:compass');
 assert.doesNotMatch(a.hud,/팀원|러너 §f[↑↓←→↖↙↘↗]/);
 h.event('playerDimensionChange').emit({player:r,fromDimension:r.dimension,toDimension:h.dims.get('minecraft:nether'),fromLocation:{x:25,y:70,z:50}});
 assert.deepEqual(h.saved.routes,{});
 assert.equal(h.messages.some(m=>m.includes('네더')&&m.includes('진입')),false);
});

test('v1.4 delay toggle OFF allows immediate conversion of user-owned compass without free items',()=>{
 const h=started(0),[r,a,b]=h.people;
 // Runtime simulation of a configuration that was chosen before start.
 Object.assign(h.api.getState().config.features,{trackerDelay:false});
 a.slots[0]={typeId:'minecraft:compass',amount:1};
 h.hudTick();assert.match(a.slots[0].typeId,/^mh:tracker_/);
 assert.equal(b.slots.some(it=>it?.typeId?.startsWith('mh:tracker_')),false);
});

test('v1.4 compass requirement OFF shows hands-free tracking, never grants a compass',()=>{
 const h=started(0),[r,a]=h.people;
 Object.assign(h.api.getState().config.features,{trackerDelay:false,craftCompass:false});
 h.api.getState().config.trackerMode='hud';
 a.location={x:50,y:65,z:50};h.hudTick();
 assert.match(a.hud,/러너/);
 assert.equal(a.slots.some(it=>it?.typeId?.includes('compass')||it?.typeId?.startsWith('mh:tracker_')),false);
});

test('v1.4 runner buffs OFF removes owned effects, avoids near-hunter warning and wild respawn',()=>{
 const h=started(0),[r,a]=h.people;
 const f=h.api.getState().config.features;
 Object.assign(f,{runnerHealth:false,runnerSaturation:false,graceBuffs:false,wildRespawns:false,proximityWarning:false});
 h.api.runnerRules.sync(r);assert.equal(r.getEffect('health_boost'),undefined);assert.equal(r.getEffect('saturation'),undefined);
 a.location={...r.location};const before=(r.messages??[]).length;
 h.api.runnerRules.tick();assert.equal((r.messages??[]).length,before);
 die(h);assert.equal(h.saved.phase,'ended');assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.runnerRespawns,0);
});

test('v1.4 start-kit control OFF rejects player command and keeps starter food',()=>{
 const h=started(60),[r,a]=h.people;
 h.api.getState().config.features.kitControls=false;
 command(h,'mh:kitoff',a);
 assert.equal(starterCount(r),8);assert.equal(h.saved.kit.enabled,true);
 assert.ok(a.messages.some(m=>m.includes('꺼져 있습니다')));
});

test('v1.4 auto-pause OFF continues when someone leaves',()=>{
 const h=started(0),r=h.people[0];
 h.api.getState().config.features.autoPause=false;
 h.event('playerLeave').emit({playerName:'Hunter1',playerId:'Hunter1'});
 assert.equal(h.saved.phase,'running');
});

test('v1.4 lobby menu automatic delivery can be turned OFF, manual command still available',()=>{
 const h=harness(),p=h.people[0];
 h.api.getState().config.features.lobbyMenuItem=false;
 h.api.initializePlayer(p);
 assert.equal(p.slots.some(it=>it?.typeId==='mh:menu'),false);
 command(h,'mh:item',p);
 assert.equal(p.slots.filter(it=>it?.typeId==='mh:menu').length,1);
});

test('v1.4 settings reject invalid payloads and do not rewrite valid saved configuration',async()=>{
 const h=harness();const prev=JSON.stringify(h.saved.config);
 h.formResponses.push({canceled:false,formValues:[1]});await h.api.settingsSection(h.people[0],1);
 assert.equal(JSON.stringify(h.saved.config),prev);
 assert.ok(h.people[0].messages.some(m=>m.includes('잘못된 설정 응답')));
});

test('v1.4 configurable runner grace: disabled effects do not interfere with countdown protection',()=>{
 const h=harness(),r=h.people[0];h.api.getState().config.features.graceBuffs=false;
 h.api.startRound(r);for(let i=0;i<5;i++)h.second();
 assert.equal(h.saved.phase,'grace');assert.equal(r.getEffect('regeneration'),undefined);assert.equal(r.getEffect('slow_falling'),undefined);
});

// New-world v1.5 integrated controller behavior. These do not use legacy defaults.
function freshStarted(grace=0){const h=harness(undefined,true);h.api.getState().config.grace=grace;h.api.startRound(h.people[0]);for(let i=0;i<5;i++)h.second();return h;}
const trackerCount=p=>p.slots.filter(it=>it?.typeId?.startsWith('mh:tracker_')).length;
let droppedSerial=0;
function throwMaterial(h,p,spec,amount=spec.amount){
 const item=new h.ItemStack(spec.id,amount),entity={id:`integration-drop-${++droppedSerial}`,typeId:'minecraft:item',isValid:true,removed:0,getComponent:()=>({itemStack:item}),remove(){this.removed++;this.isValid=false;}};
 h.event('entitySpawn').emit({entity});h.event('entityItemDrop').emit({entity:p,items:[entity]});return entity;
}
function craftStages(h,count=9){const hunters=h.people.filter(p=>p.name!==h.api.getState().runner);for(const p of hunters)if(!h.api.trackerCraft.active(p))command(h,'mh:craft',p);
 for(let i=0;i<count;i++){const d=h.api.getState().trackerCraft;const e=throwMaterial(h,hunters[i%hunters.length],d.recipe[d.step]);assert.equal(e.removed,1);}}

test('v1.5 fresh defaults lock random crafting through 19:59, count grace, and exclude countdown/pause',()=>{
 const h=harness(undefined,true),[r,a,b]=h.people;
 assert.equal(h.commands.has('mh:trackerrecipe'),true);assert.equal(h.commands.has('mh:recipe'),false,'avoid vanilla recipe alias collision');
 assert.equal(h.api.getState().config.trackerMode,'random');assert.equal(h.api.getState().config.wildRespawnBase,2);
 h.api.getState().config.grace=60;h.api.startRound(r);for(let i=0;i<4;i++)h.second();assert.equal(h.saved.seconds,0);h.second();assert.equal(h.saved.phase,'grace');h.second();assert.equal(h.saved.seconds,1);
 h.api.getState().seconds=899;a.slots[0]=new h.ItemStack('minecraft:compass');h.second();h.hudTick();assert.equal(a.slots[0].typeId,'minecraft:compass');assert.equal(trackerCount(a),0);assert.equal(trackerCount(b),0);
 h.api.getState().seconds=1199;command(h,'mh:craft',a);assert.equal(h.api.trackerCraft.active(a),false);assert.match(h.api.trackerCraft.describe(a),/비공개/);
 h.api.pause('timing');for(let i=0;i<20;i++)h.second();assert.equal(h.saved.seconds,1199);h.api.resume(r);h.second();assert.equal(h.saved.seconds,1200);command(h,'mh:craft',a);assert.equal(h.api.trackerCraft.active(a),true);
 const recipe=h.saved.trackerCraft.recipe;assert.equal(recipe.length,9);assert.equal(new Set(recipe.map(m=>m.id)).size,9);assert.equal(recipe.filter(m=>m.hard).length,2);assert.doesNotMatch(h.api.trackerCraft.describe(a),/비공개/);assert.match(h.api.trackerCraft.describe(r),/헌터 전용/);assert.equal((r.messages??[]).some(m=>m.includes('제작법이 공개')),false);
});
test('v1.5 attributed hunter drop events complete one team recipe, issue once, and prevent loss/respawn regrant',()=>{
 const h=freshStarted(),[r,a,b]=h.people;h.api.getState().seconds=1200;h.second();craftStages(h);
 assert.equal(h.saved.trackerCraft.completion,'crafted');assert.equal(h.saved.trackerCraft.step,9);assert.equal(trackerCount(r),0);assert.equal(trackerCount(a),1);assert.equal(trackerCount(b),1);
 assert.equal(a.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).nameTag,TRACKER_NAME);
 h.api.getState().seconds=2399;h.second();assert.equal(h.saved.trackerCraft.completion,'crafted');assert.equal(trackerCount(a),1);
 a.slots=Array(36);h.event('playerSpawn').emit({player:a,initialSpawn:false});h.flush();h.second();h.api.initializePlayer(a);assert.equal(trackerCount(a),0);assert.equal(h.saved.trackerCraft.delivered[a.name],true);assert.equal(h.api.getErrors().size,0);
});
test('v1.5 ordinary, runner and repeated drop events cannot advance crafting',()=>{
 const h=freshStarted(),[r,a,b]=h.people;h.api.getState().seconds=1200;h.second();const spec=h.saved.trackerCraft.recipe[0];
 assert.equal(throwMaterial(h,a,spec).removed,0,'craft mode is explicit');command(h,'mh:craft',a);assert.equal(throwMaterial(h,r,spec).removed,0);assert.equal(throwMaterial(h,b,spec).removed,0);
 const e=throwMaterial(h,a,spec,1);assert.equal(e.removed,1);const before=JSON.stringify(h.saved.trackerCraft);h.event('entityItemDrop').emit({entity:a,items:[e]});assert.equal(JSON.stringify(h.saved.trackerCraft),before);
 command(h,'mh:craft',a);const next=h.saved.trackerCraft.recipe[h.saved.trackerCraft.step];assert.equal(throwMaterial(h,a,next).removed,0);assert.equal(h.api.getErrors().size,0);
});
test('v1.5 auto-grant at exactly 40 minutes waits for space and absent hunters then delivers only once',()=>{
 const h=freshStarted(),[r,a,b]=h.people;h.api.getState().config.features.autoPause=false;a.slots=Array.from({length:36},()=>new h.ItemStack('minecraft:diamond',64));h.people.pop();h.event('playerLeave').emit({playerName:b.name,playerId:b.id});
 h.api.getState().seconds=2398;h.second();assert.equal(h.saved.trackerCraft.completion,null);h.second();assert.equal(h.saved.trackerCraft.completion,'auto');assert.equal(trackerCount(a),0);assert.equal(h.dropped.length,0);assert.equal(h.saved.trackerCraft.delivered[a.name],undefined);assert.equal(h.saved.trackerCraft.delivered[b.name],undefined);
 a.slots[0]=undefined;h.second();assert.equal(trackerCount(a),1);h.people.push(b);h.api.initializePlayer(b);assert.equal(trackerCount(b),1);h.api.initializePlayer(b);h.second();assert.equal(trackerCount(b),1);assert.equal(trackerCount(r),0);
});
test('v1.5 tracker OFF and random crafting OFF cannot be bypassed by old compass conversion or auto-grant',()=>{
 for(const key of ['tracker','randomCrafting']){const h=harness(undefined,true),[r,a]=h.people;if(key==='tracker')h.api.getState().config.features.tracker=false;else h.api.getState().config.randomCrafting=false;
  h.api.getState().config.grace=0;h.api.startRound(r);for(let i=0;i<5;i++)h.second();h.api.getState().seconds=2400;a.slots[0]=new h.ItemStack('minecraft:compass');command(h,'mh:craft',a);h.second();h.hudTick();assert.equal(h.api.trackerCraft.active(a),false);assert.equal(trackerCount(a),0);assert.equal(a.slots[0].typeId,'minecraft:compass');
 }
});
test('v1.5 team recipe and partial credit survive restart; crafting session requires reactivation',()=>{
 const h=freshStarted(),a=h.people[1];h.api.getState().seconds=1200;h.second();command(h,'mh:craft',a);throwMaterial(h,a,h.saved.trackerCraft.recipe[0],1);const before=h.saved.trackerCraft;
 const resumed=harness(h.saved,true);assert.equal(resumed.saved.phase,'paused');assert.deepEqual(resumed.saved.trackerCraft,before);assert.equal(resumed.api.trackerCraft.active(resumed.people[1]),false);resumed.api.resume(resumed.people[0]);command(resumed,'mh:craft',resumed.people[1]);assert.equal(resumed.api.trackerCraft.active(resumed.people[1]),true);
 resumed.api.reset(resumed.people[0]);assert.equal(resumed.saved.trackerCraft,null);assert.equal(resumed.saved.runnerLifeBonus,0);assert.equal(resumed.api.trackerCraft.active(resumed.people[1]),false);
});
test('v1.5 fresh runner gets two environmental respawns, then loses on third environmental death',()=>{
 const h=freshStarted();for(let n=1;n<=2;n++){die(h);assert.equal(h.saved.phase,'running');assert.equal(h.saved.runnerRespawns,n);respawn(h);assert.equal(h.people[0].health,40);}die(h);assert.equal(h.saved.phase,'ended');assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.runnerRespawns,2);
});
test('v1.5 registered revive callbacks share state and add only one capped opportunity',()=>{
 const h=freshStarted(),r=h.people[0],use=h.components.get('mh:revive_use');assert.ok(use);r.slots[0]=new h.ItemStack('mh:revive_totem');r.selectedSlotIndex=0;use.onUse({source:r});assert.equal(r.slots[0],undefined);r.slots[0]=new h.ItemStack('mh:revive_totem');use.onUseOn({source:r});assert.equal(h.saved.runnerLifeBonus,1);assert.equal(r.slots[0].amount,1);
 die(h);respawn(h);die(h);respawn(h);die(h);assert.equal(h.saved.phase,'running');respawn(h);assert.equal(h.saved.runnerRespawns,3);die(h);assert.equal(h.saved.result,'헌터 승리');h.api.reset(r);assert.equal(h.saved.runnerLifeBonus,0);
});
test('v1.5 nonparticipant or self-attributed fatal damage does not count as a hunter kill',()=>{
 for(const self of [false,true]){const h=freshStarted(),r=h.people[0];die(h,{damagingEntity:self?r:new h.Player('Visitor')});assert.equal(h.saved.phase,'running');assert.equal(h.saved.runnerRespawns,1);respawn(h);die(h,{damagingEntity:h.people[1]});assert.equal(h.saved.result,'헌터 승리');assert.equal(h.saved.runnerRespawns,1);}
});
test('v1.5 end-of-round stops crafting timer and creates no delayed free tracker',()=>{
 const h=freshStarted();h.api.getState().seconds=2399;die(h,{damagingEntity:h.people[1]});assert.equal(h.saved.phase,'ended');for(let i=0;i<20;i++)h.second();assert.equal(h.saved.seconds,2399);assert.equal(h.saved.trackerCraft.completion,null);assert.equal(h.people.slice(1).some(p=>trackerCount(p)>0),false);
});

test('v1.5 detailed settings retain the five existing categories and persist all new groups',async()=>{
 const h=harness(undefined,true),r=h.people[0];
 h.formResponses.push({canceled:false,formValues:[0,true,10,true,30,2,8,false,false,true]});await h.api.extraSettings(r,'tracker');
 assert.equal(h.saved.config.trackerMode,'random');assert.equal(h.saved.config.trackerRevealMinutes,10);assert.equal(h.saved.config.trackerAutoMinutes,30);assert.equal(h.saved.config.trackerCommonMultiplier,2);assert.equal(h.saved.config.trackerRareCount,8);assert.equal(h.saved.config.trackerProgress,false);assert.equal(h.saved.config.trackerNotices,false);assert.equal(h.saved.config.trackerReacquire,true);
 h.formResponses.push({canceled:false,formValues:[100,70,45,15,false,12,1,false,4]});await h.api.extraSettings(r,'runner');
 assert.deepEqual(h.saved.config.proximityDistances,[100,70,45,15]);assert.equal(h.saved.config.proximitySound,false);assert.equal(h.saved.config.proximityCooldownSeconds,12);assert.equal(h.saved.config.wildRespawnBase,1);assert.equal(h.saved.config.features.reviveItem,false);assert.equal(h.saved.config.wildRespawnMax,4);
 h.formResponses.push({canceled:false,formValues:[true,400,180,3,1,false]});await h.api.extraSettings(r,'summon');
 assert.equal(h.saved.config.summonDistance,400);assert.equal(h.saved.config.summonCooldownSeconds,180);assert.equal(h.saved.config.summonMaxUses,3);assert.equal(h.saved.config.summonAcquire,'disabled');assert.equal(h.saved.config.summonSound,false);assert.equal(h.saved.config.features.summon,true);assert.equal(h.saved.config.food,8);assert.equal(h.saved.config.features.receiver,true);
 const reload=harness(h.saved,true);assert.deepEqual(reload.saved.config,h.saved.config);assert.equal(h.api.getErrors().size,0);
});
test('v1.5 detailed settings reject inverted distances, life caps and timers without partial mutation',async()=>{
 const cases=[['runner',[90,90,40,10,true,10,2,true,3]],['runner',[90,60,40,10,true,10,4,true,3]],['tracker',[0,true,40,true,20,1,6,true,true,false]],['summon',[true,351,300,2,0,true]],['tracker',[99,true,20,true,40,1,6,true,true,false]]];
 for(const [key,formValues] of cases){const h=harness(undefined,true),before=JSON.stringify(h.saved.config);h.formResponses.push({canceled:false,formValues});await h.api.extraSettings(h.people[0],key);assert.equal(JSON.stringify(h.saved.config),before,`${key} must not partially apply invalid form`);}
 const h=freshStarted(),before=JSON.stringify(h.saved.config);h.formResponses.push({canceled:false,formValues:[false,0,0,1,0,false]});await h.api.extraSettings(h.people[0],'summon');assert.equal(JSON.stringify(h.saved.config),before,'active-round settings must remain immutable');
});
function summonStarted(four=false){const h=harness(undefined,true);if(four)h.people.push(new h.Player('Hunter3'));h.api.getState().config.grace=0;h.api.startRound(h.people[0]);for(let i=0;i<5;i++)h.second();
 const [r,a]=h.people;r.location={x:-500,y:65,z:0};a.location={x:0,y:65,z:0};for(let i=2;i<h.people.length;i++)h.people[i].location={x:i*50,y:65,z:i*50};a.slots[0]=new h.ItemStack('mh:summon_scroll');a.selectedSlotIndex=0;return h;}
test('v1.5 summon component teleports same-dimension hunter, informs remote hunter and consumes once',()=>{
 const h=summonStarted(true),[r,a,b,c]=h.people,use=h.components.get('mh:summon_use');assert.ok(use);assert.equal(h.people.flatMap(p=>p.slots).filter(it=>it?.typeId==='mh:summon_scroll').length,1,'the harness supplied the only scroll; start kit supplied none');
 c.dimension=h.dims.get('minecraft:nether');const remote={...c.location};use.onUse({source:a});use.onUseOn({source:a});
 assert.equal(h.saved.summon.uses,1);assert.equal(a.slots[0],undefined);assert.equal(b.summonMoves.length,1);assert.ok(Math.hypot(b.location.x-a.location.x,b.location.z-a.location.z)<7);assert.deepEqual(c.location,remote);assert.equal(c.summonMoves,undefined);assert.ok(c.messages.some(m=>m.includes('다른 차원')));assert.equal(r.summonMoves,undefined);assert.equal(h.saved.summon.transaction,null);assert.equal(h.api.getErrors().size,0);
 a.slots[0]=new h.ItemStack('mh:summon_scroll');h.second();use.onUse({source:a});assert.equal(a.slots[0].typeId,'mh:summon_scroll');assert.equal(h.saved.summon.uses,1,'cooldown preserves scroll');
 h.api.getState().seconds=h.saved.summon.readyAt;h.second();use.onUse({source:a});assert.equal(h.saved.summon.uses,2);assert.equal(a.slots[0],undefined);a.slots[0]=new h.ItemStack('mh:summon_scroll');h.api.getState().seconds=h.saved.summon.readyAt;h.second();use.onUse({source:a});assert.equal(a.slots[0].typeId,'mh:summon_scroll');assert.equal(h.saved.summon.uses,2,'round limit preserves scroll');h.api.reset(r);assert.equal(h.saved.summon.uses,0);
});
test('v1.5 summon guards exact 350 range, runner, disabled acquisition and unsafe terrain without item loss',()=>{
 for(const reason of ['range','runner','off','acquisition','unsafe']){const h=summonStarted(),[r,a,b]=h.people,use=h.components.get('mh:summon_use');let caller=a;const before={...b.location};
  if(reason==='range')r.location={x:350,y:65,z:0};if(reason==='runner'){caller=r;r.slots[0]=new h.ItemStack('mh:summon_scroll');}if(reason==='off')h.api.getState().config.features.summon=false;if(reason==='acquisition')h.api.getState().config.summonAcquire='disabled';if(reason==='unsafe')a.dimension.getBlock=()=>({typeId:'minecraft:lava',isAir:false});
  use.onUse({source:caller});assert.equal(caller.slots[0].typeId,'mh:summon_scroll',reason);assert.deepEqual(b.location,before);assert.equal(h.api.getState().summon?.uses??0,0);assert.equal(h.api.getErrors().size,0);
 }
});
test('v1.5 partial summon failure journals a failed rollback, preserves scroll and resumes when recovery succeeds',()=>{
 const h=summonStarted(true),[r,a,b,c]=h.people,use=h.components.get('mh:summon_use'),originalB={...b.location},originalC={...c.location};let rollbackFails=true;const moveB=b.tryTeleport.bind(b);b.tryTeleport=(pos,opts)=>rollbackFails&&pos.x===originalB.x&&pos.z===originalB.z?false:moveB(pos,opts);c.teleportFailure=true;use.onUse({source:a});
 assert.notDeepEqual(b.location,originalB);assert.deepEqual(c.location,originalC);assert.equal(a.slots[0].typeId,'mh:summon_scroll');assert.equal(h.saved.summon.uses,0);assert.equal(h.api.summon.hasPending(),true);
 rollbackFails=false;c.teleportFailure=false;h.api.initializePlayer(c);assert.deepEqual(b.location,originalB);assert.equal(h.api.summon.hasPending(),false);assert.equal(h.saved.summon.transaction,null);h.second();use.onUse({source:a});assert.equal(h.saved.summon.uses,1);assert.equal(a.slots[0],undefined);
});
function pendingSummon(h,phase='moving'){
 const [,a,b]=h.people;h.api.pause('summon recovery test');b.teleportFailure=true;
 h.api.getState().summon.transaction={caller:a.name,token:'recovery-ui',phase,participants:h.people.slice(2).map(p=>p.name),origins:[{name:b.name,dimension:b.dimension.id,location:{x:1000,y:65,z:1000},rotation:{x:0,y:0}}]};
 a.slots[0].setDynamicProperty('mh:summon_receipt','recovery-ui');h.api.summon.recover(true);assert(h.api.summon.hasPending());
}
test('v1.5 recovery menu is visible only to the host and direct non-host entry cannot alter the transaction',async()=>{
 const h=summonStarted(true),[host,hunter]=h.people;pendingSummon(h);await h.api.showMenu(host);await h.api.showMenu(hunter);
 assert(h.shownForms[0].buttons.includes('중단된 소집 복구'));assert(!h.shownForms[1].buttons.includes('중단된 소집 복구'));
 h.formResponses.push({canceled:false,selection:2},{canceled:false,selection:1});await h.api.recoverSummon(hunter);assert.equal(h.shownForms.length,2);assert(h.api.summon.hasPending());assert.equal(h.formResponses.length,2);assert.equal(h.saved.summon.lastRecovery,null);
});
test('v1.5 host recovery requires confirmation, keeps safe current positions and preserves the sole scroll',async()=>{
 const h=summonStarted(true),host=h.people[0];pendingSummon(h,'refund_pending');const places=h.people.map(p=>({...p.location}));
 h.formResponses.push({canceled:false,selection:2},{canceled:false,selection:0});await h.api.recoverSummon(host);assert(h.api.summon.hasPending());assert.match(h.shownForms[0].body,/자동 보상하지/);assert.match(h.shownForms[1].body,/원래 위치로 다시 이동시키지/);
 h.formResponses.push({canceled:false,selection:2},{canceled:false,selection:1});await h.api.recoverSummon(host);assert(!h.api.summon.hasPending());assert.deepEqual(h.people.map(p=>p.location),places);assert.equal(h.people.flatMap(p=>p.slots).filter(i=>i?.typeId==='mh:summon_scroll').length,1);assert.equal(h.saved.summon.uses,0);assert.equal(h.saved.summon.lastRecovery.administrator,host.name);assert.equal(h.saved.summon.lastRecovery.previousPhase,'refund_pending');
 const audit=h.saved.summon.lastRecovery;h.api.reset(host);assert.deepEqual(h.saved.summon.lastRecovery,audit);assert.equal(h.saved.phase,'lobby');
});
test('v1.5 recovery confirmation rechecks active phase, ground safety and administrator role',async()=>{
 for(const reason of ['running','unsafe','permission','changed-token']){
  const h=summonStarted(true),host=h.people[0];pendingSummon(h);
  h.formResponses.push({canceled:false,selection:2},()=>{if(reason==='running')h.api.getState().phase='running';if(reason==='unsafe')h.people[2].location.y=66;if(reason==='permission')h.api.getState().host='Hunter1';if(reason==='changed-token')h.api.getState().summon.transaction.token='new-transaction';return {canceled:false,selection:1};});
  await h.api.recoverSummon(host);assert(h.api.summon.hasPending(),reason);assert.equal(h.api.getState().summon.lastRecovery,null,reason);assert.equal(h.people[1].slots[0].typeId,'mh:summon_scroll',reason);
 }
});
test('v1.5 explicit recovery menu retry bypasses automatic backoff without losing transaction or scroll',async()=>{
 const h=summonStarted(),host=h.people[0];pendingSummon(h);const tx=h.api.summon.pendingRecovery();
 h.formResponses.push({canceled:false,selection:1});await h.api.recoverSummon(host);assert(h.api.summon.hasPending());assert(host.messages.some(m=>m.includes('복구 대기')));
 h.people[2].teleportFailure=false;assert.equal(h.api.summon.recover(),false,'automatic attempts wait 100 ticks after failure');
 h.formResponses.push({canceled:false,selection:1});await h.api.recoverSummon(host);assert(!h.api.summon.hasPending());assert.deepEqual(h.people[2].location,tx.pendingOrigins[0].location);assert.equal(h.people[1].slots[0].typeId,'mh:summon_scroll');assert.equal(h.saved.summon.uses,0);assert(host.messages.some(m=>m.includes('소집 복구 완료')));
});
test('v1.5 owned compass frames respond to each hunter rotation and keep the other dimension last location',()=>{
 const h=freshStarted(),[r,a,b]=h.people;h.api.getState().seconds=2399;h.second();a.location={x:0,y:65,z:0};b.location={...a.location};r.location={x:0,y:65,z:100};a.yaw=0;b.yaw=90;
 for(const p of [a,b])h.api.trackerDisplay.scan(p);h.displayTick();assert.equal(a.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).typeId,'mh:tracker_0');assert.equal(b.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).typeId,'mh:tracker_24');
 a.yaw=11.25;h.displayTick();assert.equal(a.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).typeId,'mh:tracker_31');assert.equal(b.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).typeId,'mh:tracker_24','owner rotation does not change another inventory');
 const oldDimension=r.dimension;r.dimension=h.dims.get('minecraft:nether');r.location={x:500,y:65,z:-300};h.event('playerDimensionChange').emit({player:r,fromDimension:oldDimension,toDimension:r.dimension,fromLocation:{x:0,y:65,z:100},toLocation:r.location});h.displayTick();assert.equal(a.slots.find(it=>it?.typeId?.startsWith('mh:tracker_')).typeId,'mh:tracker_31','no implicit 8-to-1 coordinate projection');a.selectedSlotIndex=a.slots.findIndex(it=>it?.typeId?.startsWith('mh:tracker_'));h.hudTick();assert.match(a.hud,/마지막 위치/);assert.match(a.hud,/네더/);
});

test('v1.5 persisted outcome resolves hunter, exhausted-life and dragon results after reload before queued callback',()=>{
 for(const cause of ['hunter','exhausted','dragon']){const h=freshStarted(),r=h.people[0];
  if(cause==='dragon')h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')}});
  else {if(cause==='exhausted')h.api.getState().runnerRespawns=2;r.health=0;h.event('entityDie').emit({deadEntity:r,damageSource:cause==='hunter'?{damagingEntity:h.people[1]}:{cause:'fall'}});}
  const saved=h.saved;assert.equal(saved.phase,'running');assert.equal(saved.pendingOutcome.round,saved.round);assert.equal(saved.pendingOutcome.runnerDied,cause!=='dragon');assert.equal(saved.pendingOutcome.dragonDied,cause==='dragon');
  const resumed=harness(saved,true);resumed.flush();assert.equal(resumed.saved.phase,'ended');assert.equal(resumed.saved.result,cause==='dragon'?'러너 승리':'헌터 승리');assert.equal(resumed.saved.pendingOutcome,null);
  const winner=cause==='dragon'?'Runner':'Hunter1';assert.equal(resumed.saved.wins[winner],1);resumed.flush();resumed.second();assert.equal(resumed.saved.wins[winner],1);
 }
});
test('v1.5 saved simultaneous fatal hit and dragon event preserve hunter precedence across restart',()=>{
 for(const dragonFirst of [false,true]){const h=freshStarted(),r=h.people[0];const dragon=()=>h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')}}),fatal=()=>{r.health=0;h.event('entityDie').emit({deadEntity:r,damageSource:{damagingEntity:h.people[1]}});};
  if(dragonFirst){dragon();fatal();}else{fatal();dragon();}assert.equal(h.saved.pendingOutcome.runnerDied,true);assert.equal(h.saved.pendingOutcome.dragonDied,true);
  const resumed=harness(h.saved,true);resumed.flush();assert.equal(resumed.saved.result,'헌터 승리');assert.equal(resumed.saved.wins.Runner,undefined);assert.equal(resumed.saved.wins.Hunter1,1);
 }
});
test('v1.5 saved dragon outcome waits for pending wild respawn after restart',()=>{
 const h=freshStarted(),r=h.people[0];r.health=0;h.event('entityDie').emit({deadEntity:r,damageSource:{cause:'fall'}});h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')}});
 const resumed=harness(h.saved,true);resumed.flush();assert.equal(resumed.saved.phase,'paused');assert.equal(resumed.saved.runnerRespawning,true);assert.equal(resumed.saved.pendingRunnerVictory,true);assert.equal(resumed.saved.pendingOutcome,null);
 resumed.event('playerSpawn').emit({player:resumed.people[0],initialSpawn:true});resumed.flush();assert.equal(resumed.saved.result,'러너 승리');assert.equal(resumed.saved.wins.Runner,1);
});
test('v1.5 reset invalidates queued outcome and old-round journals cannot award a later round',()=>{
 const h=freshStarted(),r=h.people[0];h.event('entityDie').emit({deadEntity:{typeId:'minecraft:ender_dragon',dimension:h.dims.get('minecraft:the_end')}});h.api.reset(r);h.flush();assert.equal(h.saved.phase,'lobby');assert.equal(h.saved.pendingOutcome,null);assert.deepEqual(h.saved.wins,{});
 const saved={...core.newState(),phase:'running',round:5,host:'Runner',runner:'Runner',choice:'Runner',roster:['Runner','Hunter1','Hunter2'],start:{x:10,y:65,z:10},lobby:{x:10,y:305,z:10},pendingOutcome:{round:4,runnerDied:true,dragonDied:false}};
 const resumed=harness(saved,true);resumed.flush();assert.equal(resumed.saved.phase,'paused');assert.deepEqual(resumed.saved.wins,{});resumed.api.reset(resumed.people[0]);resumed.api.startRound(resumed.people[0]);assert.equal(resumed.saved.round,6);assert.equal(resumed.saved.pendingOutcome,null);resumed.flush();assert.equal(resumed.saved.phase,'countdown');
});
