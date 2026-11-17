import test from 'node:test';import assert from 'node:assert/strict';
import {newState} from '../BP/scripts/core.js';import {newExtra,inBounds,RECEIVER} from '../BP/scripts/expansion-core.js';import {createExpansion} from '../BP/scripts/expansion.js';
function setup(){const s={...newState(),phase:'running',runner:'R',roster:['R','A','B'],start:{x:0,y:64,z:0}};const messages=[],drops=[],errors=[];const dims=Object.fromEntries(['overworld','nether','the_end'].map(n=>[n,{id:'minecraft:'+n,spawnItem:i=>drops.push(i),heightRange:{max:320},spawnParticle(_id,p){if(p.y>=320)throw Error('out of world');},getBlock:()=>({typeId:'minecraft:air'})}]));
 const people=s.roster.map(name=>({name,location:{x:0,y:64,z:0},dimension:dims.overworld,selectedSlotIndex:0,dead:false,camera:{active:false,clear(){this.active=false;},setCamera(){this.active=true;}},getHeadLocation(){return {...this.location,y:this.location.y+1.6};},teleport(p,o){this.location={...p};this.dimension=o.dimension;},items:[],inv:{getItem:()=>({typeId:RECEIVER}),addItem(i){people.find(p=>p.inv===this).items.push(i);}}}));
 const world={getAllPlayers:()=>people,getDimension:n=>dims[n]},system={currentTick:0};class ItemStack{constructor(typeId,amount){this.typeId=typeId;this.amount=amount;}}
 const x=createExpansion(world,system,()=>s,{tell:(p,m)=>messages.push({name:p.name,m}),inventory:p=>p.inv,ItemStack,report:(w,e)=>errors.push([w,e]),isDead:p=>p.dead});
 return {s,x,people,dims,messages,drops,errors,system};}
test('10000 square and 1:8 Nether bounds include negative edge and exclude positive edge',()=>{for(const [d,n]of [['minecraft:overworld',5000],['minecraft:the_end',5000],['minecraft:nether',625]]){assert(inBounds({x:-n,z:n-.001},d));assert(!inBounds({x:n,z:0},d));assert(!inBounds({x:0,z:-n-.001},d));}});
test('40-minute hint goes only to runner, once, with no early reveal',()=>{const h=setup();h.s.seconds=2399;h.x.second();assert.equal(h.messages.length,0);h.s.seconds=2400;h.x.second();h.x.second();assert.equal(h.messages.length,1);assert.equal(h.messages[0].name,'R');assert.match(h.messages[0].m,/X 352, Z 96/);});
test('fortress arrival suppresses timeout; hunter-first still grants its own immediate hint',()=>{const h=setup();h.s.extra.fortressEntered=true;h.s.seconds=2500;h.x.second();assert.equal(h.messages.length,0);h.x.dimensionChanged({player:h.people[1],toDimension:h.dims.nether});assert.equal(h.messages.length,1);assert.equal(h.messages[0].name,'R');});
test('runner-first Nether entry suppresses hunter-first hint and repeated arrivals do not spam',()=>{const h=setup();h.x.dimensionChanged({player:h.people[0],toDimension:h.dims.nether});h.x.dimensionChanged({player:h.people[1],toDimension:h.dims.nether});assert.equal(h.messages.length,0);h.s.extra=newExtra();h.x.dimensionChanged({player:h.people[1],toDimension:h.dims.nether});h.x.dimensionChanged({player:h.people[2],toDimension:h.dims.nether});assert.equal(h.messages.length,1);});
test('End grants precisely 32 eyes once, ignores hunters, survives saved-state reload',()=>{const h=setup();h.x.dimensionChanged({player:h.people[1],toDimension:h.dims.the_end});assert.equal(h.people[1].items.length,0);h.x.dimensionChanged({player:h.people[0],toDimension:h.dims.the_end});h.s.extra=JSON.parse(JSON.stringify(h.s.extra));h.x.dimensionChanged({player:h.people[0],toDimension:h.dims.the_end});assert.deepEqual(h.people[0].items.map(i=>[i.typeId,i.amount]),[['minecraft:ender_eye',32]]);});
test('full inventory places End reward on ground once',()=>{const h=setup();h.people[0].inv.addItem=i=>i;h.x.grantEnd(h.people[0]);h.x.grantEnd(h.people[0]);assert.equal(h.drops.length,1);assert.equal(h.drops[0].amount,32);});
test('only runner activates receiver; all same-dimension hunters get camera with cooldown and automatic restore',()=>{const h=setup();assert.equal(h.x.useReceiver(h.people[1]),false);assert.equal(h.x.useReceiver(h.people[0]),true);assert(h.people.slice(1).every(p=>p.camera.active));assert.equal(h.x.useReceiver(h.people[0]),false);h.system.currentTick=60;h.x.tick();assert(h.people.every(p=>!p.camera.active));assert.equal(h.errors.length,0);});
test('receiver never moves cross-dimension hunter camera, and pause/damage reset camera',()=>{const h=setup();h.people[2].dimension=h.dims.nether;h.x.useReceiver(h.people[0]);assert(h.people[1].camera.active);assert(!h.people[2].camera.active);h.x.clearCamera(h.people[1]);assert(!h.people[1].camera.active);h.s.seconds=30;h.x.useReceiver(h.people[0]);h.s.phase='paused';h.x.tick();assert(!h.people[1].camera.active);});
test('border rollback preserves safe dimension; unknown portal arrival returns to start',()=>{const h=setup(),r=h.people[0];h.x.tick();r.location.x=5000;h.system.currentTick+=10;h.x.tick();assert.equal(r.location.x,0);r.dimension=h.dims.nether;r.location.x=626;h.system.currentTick+=10;h.x.tick();assert.equal(r.dimension.id,'minecraft:overworld');assert.equal(r.location.x,0);});
test('round reset clears cooldown and rewards without altering wins',()=>{const h=setup();h.s.wins.R=2;h.s.extra.endReward=true;h.s.extra.receiverReady=500;h.x.reset();assert.equal(h.s.extra.endReward,false);assert.equal(h.s.extra.receiverReady,0);assert.equal(h.s.wins.R,2);});

