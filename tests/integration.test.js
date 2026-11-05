import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createExpansion} from '../BP/scripts/expansion.js';
import {createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS,nearbyHunters} from '../BP/scripts/runner.js';
import * as core from '../BP/scripts/core.js';

function harness(saved){
 const signals={},tasks=[],intervals=[],commands=new Map(),messages=[],formResponses=[];let tick=0;
 const event=(name)=>signals[name]??=( {handlers:[],subscribe(fn){this.handlers.push(fn);},emit(e){this.handlers.forEach(fn=>fn(e));}} );
 const events=new Proxy({}, {get:(_,key)=>event(key)});
 const dropped=[];const dims=new Map(['overworld','nether','the_end'].map(n=>['minecraft:'+n,{id:'minecraft:'+n,runCommand(){},spawnItem(item){dropped.push(item);}}]));
 class ItemStack{constructor(typeId,amount=1){this.typeId=typeId;this.amount=amount;}setLore(v){this.lore=v;}getLore(){return this.lore??[];}}
 class Player{
  constructor(name){this.camera={clear(){},setCamera(){}};this.name=name;this.id=name;this.typeId='minecraft:player';this.dimension=dims.get('minecraft:overworld');this.location={x:0,y:65,z:0};this.selectedSlotIndex=0;this.isSneaking=false;this.isValid=true;this.effects=[];this.slots=Array(36);this.health=20;this.inputPermissions={setPermissionCategory:(_,v)=>this.moving=v};this.onScreenDisplay={setTitle:(t)=>this.title=t,setActionBar:(t)=>this.hud=t};const self=this;this.inv={size:36,get emptySlotsCount(){return self.slots.filter(x=>x).length===36?0:36-self.slots.filter(x=>x).length;},getItem:i=>self.slots[i],setItem:(i,v)=>self.slots[i]=v,clearAll:()=>self.slots=Array(36),addItem:v=>{const slot=self.slots.findIndex(x=>!x);if(slot<0)return v;self.slots[slot]=v;return undefined;}};}
  getComponent(n){const p=this;return n==='minecraft:inventory'?{container:this.inv}:n==='minecraft:health'?{get currentValue(){return p.health;},get effectiveMax(){return 20+(p.getEffect('health_boost')?4*(p.getEffect('health_boost').amplifier+1):0);},setCurrentValue:v=>p.health=v}:n==='minecraft:equippable'?{setEquipment(slot,item){p.equipment??={};p.equipment[slot]=item;},getEquipment(slot){return p.equipment?.[slot];}}:undefined;}
  getGameMode(){return this.mode;}getEffects(){return this.effects;}getEffect(id){return this.effects.find(e=>e.typeId===id);}removeEffect(id){this.effects=this.effects.filter(e=>e.typeId!==id);if(id==='health_boost')this.health=Math.min(20,this.health);}addEffect(id,duration,opts){this.effects=this.effects.filter(e=>e.typeId!==id);this.effects.push({typeId:id,duration,amplifier:opts?.amplifier??0});}
  getDynamicProperty(k){return this.props?.[k];}setDynamicProperty(k,v){(this.props??={})[k]=v;}
  extinguishFire(){}resetLevel(){}setGameMode(m){this.mode=m;}teleport(p,o){this.location={...p};if(o?.dimension)this.dimension=o.dimension;}setSpawnPoint(p){this.spawn=p;}sendMessage(m){messages.push(m);(this.messages??=[]).push(m);}playSound(){}getRotation(){return {x:0,y:0};}
 }
 const people=['Runner','Hunter1','Hunter2'].map(n=>new Player(n));
 let state=saved??{...core.newState(),host:'Runner',choice:'Runner',start:{x:10,y:65,z:10},lobby:{x:10,y:305,z:10}};
 let data=JSON.stringify(state);
 const world={getAllPlayers:()=>people,getDimension:n=>dims.get(n.startsWith('minecraft:')?n:'minecraft:'+n),getDynamicProperty:()=>data,setDynamicProperty:(_,v)=>data=v,gameRules:{},setDefaultSpawnLocation(){},setTimeOfDay(){},sendMessage:m=>messages.push(m),afterEvents:events,beforeEvents:events};
 const system={get currentTick(){return tick;},beforeEvents:events,run:fn=>tasks.push(fn),runTimeout:fn=>tasks.push(fn),runInterval:(fn,ticks)=>intervals.push({fn,ticks}),clearRun(){},runJob:gen=>{for(const _ of gen){}}};
 class Form{title(){return this;}body(){return this;}button(){return this;}slider(){return this;}toggle(){return this;}show(){return Promise.resolve(formResponses.shift()??{canceled:true});}}
 const context={...core,createExpansion,createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS,world,system,Player,ItemStack,ItemLockMode:{inventory:'inventory'},GameMode:{Adventure:'adventure',Survival:'survival',Spectator:'spectator'},InputPermissionCategory:{Movement:'move'},CommandPermissionLevel:{Any:0,Host:3},CustomCommandStatus:{Success:0,Failure:1},EquipmentSlot:{Head:'head',Chest:'chest',Legs:'legs',Feet:'feet',Offhand:'offhand'},console,ActionFormData:Form,ModalFormData:Form,MessageFormData:Form};
 const text=fs.readFileSync(new URL('../BP/scripts/main.js',import.meta.url),'utf8').replace(/import[\s\S]*?from ['"][^'"]+['"];\r?\n/g,'');
 vm.runInNewContext(text+'\nglobalThis.testApi={startRound,pause,resume,reset,initializePlayer,settings,settingsSection,diagnostics,runnerRules,getState:()=>s,getErrors:()=>lastErrors};',context);
 event('startup').emit({itemComponentRegistry:{registerCustomComponent(){}},customCommandRegistry:{registerCommand:(d,f)=>commands.set(d.name,{d,f})}});event('worldLoad').emit({});
 const flush=()=>{while(tasks.length)tasks.shift()();};
 const second=()=>{tick+=20;intervals.filter(x=>x.ticks===20).forEach(x=>x.fn());flush();};
 const hudTick=()=>{tick+=5;intervals.filter(x=>x.ticks===5).forEach(x=>x.fn());flush();};
 return {api:context.testApi,people,Player,world,signals,dims,event,flush,second,hudTick,commands,messages,formResponses,dropped,get saved(){return JSON.parse(data);}};
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
test('nearby warning is private, includes exactly 5 blocks, rejects other dimensions/dead/nonmembers, throttles',()=>{
 const h=started(),[r,a,b]=h.people;r.location={x:0,y:70,z:0};a.location={x:3,y:74,z:0};b.location={x:0,y:75.01,z:0};const outsider=new h.Player('Outsider');outsider.location={...r.location};h.people.push(outsider);
 assert.deepEqual(nearbyHunters(h.api.getState(),r,h.people,()=>false).map(p=>p.name),[a.name]);a.dimension=h.dims.get('minecraft:nether');assert.equal(nearbyHunters(h.api.getState(),r,h.people,()=>false).length,0);a.dimension=r.dimension;assert.equal(nearbyHunters(h.api.getState(),r,h.people,p=>p===a).length,0);
 const warnings=p=>(p.messages??[]).filter(m=>m.includes('경고!')).length;h.api.runnerRules.tick();assert.equal(warnings(r),1);assert.equal(warnings(a),0);h.api.runnerRules.tick();assert.equal(warnings(r),1);h.people.pop();for(let i=0;i<5;i++)h.second();h.api.runnerRules.tick();assert.equal(warnings(r),2);
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
 a.slots[1]={typeId:'mh:tracker_3',amount:1};h.second();assert.equal(trackers(a).length,0);
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
