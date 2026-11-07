import test from 'node:test';
import assert from 'node:assert/strict';
import {createSummon,SUMMON_ITEM,newSummonState,outsideRunner,safeSummonSpot,planSummonSpots} from '../BP/scripts/summon.js';

function setup(){
 const s={phase:'running',round:1,seconds:1200,runner:'R',roster:['R','A','B','C'],config:{features:{summon:true},summonDistance:350,summonCooldownSeconds:300,summonMaxUses:2,summonSound:true},summon:newSummonState(1)};
 const messages=[],errors=[],saved=[];let reads=0;
 const dims=Object.fromEntries(['overworld','nether','the_end'].map(n=>['minecraft:'+n,{id:'minecraft:'+n,heightRange:{min:-64,max:320},getBlock(p){reads++;return p.y<64?{typeId:'minecraft:stone',isAir:false,isWaterlogged:false}:{typeId:'minecraft:air',isAir:true};}}]));
 class Item{
  constructor(typeId=SUMMON_ITEM,amount=1){this.typeId=typeId;this.amount=amount;this.props={};this.lore=[];}
  clone(){const i=new Item(this.typeId,this.amount);i.props={...this.props};i.lore=[...this.lore];i.nameTag=this.nameTag;return i;}
  getLore(){return this.lore;}setLore(l){this.lore=l;}getDynamicProperty(k){return this.props[k];}setDynamicProperty(k,v){if(v===undefined)delete this.props[k];else this.props[k]=v;}
 }
 const people=s.roster.map((name,i)=>{
  const p={name,id:name,dead:false,dimension:dims['minecraft:overworld'],location:{x:i?400+i*20:0,y:64,z:0},selectedSlotIndex:0,items:Array(36),moves:[],sounds:[],
   getRotation:()=>({x:0,y:37}),playSound(id){p.sounds.push(id);},tryTeleport(to,opts){p.moves.push({to:{...to},dimension:opts.dimension.id,options:opts});p.location={...to};p.dimension=opts.dimension;return true;}};
  p.items[0]=new Item();p.inv={size:36,getItem:i=>p.items[i]?.clone(),setItem:(i,item)=>p.items[i]=item?.clone()};return p;
 });
 const world={getAllPlayers:()=>people,getDimension:id=>dims[id.startsWith('minecraft:')?id:'minecraft:'+id]},system={currentTick:0};
 let saveHook=()=>{};
 const hooks={tell:(p,m)=>messages.push({name:p.name,m}),report:(where,e)=>errors.push({where,e:String(e)}),save:()=>{saveHook();saved.push(JSON.parse(JSON.stringify(s)));},inventory:p=>p.inv,isDead:p=>p.dead,isAdmin:p=>p.name==='A'};
 const x=createSummon(world,system,()=>s,hooks);
 return {s,x,world,system,hooks,people,dims,messages,errors,saved,Item,setSaveHook:fn=>saveHook=fn,get reads(){return reads;}};
}

