import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunnerRules,hunterKilledRunner,proximityDistances,wildRespawnBudget,wildRespawnsRemaining} from '../BP/scripts/runner.js';
import {createRunnerSpecial,REVIVE_ITEM} from '../BP/scripts/runner-special.js';

function fixture(){
 let tick=0,lookups=0,saves=0,failSave=false,failDebit=false,saveHook=()=>{},inventoryHook=()=>{};const snapshots=[];
 const state={phase:'running',round:1,runner:'Runner',roster:['Runner','Hunter1','Hunter2'],runnerRespawns:0,runnerLifeBonus:0,config:{features:{},proximityDistances:[90,60,40,10],proximitySound:true,proximityCooldownSeconds:10,wildRespawnBase:2,wildRespawnMax:3}};
 const dim={id:'minecraft:overworld'};
 const player=name=>({name,id:name,typeId:'minecraft:player',dimension:dim,location:{x:0,y:64,z:0},selectedSlotIndex:0,health:40,isValid:true,messages:[],sounds:[],getComponent(id){return id==='minecraft:health'?{currentValue:this.health}:undefined;},playSound(...a){this.sounds.push(a);}});
 const r=player('Runner'),a=player('Hunter1'),b=player('Hunter2'),players=[r,a,b],dead=new Set();
 a.location.x=1000;b.location.x=1000;
 const errors=[];let slot;
 class Stack{constructor(){this.typeId=REVIVE_ITEM;this.amount=1;this.props={};this.lore=[];}clone(){const copy=new Stack();Object.assign(copy,structuredClone({...this}));return copy;}getDynamicProperty(k){return this.props[k];}setDynamicProperty(k,v){if(v===undefined)delete this.props[k];else this.props[k]=v;}getLore(){return this.lore;}setLore(v){this.lore=v;}}
 function stack(){return new Stack();}
 const inv={size:1,getItem:()=>slot?.clone?.()??slot,setItem:(i,v)=>{inventoryHook(v);if(failDebit){failDebit=false;throw Error('debit failure');}slot=v?.clone();}};
 const world={getAllPlayers(){lookups++;return players;}},system={get currentTick(){return tick;},run:fn=>fn()};
 const callbacks={tell:(p,m)=>p.messages.push(m),report:(w,e)=>errors.push([w,e]),isDead:p=>dead.has(p.name),inventory:p=>p===r?inv:{size:0,getItem(){},setItem(){}},isAdmin:p=>p.name==='Hunter1',save:()=>{saves++;saveHook();if(failSave){failSave=false;throw Error('save failure');}snapshots.push(JSON.parse(JSON.stringify(state)));}};
 const rules=createRunnerRules(world,system,()=>state,callbacks),special=createRunnerSpecial(world,system,()=>state,callbacks);
 return {state,r,a,b,players,dead,rules,special,errors,stack,world,system,callbacks,snapshots,get slot(){return slot;},set slot(v){slot=v;},get tick(){return tick;},advance(n=200){tick+=n;},get lookups(){return lookups;},get saves(){return saves;},failSave(){failSave=true;},failDebit(){failDebit=true;},setSaveHook:fn=>saveHook=fn,setInventoryHook:fn=>inventoryHook=fn};
}