test('receiver beam works near upper world height',()=>{const h=setup();h.people[0].location.y=310;h.x.useReceiver(h.people[0]);h.x.tick();assert.equal(h.errors.length,0);});

test('v1.4 optional borders, hint, End reward can be disabled independently',()=>{
 const h=setup();Object.assign(h.s.config.features,{borders:false,fortressHint:false,endReward:false});
 h.s.seconds=2500;h.x.second();assert.equal(h.messages.length,0);
 h.people[0].location.x=10000;h.x.tick();assert.equal(h.people[0].location.x,10000);
 h.x.dimensionChanged({player:h.people[0],toDimension:h.dims.the_end});assert.equal(h.people[0].items.length,0);
});

test('v1.4 receiver OFF blocks activation and does not create camera or signal',()=>{
 const h=setup();h.s.config.features.receiver=false;
 assert.equal(h.x.useReceiver(h.people[0]),false);assert.equal(h.people.slice(1).some(p=>p.camera.active),false);
});

test('v1.4 receiver camera OFF still notifies hunters but never changes camera',()=>{
 const h=setup();h.s.config.features.receiverCamera=false;
 assert.equal(h.x.useReceiver(h.people[0]),true);
 assert.equal(h.people.slice(1).some(p=>p.camera.active),false);
 assert.ok(h.messages.some(x=>x.m.includes('카메라 전환 OFF')));
});

test('v1.4 signal beam OFF does not spawn beam particles',()=>{
 const h=setup();let beams=0;h.dims.overworld.spawnParticle=()=>beams++;
 h.s.config.features.receiverBeam=false;
 assert.equal(h.x.useReceiver(h.people[0]),true);
 for(let i=0;i<20;i++){h.system.currentTick+=5;h.x.tick();}
 assert.equal(beams,0);
});

test('border checks run every ten ticks from every initial callback phase, without repeated same-tick work',()=>{
 for(let phase=0;phase<10;phase++){
  const h=setup(),r=h.people[0];h.system.currentTick=phase;r.location.x=6000;h.x.tick();assert.equal(r.location.x,0,`phase ${phase}: first check`);
  r.location.x=6000;h.x.tick();assert.equal(r.location.x,6000,`phase ${phase}: duplicate callback`);
  h.system.currentTick=phase+5;h.x.tick();assert.equal(r.location.x,6000,`phase ${phase}: too early`);
  h.system.currentTick=phase+10;h.x.tick();assert.equal(r.location.x,0,`phase ${phase}: second check`);
  r.location.x=6000;h.system.currentTick=phase+15;h.x.tick();assert.equal(r.location.x,6000);
  h.system.currentTick=phase+20;h.x.tick();assert.equal(r.location.x,0);
 }
});

test('signal beams run every ten ticks from every initial callback phase and stop at expiry',()=>{
 for(let phase=0;phase<10;phase++){
  const h=setup(),emitted=[];h.system.currentTick=phase;h.dims.overworld.spawnParticle=()=>emitted.push(h.system.currentTick);h.x.useReceiver(h.people[0]);
  h.x.tick();h.x.tick();for(let elapsed=5;elapsed<=170;elapsed+=5){h.system.currentTick=phase+elapsed;h.x.tick();}
  assert.deepEqual(emitted,Array.from({length:16},(_,i)=>phase+i*10),`phase ${phase}`);
 }
});