test('summon moves every same-dimension hunter to separate safe spots, consumes once and records team limits',()=>{
 const h=setup(),[r,a,b,c]=h.people;assert.equal(h.x.use(a),true);
 assert.equal(b.moves.length,1);assert.equal(c.moves.length,1);assert.equal(a.moves.length,0);assert.equal(r.moves.length,0);
 assert.notDeepEqual(b.location,c.location);assert(Math.hypot(b.location.x-c.location.x,b.location.z-c.location.z)>=1.3);
 assert.equal(a.items[0],undefined);assert.equal(h.s.summon.uses,1);assert.equal(h.s.summon.readyAt,1500);assert.equal(h.s.summon.transaction,null);
 assert.equal(h.x.use(a),false);assert.equal(h.s.summon.uses,1);assert.equal(b.moves.length,1);assert.equal(h.errors.length,0);
});
test('summon is restricted to living roster hunters during running phase and can be disabled without block reads',()=>{
 for(const change of [h=>h.s.config.features.summon=false,h=>h.s.phase='grace',h=>h.s.phase='lobby',h=>h.s.phase='ended',h=>h.s.phase='paused',h=>h.people[1].dead=true,h=>h.s.roster=['R','B','C']]){
  const h=setup();change(h);assert.equal(h.x.use(h.people[1]),false);assert.equal(h.reads,0);assert.equal(h.people[1].items[0].typeId,SUMMON_ITEM);
 }
 const h=setup();assert.equal(h.x.use(h.people[0]),false);assert.equal(h.reads,0);
});
test('same-dimension 350 blocks inclusive is blocked, including vertical distance; greater than 350 is allowed',()=>{
 const h=setup(),r=h.people[0];for(const p of [{x:350,y:64,z:0},{x:0,y:414,z:0},{x:210,y:344,z:0}])assert.equal(outsideRunner(p,r.dimension.id,r,350),false);
 assert.equal(outsideRunner({x:350.001,y:64,z:0},r.dimension.id,r,350),true);
 h.people[1].location={x:350,y:64,z:0};assert.equal(h.x.use(h.people[1]),false);assert.equal(h.reads,0);
 h.system.currentTick++;h.people[1].location.x=350.1;assert.equal(h.x.use(h.people[1]),true);
 for(const p of h.people.slice(2))assert(Math.hypot(p.location.x,p.location.z)>350);
});
test('a runner in another dimension does not constrain summon range',()=>{
 const h=setup();h.people[0].dimension=h.dims['minecraft:nether'];h.people[0].location={...h.people[1].location};assert.equal(h.x.use(h.people[1]),true);
});
test('other-dimensional hunters receive information only; dead hunters are not teleported',()=>{
 const h=setup();h.people[3].dimension=h.dims['minecraft:nether'];assert.equal(h.x.use(h.people[1]),true);assert.equal(h.people[3].moves.length,0);assert(h.messages.some(m=>m.name==='C'&&m.m.includes('다른 차원')));
 const g=setup();g.people[3].dead=true;assert.equal(g.x.use(g.people[1]),true);assert.equal(g.people[3].moves.length,0);
});
test('no same-dimension target cancels without consumption while informing other-dimension teammates',()=>{
 const h=setup();for(const p of h.people.slice(2))p.dimension=h.dims['minecraft:nether'];assert.equal(h.x.use(h.people[1]),false);assert(h.people[1].items[0]);assert.equal(h.s.summon.uses,0);assert.equal(h.messages.filter(m=>['B','C'].includes(m.name)).length,2);
});
test('missing runner fails closed instead of teleporting toward stale information',()=>{
 const h=setup();h.people.shift();assert.equal(h.x.use(h.people[0]),false);assert.equal(h.reads,0);
});
test('unsafe floor, cramped space, unrecognized blocks, lava adjacency and unloaded chunks are rejected',()=>{
 for(const type of ['minecraft:lava','minecraft:sand','minecraft:oak_slab','addon:unknown']){
  const h=setup(),d=h.dims['minecraft:overworld'];d.getBlock=p=>p.y<64?{typeId:type,isAir:false}:{typeId:'minecraft:air',isAir:true};assert.equal(h.x.use(h.people[1]),false);assert(h.people[1].items[0]);assert.equal(h.people[2].moves.length,0);
 }
 const h=setup(),d=h.dims['minecraft:overworld'];d.getBlock=()=>({typeId:'minecraft:stone',isAir:false});assert(!safeSummonSpot(d,{x:420.5,y:64,z:.5}));
 d.getBlock=()=>{throw Error('unloaded');};assert(!safeSummonSpot(d,{x:420.5,y:64,z:.5}));
 d.getBlock=p=>p.y<64?{typeId:'minecraft:stone'}:p.x===421?{typeId:'minecraft:lava',isAir:false}:{typeId:'minecraft:air',isAir:true};assert(!safeSummonSpot(d,{x:420.5,y:64,z:.5}));
});
test('cliff edge support, world boundary and occupied locations fail safety checks',()=>{
 const h=setup(),d=h.dims['minecraft:overworld'];assert(!safeSummonSpot(d,{x:4999.5,y:64,z:0}));assert(!safeSummonSpot(d,{x:0,y:320,z:0}));assert(!safeSummonSpot(d,{x:0,y:64,z:0},[{x:.2,y:64,z:.2}]));
 d.getBlock=p=>p.y<64&&p.x!==1?{typeId:'minecraft:stone'}:{typeId:'minecraft:air',isAir:true};assert(!safeSummonSpot(d,{x:0,y:64,z:0}));
});
test('all destinations are checked before moving anyone; enough safe locations required',()=>{
 const h=setup(),a=h.people[1];h.dims['minecraft:overworld'].getBlock=p=>p.y<64?{typeId:'minecraft:stone'}:{typeId:'minecraft:stone',isAir:false};assert.equal(planSummonSpots(a,2,h.people[0],350),null);assert.equal(h.x.use(a),false);assert.equal(h.people.slice(2).reduce((n,p)=>n+p.moves.length,0),0);
});
test('partial teleport failure rolls everyone back and preserves original named item',()=>{
 const h=setup(),a=h.people[1],b=h.people[2],c=h.people[3],startB={...b.location},startC={...c.location};a.items[0].nameTag='우리 소집서';a.items[0].setLore(['보관']);const normal=c.tryTeleport;let first=true;c.tryTeleport=(to,opts)=>{if(first){first=false;return false;}return normal(to,opts);};
 assert.equal(h.x.use(a),false);assert.deepEqual(b.location,startB);assert.deepEqual(c.location,startC);assert.equal(a.items[0].nameTag,'우리 소집서');assert.deepEqual(a.items[0].getLore(),['보관']);assert.equal(a.items[0].getDynamicProperty('mh:summon_receipt'),undefined);assert.equal(h.s.summon.uses,0);assert.equal(h.s.summon.transaction,null);
});
test('runner moving inside forbidden radius immediately before or during teleport cancels and rolls back',()=>{
 const h=setup(),a=h.people[1],b=h.people[2],start={...b.location};h.setSaveHook(()=>{h.people[0].location={...a.location};});assert.equal(h.x.use(a),false);assert.deepEqual(b.location,start);assert(h.people[1].items[0]);
 const g=setup(),gb=g.people[2],gs={...gb.location},normal=gb.tryTeleport;let first=true;gb.tryTeleport=(to,opts)=>{const result=normal(to,opts);if(first){first=false;g.people[0].location={...g.people[1].location};}return result;};assert.equal(g.x.use(g.people[1]),false);assert.deepEqual(gb.location,gs);assert(g.people[1].items[0]);
});
test('transaction save failure before movement preserves item and allows a later clean retry',()=>{
 const h=setup();let first=true;h.setSaveHook(()=>{if(first){first=false;throw Error('save failed');}});assert.equal(h.x.use(h.people[1]),false);assert(h.people[1].items[0]);assert.equal(h.s.summon.uses,0);h.system.currentTick++;assert.equal(h.x.use(h.people[1]),true);
});
test('final save failure refunds exact item, rolls players back and reverts counters',()=>{
 const h=setup(),a=h.people[1],b=h.people[2],origin={...b.location};let count=0;h.setSaveHook(()=>{if(++count===3)throw Error('final save failed');});assert.equal(h.x.use(a),false);assert(a.items[0]);assert.deepEqual(b.location,origin);assert.equal(h.s.summon.uses,0);assert.equal(h.s.summon.readyAt,0);
});
test('rollback failure creates durable pending recovery, blocks new use, and recovers on join',()=>{
 const h=setup(),b=h.people[2],c=h.people[3],origin={...b.location},normal=b.tryTeleport;let count=0;b.tryTeleport=(to,opts)=>{if(++count===2)return false;return normal(to,opts);};let first=true;const cn=c.tryTeleport;c.tryTeleport=(to,opts)=>{if(first){first=false;return false;}return cn(to,opts);};
 assert.equal(h.x.use(h.people[1]),false);assert(h.x.hasPending());h.system.currentTick++;assert.equal(h.x.use(h.people[1]),false);assert(h.x.joined(b));assert(!h.x.hasPending());assert.deepEqual(b.location,origin);assert(h.people[1].items[0]);
});
test('replay of committed journal consumes a uniquely marked scroll at most once',()=>{
 const h=setup(),a=h.people[1];a.items[0].setDynamicProperty('mh:summon_receipt','tx1');h.s.summon={...newSummonState(1),uses:1,readyAt:1500,transaction:{caller:'A',token:'tx1',phase:'committed',origins:[]}};assert(h.x.recover());assert.equal(a.items[0],undefined);a.items[0]=new h.Item();assert(h.x.recover());assert(a.items[0]);assert.equal(h.s.summon.uses,1);
});
test('team-wide cooldown and per-round uses survive state reload and do not depend on inventory space',()=>{
 const h=setup(),a=h.people[1],b=h.people[2];for(let i=1;i<36;i++)a.items[i]=new h.Item('minecraft:stone',64);assert(h.x.use(a));assert.equal(a.items[1].amount,64);h.system.currentTick++;assert.equal(h.x.use(b),false);h.s.seconds=1500;h.system.currentTick++;assert(h.x.use(b));h.s.summon=JSON.parse(JSON.stringify(h.s.summon));h.s.seconds=2000;h.system.currentTick++;a.items[0]=new h.Item();assert.equal(h.x.use(a),false);assert(a.items[0]);
});
test('sound option prevents sound calls; new round reset clears team counters',()=>{
 const h=setup();h.s.config.summonSound=false;assert(h.x.use(h.people[1]));assert(h.people.every(p=>p.sounds.length===0));h.s.round++;assert(h.x.reset());assert.equal(h.s.summon.uses,0);assert.equal(h.s.summon.readyAt,0);assert.equal(h.s.summon.round,2);
});
test('ambiguous refund recovery and orphan item receipts remain blocked without overwriting items',()=>{
 const h=setup(),a=h.people[1];a.items[0].setDynamicProperty('mh:summon_receipt','orphan');assert.equal(h.x.use(a),false);assert.equal(h.reads,0);assert(a.items[0]);
 h.s.summon.transaction={caller:'A',token:'orphan',phase:'refund_pending',origins:[]};assert.equal(h.x.recover(),false);assert(h.x.hasPending());assert.equal(h.x.reset(),false);assert(a.items[0]);
});
test('uncommitted journal preserves absent player recovery across reconnect and prevents round reset',()=>{
 const h=setup(),b=h.people[2],origin={...b.location};h.s.summon.transaction={caller:'A',token:'tx2',phase:'moving',origins:[{name:'B',dimension:b.dimension.id,location:origin,rotation:{x:0,y:0}}]};h.people.splice(2,1);assert.equal(h.x.recover(),false);assert.equal(h.x.reset(),false);h.people.push(b);b.location.x+=10;assert(h.x.joined(b));assert.deepEqual(b.location,origin);assert.equal(h.s.summon.transaction,null);
});