test('v1.5 nearest hunter crosses the four inclusive 3D boundaries privately',()=>{
 const h=fixture();h.b.location.x=400;
 for(const [n,d] of [90,60,40,10].entries()){h.a.location={x:0,y:64+d,z:0};h.rules.tick();assert.equal(h.r.messages.length,n+1);assert.match(h.r.messages[n],new RegExp(`${d}블록`));}
 assert.equal(h.r.sounds.length,4);assert.equal(h.a.messages.length,0);assert.equal(h.b.messages.length,0);
});
test('v1.5 jump into nearest danger produces only the most urgent warning',()=>{
 const h=fixture();h.a.location.x=59;h.b.location.x=8;h.rules.tick();assert.equal(h.r.messages.length,1);assert.match(h.r.messages[0],/긴급/);
 for(let i=0;i<30;i++){h.advance();h.rules.tick();}assert.equal(h.r.messages.length,1,'continuous presence is not repeated entry');
});
test('v1.5 dead, nonroster and different-dimension hunters are excluded',()=>{
 const h=fixture();h.a.location.x=1;h.a.dimension={id:'minecraft:nether'};h.b.location.x=1;h.dead.add(h.b.name);h.players.push({...h.a,name:'Visitor',dimension:h.r.dimension});h.rules.tick();assert.equal(h.r.messages.length,0);
 h.b.location={x:0,y:155,z:0};h.dead.clear();h.rules.tick();assert.equal(h.r.messages.length,0,'vertical distance counted');
});
test('v1.5 hysteresis avoids jitter at boundary and cooldown is separate from band state',()=>{
 const h=fixture();h.a.location.x=10;h.rules.tick();
 for(const d of [10.1,9.9,11.9,10]){h.a.location.x=d;h.advance(20);h.rules.tick();}
 assert.equal(h.r.messages.length,1);
 h.a.location.x=12.1;h.rules.tick();h.a.location.x=10;h.rules.tick();assert.equal(h.r.messages.length,1,'re-entry within cooldown held');
 h.advance(120);h.rules.tick();assert.equal(h.r.messages.length,2,'pending entry delivered once after cooldown');h.rules.tick();assert.equal(h.r.messages.length,2);
});
test('v1.5 each band has its own cooldown; outward movement is silent',()=>{
 const h=fixture();h.a.location.x=10;h.rules.tick();h.a.location.x=100;h.rules.tick();h.a.location.x=90;h.rules.tick();assert.equal(h.r.messages.length,2);h.a.location.x=60;h.rules.tick();assert.equal(h.r.messages.length,3);
});
test('v1.5 warning OFF skips player lookup; sound can be independently disabled',()=>{
 const h=fixture();h.state.config.features.proximityWarning=false;h.rules.tick();assert.equal(h.lookups,0);h.state.config.features.proximityWarning=true;h.state.config.proximitySound=false;h.a.location.x=10;h.rules.tick();assert.equal(h.r.messages.length,1);assert.equal(h.r.sounds.length,0);
});
test('v1.5 paused warning does not calculate positions or repeat unchanged alert on resume',()=>{
 const h=fixture();h.a.location.x=40;h.rules.tick();const lookups=h.lookups;h.state.phase='paused';h.advance();h.rules.tick();assert.equal(h.lookups,lookups);h.state.phase='running';h.rules.tick();assert.equal(h.r.messages.length,1);h.state.round++;h.rules.tick();assert.equal(h.r.messages.length,2);
});
test('v1.5 custom warning distances are honored and malformed settings fall back',()=>{
 const h=fixture();h.state.config.proximityDistances=[80,50,30,5];h.a.location.x=5;h.rules.tick();assert.match(h.r.messages[0],/5블록/);assert.deepEqual(proximityDistances({proximityDistances:[10,20,30,40]}),[90,60,40,10]);
});
test('v1.5 wild budget starts at two; bonus and spent respawns share one persisted state',()=>{
 const h=fixture();assert.equal(wildRespawnBudget(h.state),2);h.state.runnerRespawns=2;assert.equal(wildRespawnsRemaining(h.state),0);h.state.runnerLifeBonus=1;assert.equal(wildRespawnsRemaining(h.state),1);const reloaded=JSON.parse(JSON.stringify(h.state));assert.equal(wildRespawnBudget(reloaded),3);assert.equal(wildRespawnsRemaining(reloaded),1);h.state.runnerLifeBonus=99;assert.equal(wildRespawnBudget(h.state),3);h.state.config.features.wildRespawns=false;assert.equal(wildRespawnsRemaining(h.state),0);
});
test('v1.5 lethal player attribution accepts only roster hunters including projectiles',()=>{
 const h=fixture();assert.equal(hunterKilledRunner(h.state,{damagingEntity:h.a}),true);assert.equal(hunterKilledRunner(h.state,{damagingProjectile:{getComponent:()=>({owner:h.b})}}),true);
 for(const attacker of [h.r,{...h.a,name:'Visitor'},{typeId:'minecraft:zombie',getComponent(){}}])assert.equal(hunterKilledRunner(h.state,{damagingEntity:attacker}),false);
 assert.equal(hunterKilledRunner(h.state,{cause:'fall'}),false);
});
test('v1.5 departed attacker with unavailable native name uses cached identity without granting outsiders a hunter kill',()=>{
 const h=fixture(),known=new Map([['hunter-id','Hunter1'],['visitor-id','Visitor']]);
 const unavailable=id=>({typeId:'minecraft:player',id,get name(){throw Error('InvalidEntityError: player has left');}});
 assert.equal(hunterKilledRunner(h.state,{damagingEntity:unavailable('hunter-id')},known),true);
 assert.equal(hunterKilledRunner(h.state,{damagingProjectile:{getComponent:()=>({owner:unavailable('hunter-id')})}},known),true);
 assert.equal(hunterKilledRunner(h.state,{damagingEntity:unavailable('unknown-id')},known),false);
 assert.equal(hunterKilledRunner(h.state,{damagingEntity:unavailable('visitor-id')},known),false);
 const invalidId={typeId:'minecraft:player',get id(){throw Error('InvalidEntityError');},get name(){throw Error('InvalidEntityError');}};
 assert.equal(hunterKilledRunner(h.state,{damagingEntity:invalidId},known),false);
});
test('v1.5 revive consumes exactly one held item and grants one persistent bonus',()=>{
 const h=fixture();h.slot=h.stack();assert.equal(h.special.useRevive(h.r),true);assert.equal(h.slot,undefined);assert.equal(h.state.runnerLifeBonus,1);assert.equal(wildRespawnsRemaining(h.state),3);assert.equal(h.state.revivePending,null);assert.equal(h.snapshots.at(-1).runnerLifeBonus,1);h.slot=h.stack();assert.equal(h.special.useRevive(h.r),false);assert.equal(h.slot.amount,1);h.advance();assert.equal(h.special.useRevive(h.r),false,'total cap remains after cooldown');assert.equal(h.slot.amount,1);
});
test('v1.5 consuming earned respawns does not reopen total budget item cap',()=>{
 const h=fixture();h.state.runnerRespawns=2;h.slot=h.stack();assert.equal(h.special.useRevive(h.r),true);assert.equal(wildRespawnsRemaining(h.state),1);h.advance();h.state.runnerRespawns=3;h.slot=h.stack();assert.equal(h.special.useRevive(h.r),false);assert.equal(h.slot.amount,1);
});
test('v1.5 revive denies hunter, outsider, inactive, dying and dead users without consuming',()=>{
 const h=fixture();h.slot=h.stack();assert.equal(h.special.useRevive(h.a),false);assert.equal(h.special.useRevive({...h.r,name:'Visitor'}),false);
 for(const phase of ['lobby','countdown','paused','ended']){h.state.phase=phase;assert.equal(h.special.useRevive(h.r),false);}
 h.state.phase='running';h.r.health=0;assert.equal(h.special.useRevive(h.r),false);h.r.health=40;h.dead.add(h.r.name);assert.equal(h.special.useRevive(h.r),false);h.dead.clear();h.state.runnerRespawning=true;assert.equal(h.special.useRevive(h.r),false);assert.equal(h.slot.amount,1);assert.equal(h.saves,0);
});
test('v1.5 revive OFF or wild respawns OFF cannot consume item',()=>{
 const h=fixture();h.slot=h.stack();h.state.config.features.reviveItem=false;assert.equal(h.special.useRevive(h.r),false);h.state.config.features.reviveItem=true;h.state.config.features.wildRespawns=false;assert.equal(h.special.useRevive(h.r),false);assert.equal(h.slot.amount,1);
});
test('v1.5 revive duplicate callbacks cannot consume second item under a larger configured cap',()=>{
 const h=fixture();h.state.config.wildRespawnMax=5;h.slot=h.stack();h.special.useRevive(h.r);h.slot=h.stack();h.special.useRevive(h.r);assert.equal(h.state.runnerLifeBonus,1);assert.equal(h.slot.amount,1);h.advance(5);h.special.useRevive(h.r);assert.equal(h.state.runnerLifeBonus,2);assert.equal(h.slot,undefined);
});
test('v1.5 revive persistence failure restores exact selected item and previous budget',()=>{
 const h=fixture();const original=h.stack();original.nameTag='Original';original.setLore(['retain']);original.setDynamicProperty('custom:data','preserve');h.slot=original;h.failSave();assert.equal(h.special.useRevive(h.r),false);assert.deepEqual(h.slot,original);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.errors.length,1);assert.equal(h.special.useRevive(h.r),true,'failed transaction does not consume use permission');
});
test('v1.5 revive inventory failure leaves bonus unchanged and reports the failure',()=>{
 const h=fixture();h.slot=h.stack();h.failDebit();assert.equal(h.special.useRevive(h.r),false);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.slot.amount,1);assert.equal(h.errors.length,1);
});
test('v1.5 revive validates current slot instead of trusting a stale event ItemStack',()=>{
 const h=fixture();h.slot={typeId:'minecraft:totem_of_undying',amount:1};assert.equal(h.special.useRevive(h.r),false);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.slot.typeId,'minecraft:totem_of_undying');
});