test('border and beam deadlines are independent, and delayed callbacks do not emit catch-up bursts',()=>{
 const h=setup(),emitted=[];h.system.currentTick=3;h.x.tick();h.dims.overworld.spawnParticle=()=>emitted.push(h.system.currentTick);
 h.system.currentTick=8;h.x.useReceiver(h.people[0]);h.people[0].location.x=6000;h.x.tick();assert.equal(h.people[0].location.x,6000);assert.deepEqual(emitted,[8]);
 h.system.currentTick=13;h.x.tick();assert.equal(h.people[0].location.x,0);assert.deepEqual(emitted,[8]);
 h.system.currentTick=18;h.x.tick();assert.deepEqual(emitted,[8,18]);
 h.system.currentTick=50;h.x.tick();h.x.tick();assert.deepEqual(emitted,[8,18,50]);
});

test('disabled border work is skipped and reenabling starts a fresh deadline; disabled active beam stays stopped',()=>{
 const h=setup(),r=h.people[0],emitted=[];h.system.currentTick=3;h.dims.overworld.spawnParticle=()=>emitted.push(h.system.currentTick);h.x.useReceiver(r);h.x.tick();
 h.s.config.features.borders=false;h.s.config.features.receiverBeam=false;r.location.x=6000;h.system.currentTick=8;h.x.tick();assert.equal(r.location.x,6000);
 h.s.config.features.borders=true;h.s.config.features.receiverBeam=true;h.system.currentTick=9;h.x.tick();assert.equal(r.location.x,0);assert.deepEqual(emitted,[3]);
 h.s.seconds=30;h.x.useReceiver(r);h.x.tick();assert.deepEqual(emitted,[3,9]);
 h.s.config.features.receiver=false;h.system.currentTick=14;h.x.tick();h.s.config.features.receiver=true;h.system.currentTick=19;h.x.tick();assert.deepEqual(emitted,[3,9]);
});

test('pause and round reset clear signal and restart border deadlines immediately',()=>{
 const h=setup(),r=h.people[0],emitted=[];h.system.currentTick=3;h.dims.overworld.spawnParticle=()=>emitted.push(h.system.currentTick);h.x.useReceiver(r);h.x.tick();
 h.s.phase='paused';h.system.currentTick=8;h.x.tick();h.s.phase='running';r.location.x=6000;h.system.currentTick=9;h.x.tick();assert.equal(r.location.x,0);assert.deepEqual(emitted,[3]);
 h.x.reset();r.location.x=6000;h.system.currentTick=10;h.x.tick();assert.equal(r.location.x,0);assert.deepEqual(emitted,[3]);
 assert.equal(h.x.useReceiver(r),true);h.x.tick();assert.deepEqual(emitted,[3,10]);
});


test('portable borders are centered on the external map start, not world origin',()=>{
 const h=setup(),r=h.people[0];h.s.worldMode='portable';h.s.start={x:20000,y:64,z:-16000};
 r.location={x:20000,y:64,z:-16000};h.x.tick();assert.equal(r.location.x,20000);
 r.location.x=25000;h.system.currentTick=10;h.x.tick();assert.equal(r.location.x,20000,'overworld edge rolls back to same-map safe position');
 r.dimension=h.dims.nether;r.location={x:2500,y:64,z:-2000};h.system.currentTick=20;h.x.tick();
 assert.equal(r.dimension.id,'minecraft:nether');r.location.x=3125;h.system.currentTick=30;h.x.tick();assert.equal(r.location.x,2500,'Nether uses start / 8');
});
test('unknown external seed never receives an invented fortress coordinate',()=>{
 const h=setup();h.s.worldMode='portable';h.s.seconds=2400;h.x.second();h.x.second();
 assert.equal(h.messages.length,1);assert.match(h.messages[0].m,/좌표가 확인되지/);assert.doesNotMatch(h.messages[0].m,/X 352/);
 assert.equal(h.s.extra.hintSent,false,'allow a later actual waypoint');
 h.s.fortressWaypoint={x:-512,z:640};h.x.second();
 assert.equal(h.s.extra.hintSent,true);assert.match(h.messages.at(-1).m,/X -512, Z 640/);
});
test('portable fortress arrival requires a registered waypoint and nearby nether brick',()=>{
 const h=setup(),r=h.people[0];h.s.worldMode='portable';r.dimension=h.dims.nether;
 r.location={x:700,y:67,z:-900};h.dims.nether.getBlock=()=>({typeId:'minecraft:nether_brick'});
 assert.equal(h.x.enteredFortress(r),false,'no waypoint means no false positive on player-built nether brick');
 h.s.fortressWaypoint={x:700,z:-900};assert.equal(h.x.enteredFortress(r),true);
 r.location.x=900;assert.equal(h.x.enteredFortress(r),false,'far from selected fortress');
 h.dims.nether.getBlock=()=>({typeId:'minecraft:stone'});r.location.x=700;assert.equal(h.x.enteredFortress(r),false);
});