function pending(h,phase='moving'){
 h.s.phase='paused';h.s.summon.transaction={caller:'A',token:'manual1',phase,participants:['B','C'],origins:[{name:'B',dimension:'minecraft:overworld',location:{x:1000,y:64,z:0},rotation:{x:0,y:0}}]};
 h.people[1].items[0].setDynamicProperty('mh:summon_receipt','manual1');return h.s.summon.transaction;
}
test('unloaded rollback can be resolved by an administrator accepting verified current positions without teleporting or minting items',()=>{
 const h=setup(),tx=pending(h),a=h.people[1];h.people[2].tryTeleport=()=>false;
 assert(!h.x.recover());assert(h.x.hasPending());const summary=h.x.pendingRecovery();assert.deepEqual(summary.names,['A','B','C']);assert.equal(summary.token,tx.token);
 assert(h.x.resolveAtCurrent(a,summary.token));assert(!h.x.hasPending());assert(h.people.every(p=>p.moves.length===0));assert(a.items[0]);assert.equal(a.items[0].getDynamicProperty('mh:summon_receipt'),undefined);
 assert.equal(h.s.summon.uses,0);assert.equal(h.s.summon.readyAt,0);assert.equal(h.s.summon.lastRecovery.administrator,'A');assert.equal(h.s.summon.lastRecovery.players.length,3);
 const audit=JSON.stringify(h.s.summon.lastRecovery);assert(h.x.reset());assert.equal(JSON.stringify(h.s.summon.lastRecovery),audit);assert(!h.x.resolveAtCurrent(a,summary.token));
});
test('manual resolution rejects non-admin, stale confirmation, active play and already committed transactions',()=>{
 const h=setup();pending(h);assert(!h.x.resolveAtCurrent(h.people[2],'manual1'));assert(!h.x.resolveAtCurrent(h.people[1],'outdated'));
 for(const phase of ['running','grace','countdown']){h.s.phase=phase;assert(!h.x.resolveAtCurrent(h.people[1],'manual1'));}
 h.s.phase='paused';h.s.summon.transaction.phase='committed';assert(!h.x.resolveAtCurrent(h.people[1],'manual1'));assert(h.x.hasPending());
 const noAdmin=createSummon(h.world,h.system,()=>h.s,{...h.hooks,isAdmin:undefined});h.s.summon.transaction.phase='moving';assert(!noAdmin.resolveAtCurrent(h.people[1],'manual1'));
});
test('manual resolution requires all known participants alive, online, inside bounds and on separate safe current ground',()=>{
 for(const change of [h=>h.people.pop(),h=>h.people[3].dead=true,h=>h.people[3].location={...h.people[1].location},h=>h.people[3].location.x=5000,h=>h.people[3].location.y=65,h=>h.dims['minecraft:overworld'].getBlock=()=>undefined]){
  const h=setup();pending(h);change(h);assert(!h.x.resolveAtCurrent(h.people[1],'manual1'));assert(h.x.hasPending());assert.equal(h.s.summon.lastRecovery,null);assert(h.people[1].items[0]);
 }
});
test('ambiguous refund manual resolution creates no replacement and does not overwrite a full inventory',()=>{
 const h=setup();pending(h,'refund_pending');const a=h.people[1];for(let i=0;i<36;i++)a.items[i]=new h.Item('minecraft:stone',64);
 const before=JSON.stringify(a.items);assert.equal(h.x.pendingRecovery().refundUncertain,true);assert(h.x.resolveAtCurrent(a,'manual1'));assert.equal(JSON.stringify(a.items),before);assert.equal(h.s.summon.lastRecovery.previousPhase,'refund_pending');assert(h.messages.some(m=>m.m.includes('자동 보상하지')));
});
test('manual resolution save failures preserve retryable journal and replay never teleports or grants a duplicate refund',()=>{
 const h=setup();pending(h);h.setSaveHook(()=>{throw Error('storage unavailable');});assert(!h.x.resolveAtCurrent(h.people[1],'manual1'));assert.equal(h.s.summon.transaction.phase,'moving');assert.equal(h.s.summon.lastRecovery,null);assert(h.people[1].items[0].getDynamicProperty('mh:summon_receipt'));
 const g=setup();pending(g);let count=0;g.setSaveHook(()=>{if(++count===2)throw Error('final save failed');});assert(!g.x.resolveAtCurrent(g.people[1],'manual1'));assert.equal(g.s.summon.transaction.phase,'manual_accepted');
 g.setSaveHook(()=>{});const reloaded=createSummon(g.world,g.system,()=>g.s,g.hooks);assert(reloaded.recover(true));assert(!reloaded.hasPending());assert(g.people.every(p=>p.moves.length===0));assert(g.people[1].items[0]);assert.equal(g.people[1].items[0].getDynamicProperty('mh:summon_receipt'),undefined);assert.equal(g.s.summon.uses,0);
});
test('automatic recovery backs off failed moves while explicit retry and join can attempt immediately',()=>{
 const h=setup();pending(h);let calls=0;h.people[2].tryTeleport=()=>{calls++;return false;};
 assert(!h.x.recover());assert.equal(calls,1);h.system.currentTick=20;assert(!h.x.recover());assert.equal(calls,1);h.system.currentTick=100;assert(!h.x.recover());assert.equal(calls,2);
 assert(!h.x.recover(true));assert.equal(calls,3);assert(!h.x.joined(h.people[2]));assert.equal(calls,4);
});
