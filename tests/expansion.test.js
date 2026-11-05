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
test('border rollback preserves safe dimension; unknown portal arrival returns to start',()=>{const h=setup(),r=h.people[0];h.x.tick();r.location.x=5000;h.x.tick();assert.equal(r.location.x,0);r.dimension=h.dims.nether;r.location.x=626;h.x.tick();assert.equal(r.dimension.id,'minecraft:overworld');assert.equal(r.location.x,0);});
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