test('one decorative nether brick near a waypoint is not sufficient for fortress arrival',()=>{
 const h=setup(),r=h.people[0];h.s.worldMode='portable';h.s.fortressWaypoint={x:700,z:-900};r.dimension=h.dims.nether;r.location={x:700,y:67,z:-900};
 h.dims.nether.getBlock=loc=>({typeId:loc.x===700&&loc.z===-900&&loc.y===66?'minecraft:nether_brick':'minecraft:air'});
 assert.equal(h.x.enteredFortress(r),false);
});

test('external world detects explored natural fortress and reveals it only at the normal 40-minute trigger',()=>{
 const h=setup(),hunter=h.people[1];h.s.worldMode='portable';hunter.dimension=h.dims.nether;
 hunter.location={x:700,y:65,z:-900};
 h.dims.nether.getBlock=()=>({typeId:'minecraft:nether_brick'});
 const mob={cause:'Spawned',entity:{typeId:'minecraft:wither_skeleton',dimension:h.dims.nether,location:{x:703,y:65,z:-898}}};
 assert.equal(h.x.entitySpawned(mob),true);assert.equal(h.s.autoFortresses.length,1);
 assert.equal(h.messages.length,0,'no runner coordinates before hint eligibility');
 assert.equal(h.x.entitySpawned(mob),false,'no duplication within 96 blocks');
 h.s.seconds=2400;h.x.second();
 assert.equal(h.messages.length,1);assert.equal(h.messages[0].name,'R');
 assert.match(h.messages[0].m,/X 703, Z -898/);assert.match(h.messages[0].m,/자동 추정/);
 h.x.second();assert.equal(h.messages.length,1);
});
test('pending hunter-first hint is issued to runner after automatic detection, never leaked to hunters',()=>{
 const h=setup(),hunter=h.people[1];h.s.worldMode='portable';
 h.x.dimensionChanged({player:hunter,toDimension:h.dims.nether});
 assert.equal(h.messages.length,1);assert.equal(h.messages[0].name,'R');
 hunter.dimension=h.dims.nether;hunter.location={x:900,y:65,z:900};
 h.dims.nether.getBlock=()=>({typeId:'minecraft:nether_brick'});
 assert.equal(h.x.entitySpawned({cause:'Spawned',entity:{typeId:'minecraft:wither_skeleton',dimension:h.dims.nether,location:{x:901,y:65,z:904}}}),true);
 assert.equal(h.messages.length,2);assert(h.messages.every(m=>m.name==='R'));assert.match(h.messages[1].m,/X 901, Z 904/);
});
test('auto-detection ignores spawned mobs, unloaded surfaces, disabled setting and original seeded worlds',()=>{
 for(const variant of ['not-natural','wrong-dimension','no-bricks','toggle-off','original']){
  const h=setup(),hunter=h.people[1];h.s.worldMode=variant==='original'?'classic':'portable';
  hunter.dimension=h.dims.nether;hunter.location={x:100,y:64,z:100};
  h.dims.nether.getBlock=()=>({typeId:variant==='no-bricks'?'minecraft:air':'minecraft:nether_brick'});
  if(variant==='toggle-off')h.s.config.features.fortressAuto=false;
  const cause=variant==='not-natural'?'Event':'Spawned',dimension=variant==='wrong-dimension'?h.dims.overworld:h.dims.nether;
  assert.equal(h.x.entitySpawned({cause,entity:{typeId:'minecraft:wither_skeleton',dimension,location:{x:101,y:64,z:99}}}),false,variant);
  assert.equal(h.s.autoFortresses.length,0);
 }
});
test('manually entered fortress waypoint always overrides exploratory automatic hint',()=>{
 const h=setup();h.s.worldMode='portable';h.s.seconds=2400;h.s.autoFortresses=[{x:201,z:202}];h.s.fortressWaypoint={x:-100,z:-80};
 h.x.second();assert.match(h.messages[0].m,/X -100, Z -80/);
 assert.doesNotMatch(h.messages[0].m,/X 201/);
});

test('turning off automatic discovery suppresses stored automatic coordinate hints but preserves manual hints',()=>{
 const h=setup();h.s.worldMode='portable';h.s.seconds=2400;
 h.s.autoFortresses=[{x:610,z:710}];h.s.config.features.fortressAuto=false;
 h.x.second();assert.equal(h.s.extra.hintSent,false);assert.doesNotMatch(h.messages[0].m,/X 610/);
 h.s.fortressWaypoint={x:220,z:-330};h.x.second();
 assert.equal(h.s.extra.hintSent,true);assert.match(h.messages.at(-1).m,/X 220, Z -330/);
});
