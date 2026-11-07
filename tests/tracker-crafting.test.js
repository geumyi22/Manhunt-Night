import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIALS,createRecipe,newTrackerCraft,recipeTimes,createTrackerCrafting} from '../BP/scripts/tracker-crafting.js';

function harness(saved){
 let id=0,tick=0,savedData,saveCount=0;const notices=[],errors=[],p1=player('Hunter1'),p2=player('Hunter2'),runner=player('Runner'),outsider=player('Visitor'),all=[runner,p1,p2,outsider];
 function player(name){const slots=Array(36);return {name,typeId:'minecraft:player',isValid:true,health:20,slots,getComponent(id){if(id==='minecraft:health')return {currentValue:this.health};},inv:{size:36,getItem:i=>slots[i],setItem:(i,item)=>slots[i]=item}};}
 let s=saved??{round:1,phase:'running',seconds:0,runner:'Runner',host:'Runner',roster:['Runner','Hunter1','Hunter2'],config:{trackerMode:'random',trackerRevealMinutes:20,trackerAutoMinutes:40,trackerAutoGive:true,features:{tracker:true}},trackerCraft:null};
 const h={failSaveAt:0,failSave:false,all,notices,errors,p1,p2,runner,outsider,get s(){return s;},get saved(){return savedData;},get saveCount(){return saveCount;},advance(n){tick+=n;}};
 const api=()=>createTrackerCrafting({getAllPlayers:()=>all},{get currentTick(){return tick;}},()=>s,{tell:(p,msg)=>notices.push({name:p.name,msg}),save(){saveCount++;if(h.failSave||h.failSaveAt===saveCount)throw Error('save failed');savedData=JSON.parse(JSON.stringify(s));},report:(where,e)=>errors.push({where,error:String(e)}),inventory:p=>p.inv,isDead:p=>p.dead===true,ItemStack:class{},makeTracker:()=>({typeId:'mh:tracker_0',amount:1})});
 h.rules=api();if(!saved)h.rules.startRound();
 h.reload=()=>{s=JSON.parse(JSON.stringify(savedData??s));h.rules=api();};
 h.entity=(itemId,amount,opts={})=>{const item={typeId:itemId,amount,getLore:()=>opts.lore??[],getDynamicPropertyIds:()=>[],getComponent:()=>undefined,...opts};const entity={typeId:'minecraft:item',id:'drop-'+(++id),isValid:true,item,removed:0,getComponent:()=>({itemStack:item}),remove(){this.removed++;if(opts.failRemove)throw Error('remove failed');this.isValid=false;}};return entity;};
 h.drop=(p,itemId,amount,opts={})=>{const entity=h.entity(itemId,amount,opts);if(!opts.old)h.rules.spawned(entity);const accepted=h.rules.drop({entity:p,items:[entity]});return {entity,accepted};};
 h.open=()=>{s.seconds=1200;h.rules.toggle(p1);h.rules.toggle(p2);};
 h.fill=(steps=9)=>{for(let i=0;i<steps;i++){const m=s.trackerCraft.recipe[s.trackerCraft.step];assert(m);const {accepted}=h.drop(i%2?p2:p1,m.id,m.amount-s.trackerCraft.amount);assert.equal(accepted,true);}};
 return h;
}