function journal(h,phase='debit'){return {token:'test-revive-receipt',round:h.state.round,runner:h.r.name,slot:0,phase,bonusBefore:0,bonusAfter:1};}
function marked(h,tx){const item=h.stack();item.nameTag='Preserved';item.setLore(['Original lore']);item.setDynamicProperty('custom:data',7);item.setDynamicProperty('mh:revive_receipt',tx.token);return item;}
function reloadSpecial(h){h.special=createRunnerSpecial(h.world,h.system,()=>h.state,h.callbacks);}

test('v1.5 each revive persistence phase can fail without losing item or granting bonus',()=>{
 for(const failAt of [1,2,3,4]){const h=fixture(),original=h.stack();original.nameTag='No loss';h.slot=original;let calls=0;h.setSaveHook(()=>{if(++calls===failAt)throw Error('targeted save failure');});
  assert.equal(h.special.useRevive(h.r),false,`save ${failAt}`);assert.deepEqual(h.slot,original);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.state.revivePending,null);assert.equal(h.special.hasPending(),false);
 }
});
test('v1.5 failed debit persistence plus failed refund keeps an unresolved durable journal and blocks reuse/reset',()=>{
 const h=fixture();h.state.host='Hunter1';h.slot=h.stack();let failCommit=true,failRefund=true;
 h.setSaveHook(()=>{if(h.state.revivePending?.phase==='committed'&&failCommit){failCommit=false;throw Error('commit persistence failure');}});
 h.setInventoryHook(item=>{if(item&&h.state.revivePending?.phase==='rollback'&&failRefund){failRefund=false;throw Error('refund unavailable');}});
 assert.equal(h.special.useRevive(h.r),false);assert.equal(h.slot,undefined);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.state.revivePending.phase,'rollback');assert.equal(h.snapshots.at(-1).revivePending.phase,'rollback');
 const stored=JSON.parse(JSON.stringify(h.state.revivePending));reloadSpecial(h);assert.equal(h.special.recover(),false);assert.equal(h.special.reset(),false);assert.deepEqual(h.state.revivePending,stored);assert.equal(h.state.runnerLifeBonus,0);
 h.slot=h.stack();assert.equal(h.special.useRevive(h.r),false,'a fresh unmarked item does not erase the uncertain debit');assert.equal(h.slot.amount,1);assert.equal(h.state.runnerLifeBonus,0);
 const notices=h.r.messages.length;h.special.recover();h.special.recover();assert.equal(h.r.messages.length,notices,'pending notification is not spammed');assert.ok(h.a.messages.some(m=>m.includes('복구 대기')),'host receives recovery notice');
});
test('v1.5 a surviving unique receipt safely rolls back interrupted debit after restart and preserves metadata',()=>{
 for(const phase of ['debit','rollback']){const h=fixture(),tx=journal(h,phase);h.state.revivePending=tx;h.slot=marked(h,tx);reloadSpecial(h);
  assert.equal(h.special.recover(),true);assert.equal(h.state.revivePending,null);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.slot.nameTag,'Preserved');assert.deepEqual(h.slot.getLore(),['Original lore']);assert.equal(h.slot.getDynamicProperty('custom:data'),7);assert.equal(h.slot.getDynamicProperty('mh:revive_receipt'),undefined);assert.equal(h.special.recover(),true);
 }
});
test('v1.5 prepared or confirmed-refunded journals clear without manufacturing absent items',()=>{
 for(const phase of ['prepared','restored'])for(const present of [false,true]){const h=fixture(),tx=journal(h,phase);h.state.revivePending=tx;if(present)h.slot=marked(h,tx);reloadSpecial(h);
  assert.equal(h.special.recover(),true);assert.equal(h.state.revivePending,null);assert.equal(!!h.slot,present);assert.equal(h.state.runnerLifeBonus,0);if(present)assert.equal(h.slot.getDynamicProperty('mh:revive_receipt'),undefined);
 }
});
test('v1.5 a committed revive journal applies the same bonus once and consumes any surviving receipt once',()=>{
 for(const present of [false,true]){const h=fixture(),tx=journal(h,'committed');h.state.revivePending=tx;h.state.runnerLifeBonus=1;h.state.config.wildRespawnMax=5;if(present)h.slot=marked(h,tx);reloadSpecial(h);
  assert.equal(h.special.recover(),true);assert.equal(h.state.runnerLifeBonus,1);assert.equal(h.slot,undefined);assert.equal(h.state.revivePending,null);assert.equal(h.special.recover(),true);assert.equal(h.state.runnerLifeBonus,1);
  h.slot=h.stack();assert.equal(h.special.useRevive(h.r),false,'recovered commit participates in duplicate-action guard');h.advance(5);assert.equal(h.special.useRevive(h.r),true);assert.equal(h.state.runnerLifeBonus,2);
 }
});
test('v1.5 unresolved revive keeps its journal while runner is offline/dead and resumes when receipt is available',()=>{
 const h=fixture(),tx=journal(h);h.state.revivePending=tx;h.slot=marked(h,tx);h.players.shift();assert.equal(h.special.recover(),false);assert.equal(h.special.hasPending(),true);h.players.unshift(h.r);h.dead.add(h.r.name);assert.equal(h.special.recover(),false);h.dead.clear();h.state.config.features.reviveItem=false;assert.equal(h.special.joined(),true,'recovery must remain possible when feature was disabled');assert.equal(h.slot.getDynamicProperty('mh:revive_receipt'),undefined);assert.equal(h.state.revivePending,null);
});
test('v1.5 malformed, duplicate and unknown revive receipts remain blocked without deleting possessions',()=>{
 for(const mutate of [tx=>tx.round++,tx=>tx.bonusAfter=10,tx=>tx.phase='unknown']){const h=fixture(),tx=journal(h);mutate(tx);h.state.revivePending=tx;h.slot=marked(h,tx);assert.equal(h.special.recover(),false);assert.equal(h.special.hasPending(),true);assert.equal(h.slot.amount,1);assert.equal(h.state.runnerLifeBonus,0);}
 const h=fixture(),tx=journal(h);h.state.revivePending=tx;const items=[marked(h,tx),marked(h,tx)];h.special=createRunnerSpecial(h.world,h.system,()=>h.state,{...h.callbacks,inventory:()=>({size:2,getItem:i=>items[i].clone(),setItem(){throw Error('must not delete ambiguous duplicates');}})});assert.equal(h.special.recover(),false);assert.equal(items.length,2);assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.special.hasPending(),true);
});
test('v1.5 recovery persistence failure retains its journal until completion can be saved',()=>{
 const h=fixture(),tx=journal(h,'restored');h.state.revivePending=tx;h.slot=marked(h,tx);h.failSave();assert.equal(h.special.recover(),false);assert.equal(h.state.revivePending,tx);assert.equal(h.slot.getDynamicProperty('mh:revive_receipt'),undefined);assert.equal(h.special.recover(),true);assert.equal(h.state.revivePending,null);assert.equal(h.slot.amount,1);
});

test('v1.5 only an administrator can explicitly resolve an uncertain revive while the round is stopped',()=>{
 const h=fixture(),tx=journal(h);h.state.revivePending=tx;
 assert.equal(h.special.resolvePending(h.a,true,tx.token),false,'running match');h.state.phase='paused';assert.equal(h.special.resolvePending(h.r,true,tx.token),false,'runner is not administrator');assert.equal(h.special.resolvePending(h.a,true,'stale-token'),false);assert.equal(h.special.resolvePending(h.a,'true',tx.token),false);
 h.players.shift();assert.equal(h.special.resolvePending(h.a,true,tx.token),false,'runner offline');h.players.unshift(h.r);h.dead.add(h.r.name);assert.equal(h.special.resolvePending(h.a,true,tx.token),false,'runner dead');h.dead.clear();
 assert.equal(h.special.resolvePending(h.a,true,tx.token),true);assert.equal(h.state.runnerLifeBonus,1);assert.equal(h.state.revivePending,null);assert.equal(h.slot,undefined,'manual confirmation never manufactures an item');assert.equal(h.special.resolvePending(h.a,true,tx.token),false,'same token cannot apply twice');assert.equal(h.state.runnerLifeBonus,1);
});
test('v1.5 administrator cancellation preserves any surviving receipt without auto-refunding missing items',()=>{
 for(const present of [false,true]){const h=fixture(),tx=journal(h,'rollback');h.state.phase='ended';h.state.revivePending=tx;if(present)h.slot=marked(h,tx);
  assert.equal(h.special.resolvePending(h.a,false,tx.token),true);assert.equal(h.state.runnerLifeBonus,0);assert.equal(!!h.slot,present);assert.equal(h.state.revivePending,null);if(present)assert.equal(h.slot.getDynamicProperty('mh:revive_receipt'),undefined);
 }
});
test('v1.5 manual consumed confirmation rejects surviving, transferred or duplicate receipt items',()=>{
 const h=fixture(),tx=journal(h);h.state.phase='paused';h.state.revivePending=tx;h.slot=marked(h,tx);assert.equal(h.special.resolvePending(h.a,true,tx.token),false);assert.equal(h.slot.amount,1);
 const heldByHunter=marked(h,tx);h.slot=undefined;const otherInv={size:1,getItem:()=>heldByHunter.clone(),setItem(){throw Error('must preserve other owner');}};h.special=createRunnerSpecial(h.world,h.system,()=>h.state,{...h.callbacks,inventory:p=>p===h.b?otherInv:h.callbacks.inventory(p)});
 assert.equal(h.special.resolvePending(h.a,true,tx.token),false);assert.equal(h.special.resolvePending(h.a,false,tx.token),false);assert.equal(h.state.revivePending,tx);assert.equal(h.state.runnerLifeBonus,0);
 h.slot=marked(h,tx);assert.equal(h.special.resolvePending(h.a,false,tx.token),false,'two online receipts cannot be resolved automatically');
});
test('v1.5 failed manual revive save retains uncertain state and can be retried without duplicate credit',()=>{
 const h=fixture(),tx=journal(h);h.state.phase='lobby';h.state.revivePending=tx;h.failSave();assert.equal(h.special.resolvePending(h.a,true,tx.token),false);assert.equal(h.state.revivePending.phase,'debit');assert.equal(h.state.runnerLifeBonus,0);assert.equal(h.special.resolvePending(h.a,true,tx.token),true);assert.equal(h.state.runnerLifeBonus,1);assert.equal(h.state.revivePending,null);
});