test('27 distinct Overworld candidates comprise 21 common and six difficult resources',()=>{
 assert.equal(MATERIALS.length,27);assert.equal(new Set(MATERIALS.map(m=>m.id)).size,27);assert.equal(MATERIALS.filter(m=>m.hard).length,6);assert(MATERIALS.every(m=>m.method&&m.name&&m.amount>0));
 assert(!MATERIALS.some(m=>/nether|blaze|ender|heart_of_the_sea|echo_shard/.test(m.id)));
});
test('each of 1000 recipes is nine unique resources, seven common and exactly two difficult',()=>{
 for(let n=0;n<1000;n++){const r=createRecipe({trackerRareCount:6});assert.equal(r.length,9);assert.equal(new Set(r.map(x=>x.id)).size,9);assert.equal(r.filter(x=>x.hard).length,2);assert(r.filter(x=>x.hard).every(x=>x.amount===6));}
});
test('quantities are configurable and recipes are independent frozen selections',()=>{
 const r=createRecipe({trackerRareCount:12,trackerCommonMultiplier:3},()=>0.5),old=r.map(m=>m.amount);assert(r.filter(m=>m.hard).every(m=>m.amount===12));assert(r.filter(m=>!m.hard).every(m=>m.amount===MATERIALS.find(x=>x.id===m.id).amount*3));createRecipe({trackerRareCount:1});assert.deepEqual(r.map(m=>m.amount),old);assert(newTrackerCraft(2,{}).round===2);
});
test('recipe times reject invalid and inverted input without introducing early automatic grant',()=>{
 assert.deepEqual(recipeTimes({trackerRevealMinutes:20,trackerAutoMinutes:10}),{reveal:1200,auto:1200});assert.equal(recipeTimes({trackerRevealMinutes:NaN}).reveal,1200);
});
test('recipe remains secret before 20 minutes and is never shown to runner or visitor',()=>{
 const h=harness();h.s.seconds=1199;assert.match(h.rules.describe(h.p1),/비공개/);assert.equal(h.rules.toggle(h.p1),false);h.s.seconds=1200;assert.match(h.rules.describe(h.p1),/1\./);assert.equal(h.rules.describe(h.runner),'헌터 전용 제작 정보입니다.');assert.equal(h.rules.describe(h.outsider),'헌터 전용 제작 정보입니다.');
});
test('20 minute notification goes only to hunters and once per hunter',()=>{
 const h=harness();h.s.seconds=1199;h.rules.second();assert.equal(h.notices.length,0);h.s.seconds=1200;h.rules.second();h.rules.second();assert.deepEqual(h.notices.map(n=>n.name),['Hunter1','Hunter1','Hunter2','Hunter2']);assert.match(h.notices[1].msg,/9\./);assert.match(h.notices[3].msg,/자동 지급까지/);
});
test('normal drops outside explicit crafting mode remain untouched',()=>{
 const h=harness();h.s.seconds=1200;const m=h.s.trackerCraft.recipe[0],a=h.drop(h.p1,m.id,m.amount);assert.equal(a.accepted,false);assert.equal(a.entity.removed,0);h.rules.toggle(h.p1);h.rules.toggle(h.p1);assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);
});
test('other hunter without crafting mode, runner and visitor drops cannot contribute',()=>{
 const h=harness();h.s.seconds=1200;h.rules.toggle(h.p1);const m=h.s.trackerCraft.recipe[0];for(const p of [h.p2,h.runner,h.outsider])assert.equal(h.drop(p,m.id,m.amount).entity.removed,0);assert.equal(h.s.trackerCraft.step,0);
});
test('wrong order and oversized stacks are preserved rather than consumed or split',()=>{
 const h=harness();h.open();const [m,next]=h.s.trackerCraft.recipe;assert.equal(h.drop(h.p1,next.id,next.amount).entity.removed,0);assert.equal(h.drop(h.p1,m.id,m.amount+1).entity.removed,0);assert.equal(h.s.trackerCraft.amount,0);
});
test('split stacks can be contributed by different hunters and advance one shared step once',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];assert.equal(h.drop(h.p1,m.id,1).accepted,true);assert.equal(h.s.trackerCraft.amount,1);assert.equal(h.drop(h.p2,m.id,m.amount-1).accepted,true);assert.equal(h.s.trackerCraft.step,1);assert.equal(h.s.trackerCraft.amount,0);
});
test('same material dropped simultaneously by second hunter is not applied to the next stage',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];h.drop(h.p1,m.id,m.amount);const second=h.drop(h.p2,m.id,m.amount);assert.equal(second.entity.removed,0);assert.equal(h.s.trackerCraft.step,1);
});
test('duplicate event and entity ids cannot consume or advance twice',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0],e=h.drop(h.p1,m.id,m.amount).entity;h.rules.spawned(e);assert.equal(h.rules.drop({entity:h.p1,items:[e,e]}),false);assert.equal(e.removed,1);assert.equal(h.s.trackerCraft.step,1);
});
test('native event items with indexed access and map but no iterator are processed safely',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0],e=h.entity(m.id,m.amount);h.rules.spawned(e);
 const items={0:e,length:1,map:Array.prototype.map};assert.equal(items[Symbol.iterator],undefined);assert.deepEqual(items.map(x=>x.id),[e.id]);
 assert.equal(h.rules.drop({entity:h.p1,items}),true);assert.equal(e.removed,1);assert.equal(h.s.trackerCraft.step,1);
 assert.equal(h.rules.drop({entity:h.p1,items}),false);assert.equal(e.removed,1);
});
test('items already on the floor and expired spawn observations are not consumed',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];assert.equal(h.drop(h.p1,m.id,m.amount,{old:true}).entity.removed,0);const e=h.entity(m.id,m.amount);h.rules.spawned(e);h.advance(3);h.rules.drop({entity:h.p1,items:[e]});assert.equal(e.removed,0);
});
test('merged or split entity amount after birth is rejected without touching it',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];for(const delta of [-1,1]){const e=h.entity(m.id,2);h.rules.spawned(e);e.item.amount+=delta;h.rules.drop({entity:h.p1,items:[e]});assert.equal(e.removed,0);}assert.equal(h.s.trackerCraft.amount,0);
});
test('named or lore-bearing items are never destroyed as ordinary recipe materials',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];for(const extra of [{nameTag:'keepsake'},{lore:['mine']}])assert.equal(h.drop(h.p1,m.id,m.amount,extra).entity.removed,0);
});
test('death drops cannot contribute even before entityDie sets dead-player membership',()=>{
 const h=harness();h.open();h.p1.health=0;const m=h.s.trackerCraft.recipe[0];assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);h.p1.health=20;h.p1.dead=true;assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);
});
test('team completing all nine steps grants precisely one tracker per hunter and none to runner',()=>{
 const h=harness();h.open();h.fill();assert.equal(h.s.trackerCraft.completion,'crafted');assert.equal(h.rules.ready(),true);assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.p2.slots.filter(Boolean).length,1);assert.equal(h.runner.slots.filter(Boolean).length,0);h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.completion,'crafted');assert.equal(h.p1.slots.filter(Boolean).length,1);
});
test('40 minute fallback is exclusive with crafted completion and stops further consumption',()=>{
 const h=harness();h.open();h.fill(8);h.s.seconds=2399;h.rules.second();assert.equal(h.s.trackerCraft.completion,null);h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.completion,'auto');const m=h.s.trackerCraft.recipe[8];assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);assert.equal(h.p1.slots.filter(Boolean).length,1);
});
test('disabled fallback never auto grants and tracking OFF prevents all grants',()=>{
 const h=harness();h.s.config.trackerAutoGive=false;h.s.seconds=5000;h.rules.second();assert.equal(h.s.trackerCraft.completion,null);h.s.config.trackerAutoGive=true;h.s.config.features.tracker=false;h.rules.second();assert.equal(h.s.trackerCraft.completion,null);assert.equal(h.p1.slots.filter(Boolean).length,0);
});
test('random crafting OFF skips recipes, drops, announcements, automatic grants and readiness',()=>{
 const h=harness();h.open();h.notices.length=0;h.s.config.randomCrafting=false;h.s.seconds=2400;const m=h.s.trackerCraft.recipe[0];assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);h.rules.second();assert.equal(h.s.trackerCraft.completion,null);assert.equal(h.rules.ready(),false);assert.equal(h.notices.length,0);h.rules.startRound();assert.equal(h.s.trackerCraft,null);
});
test('paused/countdown/ended phases do not unlock, consume, notify or auto grant',()=>{
 for(const phase of ['paused','countdown','ended','lobby']){const h=harness();h.open();h.notices.length=0;h.s.phase=phase;h.s.seconds=2400;h.rules.second();const m=h.s.trackerCraft.recipe[0];assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);assert.equal(h.s.trackerCraft.completion,null);assert.equal(h.notices.length,0);}
});
test('offline hunter is granted once on rejoin after team completion',()=>{
 const h=harness();h.open();h.all.splice(h.all.indexOf(h.p2),1);h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.delivered.Hunter2,undefined);h.all.push(h.p2);h.rules.joined(h.p2);h.rules.joined(h.p2);assert.equal(h.p2.slots.filter(Boolean).length,1);assert.equal(h.s.trackerCraft.delivered.Hunter2,true);
});
test('full inventory queues payout without overwriting or dropping possessions',()=>{
 const h=harness();h.p1.slots.fill({typeId:'minecraft:stone',amount:64});h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.delivered.Hunter1,undefined);assert(h.p1.slots.every(i=>i.typeId==='minecraft:stone'));h.rules.second();assert.equal(h.notices.filter(n=>n.name==='Hunter1'&&n.msg.includes('지급 대기')).length,1);h.p1.slots[5]=undefined;h.rules.second();assert.equal(h.p1.slots[5].typeId,'mh:tracker_0');assert.equal(h.s.trackerCraft.delivered.Hunter1,true);
});
test('losing tracker or dying after payout never grants a duplicate by default',()=>{
 const h=harness();h.s.seconds=2400;h.rules.second();h.p1.slots.fill(undefined);h.rules.joined(h.p1);h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,0);
});
test('rejoin and restart preserve recipe/progress while crafting mode is disarmed',()=>{
 const h=harness();h.open();h.fill(3);const recipe=JSON.stringify(h.s.trackerCraft.recipe);h.reload();assert.equal(JSON.stringify(h.s.trackerCraft.recipe),recipe);assert.equal(h.s.trackerCraft.step,3);assert.equal(h.rules.active(h.p1),false);const m=h.s.trackerCraft.recipe[3];assert.equal(h.drop(h.p1,m.id,m.amount).entity.removed,0);h.rules.toggle(h.p1);assert.equal(h.drop(h.p1,m.id,m.amount).accepted,true);
});
test('completed payout survives restart without duplicate grants',()=>{
 const h=harness();h.s.seconds=2400;h.rules.second();h.reload();h.rules.second();h.rules.joined(h.p1);assert.equal(h.p1.slots.filter(Boolean).length,1);
});
test('save failure before removing material cancels transaction without deletion',()=>{
 const h=harness();h.open();h.failSave=true;const m=h.s.trackerCraft.recipe[0],d=h.drop(h.p1,m.id,m.amount);assert.equal(d.entity.removed,0);assert.equal(h.s.trackerCraft.step,0);assert.equal(h.s.trackerCraft.pending,null);
});
test('uncertain entity removal preserves journal and blocks crafting and automatic grants',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0];h.drop(h.p1,m.id,m.amount,{failRemove:true});assert.equal(h.s.trackerCraft.pending.kind,'consume');h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.completion,null);assert.equal(h.p1.slots.filter(Boolean).length,0);assert.match(h.rules.describe(h.p1),/미완료 거래/);
});
test('restart with unfinished consumption never assumes absent item means consumed',()=>{
 const h=harness();h.open();h.failSaveAt=2;const m=h.s.trackerCraft.recipe[0];h.drop(h.p1,m.id,m.amount);assert.equal(h.s.trackerCraft.pending.kind,'consume');h.reload();assert.equal(h.s.trackerCraft.step,0);assert.equal(h.s.trackerCraft.pending.kind,'consume');h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.completion,null);
});
test('only administrator can explicitly resolve an uncertain material transaction once',()=>{
 const h=harness();h.open();h.failSaveAt=2;const m=h.s.trackerCraft.recipe[0];h.drop(h.p1,m.id,m.amount);h.reload();assert.equal(h.rules.resolvePending(h.p1,true),false);assert.equal(h.rules.resolvePending(h.runner,true),true);assert.equal(h.s.trackerCraft.step,1);assert.equal(h.rules.resolvePending(h.runner,true),false);
});
test('failed item grant freezes payout rather than retrying an ambiguous delivery',()=>{
 const h=harness();h.s.seconds=2400;h.p1.inv.setItem=()=>{throw Error('write failed');};h.rules.second();assert.equal(h.s.trackerCraft.pending.kind,'grant');h.rules.second();assert.equal(h.s.trackerCraft.delivered.Hunter1,undefined);assert.equal(h.s.trackerCraft.delivered.Hunter2,undefined);h.reload();assert.equal(h.s.trackerCraft.pending.kind,'grant');
});
test('progress and notices switches suppress optional messages while manual recipe remains available',()=>{
 const h=harness();h.s.config.trackerNotices=false;h.s.config.trackerProgress=false;h.open();h.notices.length=0;h.rules.second();h.fill(1);assert.equal(h.notices.length,0);assert.match(h.rules.describe(h.p1),/완료 1\/9/);
});
test('clear sessions and new round reset remove old modes, entitlement and completed recipe',()=>{
 const h=harness();h.open();h.rules.clearSessions();assert.equal(h.rules.active(h.p1),false);h.s.seconds=2400;h.rules.second();h.s.round=2;h.rules.startRound();assert.equal(h.s.trackerCraft.round,2);assert.equal(h.s.trackerCraft.completion,null);assert.deepEqual(h.s.trackerCraft.delivered,{});h.rules.reset();assert.equal(h.s.trackerCraft,null);
});
test('multiple indexed native drops fill one shared material step and ignore a repeated entity without iteration support',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0],a=h.entity(m.id,1),b=h.entity(m.id,m.amount-1);h.rules.spawned(a);h.rules.spawned(b);
 const items={0:a,1:b,2:b,length:3,map:fn=>[a,b,b].map(fn)};assert.equal(items[Symbol.iterator],undefined);assert(h.rules.drop({entity:h.p1,items}));assert.equal(a.removed,1);assert.equal(b.removed,1);assert.equal(h.s.trackerCraft.step,1);assert.equal(h.s.trackerCraft.amount,0);assert.equal(h.errors.length,0);
});
test('last material consumed before a failed save remains blocked across reload until explicitly confirmed and pays once',()=>{
 const h=harness();h.open();h.fill(8);const m=h.s.trackerCraft.recipe[8];h.failSaveAt=h.saveCount+2;const last=h.drop(h.p1,m.id,m.amount);assert.equal(last.entity.removed,1);assert.equal(last.accepted,false);assert.equal(h.s.trackerCraft.pending.kind,'consume');assert.equal(h.p1.slots.filter(Boolean).length,0);
 h.reload();assert.equal(h.s.trackerCraft.step,8);assert.equal(h.s.trackerCraft.completion,null);h.s.seconds=2400;h.rules.second();assert.equal(h.s.trackerCraft.completion,null,'the 40 minute timer must not overwrite an unresolved last-material transaction');assert.equal(h.rules.toggle(h.p2),false);
 assert(h.rules.resolvePending(h.runner,true));assert.equal(h.s.trackerCraft.step,9);assert.equal(h.s.trackerCraft.completion,'crafted');h.rules.second();h.rules.joined(h.p1);h.reload();h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.p2.slots.filter(Boolean).length,1);assert.equal(last.entity.removed,1);
});
test('a successful tracker insertion with failed final save is not repeated after restart or automatic payout tick',()=>{
 const h=harness();h.s.seconds=2400;h.failSaveAt=3;h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.s.trackerCraft.pending.kind,'grant');assert.equal(h.p2.slots.filter(Boolean).length,0);
 h.reload();assert.equal(h.s.trackerCraft.delivered.Hunter1,undefined);assert.equal(h.s.trackerCraft.pending.kind,'grant');h.rules.joined(h.p1);h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.p2.slots.filter(Boolean).length,0);
 assert(h.rules.resolvePending(h.runner,true));h.rules.second();h.rules.joined(h.p1);h.reload();h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.p2.slots.filter(Boolean).length,1);assert.equal(h.s.trackerCraft.delivered.Hunter1,true);
});
test('partial material quantity and frozen recipe survive restart and another hunter completes the exact remainder',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0],recipe=JSON.stringify(h.s.trackerCraft.recipe);h.drop(h.p1,m.id,1);h.reload();assert.equal(h.s.trackerCraft.amount,1);assert.equal(JSON.stringify(h.s.trackerCraft.recipe),recipe);assert.equal(h.rules.active(h.p2),false);
 assert.equal(h.drop(h.p2,m.id,m.amount-1).entity.removed,0);assert(h.rules.toggle(h.p2));assert(h.drop(h.p2,m.id,m.amount-1).accepted);assert.equal(h.s.trackerCraft.step,1);assert.equal(h.s.trackerCraft.amount,0);
});
test('craft completion and the 40 minute payout are exclusive for both event orders at the same boundary',()=>{
 for(const autoFirst of [false,true]){const h=harness();h.open();h.fill(8);const m=h.s.trackerCraft.recipe[8];h.s.seconds=2400;if(autoFirst)h.rules.second();const last=h.drop(h.p2,m.id,m.amount);h.rules.second();assert.equal(h.s.trackerCraft.completion,autoFirst?'auto':'crafted');assert.equal(last.entity.removed,autoFirst?0:1);assert.equal(h.p1.slots.filter(Boolean).length,1);assert.equal(h.p2.slots.filter(Boolean).length,1);h.rules.second();assert.equal(h.p1.slots.filter(Boolean).length,1);}
});
test('native metadata lists without iterators still protect property-bearing and enchanted dropped items',()=>{
 const h=harness();h.open();const m=h.s.trackerCraft.recipe[0],nativeList={0:'protected',length:1};
 for(const extra of [{getDynamicPropertyIds:()=>nativeList},{getComponent:id=>id==='minecraft:enchantable'?{getEnchantments:()=>nativeList}:undefined}]){const item=h.drop(h.p1,m.id,m.amount,extra);assert.equal(item.entity.removed,0);assert.equal(item.accepted,false);}assert.equal(h.s.trackerCraft.step,0);
});
