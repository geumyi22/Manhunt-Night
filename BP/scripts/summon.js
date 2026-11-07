import {inBounds} from './expansion-core.js';

export const SUMMON_ITEM='mh:summon_scroll';
const RECEIPT='mh:summon_receipt';
// Block.isSolid is still pre-release. Accept known full, stable vanilla floors only.
const FLOOR=new Set(['stone','cobblestone','mossy_cobblestone','dirt','grass_block','grass','coarse_dirt','rooted_dirt','podzol','mycelium',
 'granite','diorite','andesite','polished_granite','polished_diorite','polished_andesite','deepslate','cobbled_deepslate','polished_deepslate',
 'deepslate_bricks','deepslate_tiles','tuff','calcite','dripstone_block','obsidian','crying_obsidian','bedrock','netherrack','end_stone',
 'end_bricks','nether_brick','red_nether_brick','basalt','smooth_basalt','polished_basalt','blackstone','polished_blackstone',
 'polished_blackstone_bricks','stonebrick','stone_bricks','brick_block','bricks','sandstone','red_sandstone','smooth_stone',
 'iron_block','copper_block','gold_block','diamond_block','emerald_block','netherite_block','lapis_block','coal_block','quartz_block',
 'packed_mud','mud_bricks','terracotta','hardened_clay','glass','sea_lantern','glowstone','prismarine','dark_prismarine','prismarine_bricks',
 'purpur_block','bookshelf','crafting_table'].map(n=>'minecraft:'+n));
const WOODS=['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','pale_oak','bamboo','crimson','warped'];
const COLORS=['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
for(const wood of WOODS)for(const suffix of ['planks','log','wood','stem','hyphae'])FLOOR.add(`minecraft:${wood}_${suffix}`);
for(const color of COLORS)for(const suffix of ['concrete','terracotta','wool'])FLOOR.add(`minecraft:${color}_${suffix}`);
const HAZARD=/^minecraft:(?:flowing_)?lava$|^minecraft:(?:fire|soul_fire|magma|magma_block|cactus|sweet_berry_bush|wither_rose|campfire|soul_campfire|powder_snow|pointed_dripstone|portal|end_portal)$/;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const position=p=>({x:p.x,y:p.y,z:p.z});
const integer=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
export function newSummonState(round=0){return {round,uses:0,readyAt:0,serial:0,transaction:null,lastRecovery:null};}
export function summonConfig(config){return {
 distance:integer(config.summonDistance,350,0,5000),cooldown:integer(config.summonCooldownSeconds,300,0,3600),
 maxUses:integer(config.summonMaxUses,2,0,100),sound:config.summonSound!==false
};}
export function outsideRunner(point,dimension,runner,limit){return !runner||runner.dimension.id!==dimension||distance(point,runner.location)>limit;}

/** Conservative loaded-chunk test. Reject unrecognized floors rather than guess collision shapes. */
export function safeSummonSpot(dimension,point,occupied=[]){
 if(!inBounds(point,dimension.id)||occupied.some(p=>distance(point,p)<1.3))return false;
 const x=Math.floor(point.x),y=Math.floor(point.y),z=Math.floor(point.z),height=dimension.heightRange;
 if(height&&(y-1<height.min||y+1>=height.max))return false;
 try{
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   if(!inBounds({x:x+dx,z:z+dz},dimension.id))return false;
   const ground=dimension.getBlock({x:x+dx,y:y-1,z:z+dz});
   if(!ground||!FLOOR.has(ground.typeId)||ground.isWaterlogged)return false;
   for(let dy=0;dy<=1;dy++){
    const block=dimension.getBlock({x:x+dx,y:y+dy,z:z+dz});
    if(!block||HAZARD.test(block.typeId))return false;
    if(dx===0&&dz===0&&!block.isAir)return false;
   }
  }
  return true;
 }catch{return false;}
}

export function planSummonSpots(caller,count,runner,limit,occupied=[]){
 const result=[],base=caller.location,dimension=caller.dimension,used=[...occupied,position(base)];
 const cache=new Map(),view={id:dimension.id,heightRange:dimension.heightRange,getBlock:p=>{const key=`${p.x},${p.y},${p.z}`;if(!cache.has(key))cache.set(key,dimension.getBlock(p));return cache.get(key);}};
 // At most 3 hunters: bounded local search, no forced chunk loading or persistent entities.
 for(const dy of [0,1,-1,2,-2])for(let radius=2;radius<=4;radius++){
  for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
   const point={x:Math.floor(base.x)+dx+.5,y:Math.floor(base.y)+dy,z:Math.floor(base.z)+dz+.5};
   if(!outsideRunner(point,dimension.id,runner,limit)||!safeSummonSpot(view,point,used))continue;
   result.push(point);used.push(point);if(result.length===count)return result;
  }
 }
 return null;
}

export function createSummon(world,system,state,{tell,report,save,inventory,isDead,isAdmin=(_p)=>false}){
 let busy=false,nextRecoveryTick=0;const attempts=new Map();
 const participants=()=>world.getAllPlayers().filter(p=>state().roster.includes(p.name));
 const hunters=()=>participants().filter(p=>p.name!==state().runner&&!isDead(p));
 const data=()=>state().summon??=(newSummonState(state().round));
 const announce=(p,m)=>{try{tell(p,m);}catch(e){report('summon message',e);}};
 const reject=(p,m)=>{announce(p,'§e소집 실패: '+m);return false;};
 const sound=p=>{if(summonConfig(state().config).sound)try{p.playSound('random.orb');}catch(e){report('summon sound',e);}};
 function move(p,to,dimension,rotation){
  const options={dimension:world.getDimension(dimension),checkForBlocks:true,keepVelocity:false,...(rotation?{rotation}:{})};
  if(!p.tryTeleport(to,options))throw Error(`teleport rejected: ${p.name}`);
  if(p.dimension.id!==dimension||distance(p.location,to)>.1)throw Error(`teleport not applied: ${p.name}`);
 }
 function findMarked(p,token){const inv=inventory(p);if(!inv)return null;for(let i=0;i<inv.size;i++){
  const item=inv.getItem(i);if(item?.typeId===SUMMON_ITEM&&item.getDynamicProperty(RECEIPT)===token)return {inv,slot:i,item};
 }return null;}
 function unmark(p,token){const marked=findMarked(p,token);if(marked){marked.item.setDynamicProperty(RECEIPT);marked.inv.setItem(marked.slot,marked.item);}}
 function consumeMarked(p,token){const marked=findMarked(p,token);if(!marked)return false;
  if(marked.item.amount!==1)throw Error('summon receipt must be non-stackable');
  marked.inv.setItem(marked.slot);return true;
 }
 function rollback(tx){
  const remaining=[];for(const entry of tx.origins){const p=world.getAllPlayers().find(q=>q.name===entry.name);if(!p||isDead(p)){remaining.push(entry);continue;}
   try{if(p.dimension.id!==entry.dimension||distance(p.location,entry.location)>.1)move(p,entry.location,entry.dimension,entry.rotation);}catch(e){remaining.push(entry);report('summon rollback',e);}
  }
  tx.origins=remaining;
  const caller=world.getAllPlayers().find(p=>p.name===tx.caller);
  if(caller)try{unmark(caller,tx.token);}catch(e){report('summon receipt recovery',e);return false;}
  return remaining.length===0&&!!caller;
 }
 function recover(force=false){
  if(busy)return false;const d=data(),tx=d.transaction;if(!tx)return true;
  if(!force&&system.currentTick<nextRecoveryTick)return false;
  nextRecoveryTick=system.currentTick+100;
  busy=true;
  try{
   if(tx.phase==='manual_accepted'){
    // An administrator already accepted the safe current positions. Never replay a rollback or grant items.
    const caller=world.getAllPlayers().find(p=>p.name===tx.caller);if(!caller||isDead(caller))return false;
    unmark(caller,tx.token);d.transaction=null;
    try{save();}catch(e){d.transaction=tx;throw e;}
    nextRecoveryTick=0;return true;
   }
   if(tx.phase==='committed'){
    const caller=world.getAllPlayers().find(p=>p.name===tx.caller);if(!caller||isDead(caller))return false;
    // Committed movement and counters are retained. Consume a surviving uniquely marked receipt once.
    consumeMarked(caller,tx.token);d.transaction=null;
    try{save();}catch(e){d.transaction=tx;throw e;}return true;
   }
   // An externally occupied refund slot is ambiguous. Never invent an item or erase the journal.
   if(tx.phase==='refund_pending'){rollback(tx);save();return false;}
   if(!rollback(tx)){save();return false;}
   d.transaction=null;
   try{save();}catch(e){d.transaction=tx;throw e;}return true;
  }catch(e){report('summon recovery',e);return false;}finally{busy=false;}
 }
 function joined(_p){return recover(true);}
 function reset(){attempts.clear();if(data().transaction&&!recover(true))return false;const audit=data().lastRecovery;state().summon={...newSummonState(state().round),lastRecovery:audit??null};return true;}
 function pendingRecovery(){
  const tx=data().transaction;if(!tx)return null;
  return {token:tx.token,phase:tx.phase,caller:tx.caller,names:[...new Set([tx.caller,...(tx.participants??[]),...tx.origins.map(e=>e.name)])],
   pendingOrigins:tx.origins.map(e=>({name:e.name,dimension:e.dimension,location:position(e.location)})),refundUncertain:tx.phase==='refund_pending'};
 }
 function resolveAtCurrent(admin,expectedToken){
  if(!isAdmin(admin))return reject(admin,'관리자만 복구 대기 거래를 정리할 수 있습니다.');
  if(busy)return reject(admin,'소집 처리가 진행 중입니다.');
  const s=state(),d=data(),tx=d.transaction;
  if(!tx||tx.token!==expectedToken)return reject(admin,'복구 상태가 바뀌었습니다. 메뉴를 다시 열어 주세요.');
  if(!['lobby','ended','paused'].includes(s.phase))return reject(admin,'먼저 경기를 일시정지해 주세요.');
  if(!['moving','refund_pending'].includes(tx.phase))return reject(admin,'이미 확정된 거래입니다. 자동 복구 재시도를 사용하세요.');
  const online=world.getAllPlayers(),names=pendingRecovery().names,accepted=[];
  try{
   for(const name of names){
    const p=online.find(q=>q.name===name);if(!p||isDead(p))return reject(admin,`${name}님이 접속하고 부활한 뒤 다시 시도하세요.`);
    const occupied=online.filter(q=>q.name!==name&&q.dimension.id===p.dimension.id&&!isDead(q)).map(q=>position(q.location));
    if(!safeSummonSpot(p.dimension,p.location,occupied))return reject(admin,`${name}님을 경계 안의 넓고 평평한 안전 지면에 세워 주세요.`);
    accepted.push({name,dimension:p.dimension.id,location:position(p.location)});
   }
  }catch(e){report('summon manual validation',e);return reject(admin,'현재 위치를 확인할 수 없습니다.');}
  const oldPhase=tx.phase,oldAudit=d.lastRecovery;
  busy=true;
  try{
   d.lastRecovery={token:tx.token,round:s.round,seconds:s.seconds,administrator:admin.name,previousPhase:oldPhase,
    action:'accept_current_positions_without_item_refund',players:accepted};
   tx.phase='manual_accepted';
   try{save();}catch(e){tx.phase=oldPhase;d.lastRecovery=oldAudit;throw e;}
   // Receipt cleanup is idempotent. No slot is overwritten with a new item and no uncertain refund is minted.
   unmark(online.find(p=>p.name===tx.caller),tx.token);d.transaction=null;
   try{save();}catch(e){d.transaction=tx;throw e;}
   nextRecoveryTick=0;
   announce(admin,'§a현재 위치의 안전을 확인해 실패한 소집 거래를 정리했습니다. 아이템을 새로 지급하거나 소비하지 않았습니다.');
   if(oldPhase==='refund_pending')announce(admin,'§e환급 상태가 불명확한 소집서는 자동 보상하지 않았습니다. 기록을 확인하세요.');
   return true;
  }catch(e){report('summon manual recovery',e);return reject(admin,'복구 기록 저장에 실패했습니다. 대기 기록을 보존했으므로 다시 확인해 주세요.');}
  finally{busy=false;}
 }
 function use(p){
  const s=state();if(s.config.features?.summon===false)return reject(p,'소집서 기능이 꺼져 있습니다.');
  if(s.phase!=='running'||!s.roster.includes(p.name)||p.name===s.runner||isDead(p))return reject(p,'추격 중 살아 있는 헌터만 사용할 수 있습니다.');
  if(busy)return false;
  if(attempts.get(p.name)===system.currentTick)return false;attempts.set(p.name,system.currentTick);
  const d=data();if(d.transaction)return reject(p,'이전 소집 복구가 끝나지 않았습니다. 관리자에게 알려 주세요.');
  const config=summonConfig(s.config);
  if(d.uses>=config.maxUses)return reject(p,'이번 경기의 팀 소집 횟수를 모두 사용했습니다.');
  if(s.seconds<d.readyAt)return reject(p,`팀 소집 재사용까지 ${d.readyAt-s.seconds}초 남았습니다.`);
  const inv=inventory(p),slot=p.selectedSlotIndex,original=inv?.getItem(slot);
  if(original?.typeId!==SUMMON_ITEM||original.amount!==1)return reject(p,'소집서 한 장을 손에 들어 주세요.');
  if(original.getDynamicProperty(RECEIPT)!==undefined)return reject(p,'복구 표시가 남은 소집서입니다. 관리자에게 알려 주세요.');
  const online=world.getAllPlayers(),runner=online.find(q=>q.name===s.runner&&!isDead(q));
  if(!runner)return reject(p,'러너의 접속·부활 상태를 확인한 뒤 다시 사용하세요.');
  if(!outsideRunner(p.location,p.dimension.id,runner,config.distance))return reject(p,`러너와 ${config.distance}블록보다 멀어야 합니다.`);
  const team=hunters().filter(h=>h.name!==p.name),targets=team.filter(h=>h.dimension.id===p.dimension.id);
  if(!targets.length){for(const h of team)announce(h,`§e${p.name}님이 다른 차원에서 소집을 요청했습니다. 차원 간 이동은 하지 않습니다.`);return reject(p,'같은 차원에 소집 가능한 헌터가 없습니다.');}
  const occupied=online.filter(q=>q.dimension.id===p.dimension.id&&!isDead(q)).map(q=>position(q.location));
  const spots=planSummonSpots(p,targets.length,runner,config.distance,occupied);
  if(!spots)return reject(p,'주변에 전원이 안전하게 설 공간이 부족합니다. 넓고 평평한 지면에서 다시 사용하세요.');
  const snapshot={round:s.round,dimension:p.dimension.id,caller:position(p.location),uses:d.uses,readyAt:d.readyAt};
  const token=`${s.round}:${++d.serial}:${p.id}:${system.currentTick}`;
  const origins=targets.map(h=>({name:h.name,dimension:h.dimension.id,location:position(h.location),rotation:h.getRotation()}));
  const tx={token,caller:p.name,phase:'moving',origins,participants:targets.map(h=>h.name)};
  let consumed=false,marked=false;
  busy=true;
  try{
   // Re-read every safety condition immediately before the first teleport, not after an asynchronous wait.
   const latest=inventory(p)?.getItem(slot),liveRunner=world.getAllPlayers().find(q=>q.name===s.runner&&!isDead(q));
   if(s.phase!=='running'||s.config.features?.summon===false||s.round!==snapshot.round||isDead(p)||p.dimension.id!==snapshot.dimension||distance(p.location,snapshot.caller)>.1
    ||p.selectedSlotIndex!==slot||latest?.typeId!==SUMMON_ITEM||latest.amount!==1||!liveRunner
    ||!outsideRunner(p.location,p.dimension.id,liveRunner,config.distance))throw Error('conditions changed before summon');
   if(JSON.stringify(latest.getLore())!==JSON.stringify(original.getLore())||latest.nameTag!==original.nameTag)throw Error('held item changed');
   for(let i=0;i<targets.length;i++)if(isDead(targets[i])||targets[i].dimension.id!==snapshot.dimension
    ||!outsideRunner(spots[i],snapshot.dimension,liveRunner,config.distance)||!safeSummonSpot(p.dimension,spots[i],occupied.concat(spots.filter((_,j)=>i!==j))))throw Error('unsafe destination changed');
   latest.setDynamicProperty(RECEIPT,token);inv.setItem(slot,latest);marked=true;
   d.transaction=tx;save();
   for(let i=0;i<targets.length;i++){
    const currentRunner=world.getAllPlayers().find(q=>q.name===s.runner&&!isDead(q));
    if(s.phase!=='running'||s.config.features?.summon===false||s.round!==snapshot.round||isDead(p)||isDead(targets[i])||!currentRunner||p.dimension.id!==snapshot.dimension||targets[i].dimension.id!==snapshot.dimension
     ||!outsideRunner(p.location,snapshot.dimension,currentRunner,config.distance)||!outsideRunner(spots[i],snapshot.dimension,currentRunner,config.distance)
     ||!safeSummonSpot(p.dimension,spots[i],[]))throw Error('conditions changed during summon');
    move(targets[i],spots[i],snapshot.dimension,origins[i].rotation);
   }
   // A durable commit describes completed moves before consuming the marked, non-stackable item.
   d.uses=snapshot.uses+1;d.readyAt=s.seconds+config.cooldown;tx.phase='committed';save();
   if(!consumeMarked(p,token))throw Error('summon receipt disappeared');consumed=true;
   d.transaction=null;save();
   for(const h of targets){announce(h,`§a${p.name}님의 소집으로 이동했습니다.`);sound(h);}
   for(const h of team.filter(h=>h.dimension.id!==snapshot.dimension))announce(h,`§e${p.name}님이 ${snapshot.dimension.replace('minecraft:','')} 차원에서 소집했습니다. 다른 차원에서는 이동하지 않습니다.`);
   announce(p,`§a헌터 ${targets.length}명 소집 완료. 팀 사용 ${d.uses}/${config.maxUses}회 · 재사용 ${config.cooldown}초`);sound(p);return true;
  }catch(e){
   report('summon cancelled',e);d.uses=snapshot.uses;d.readyAt=snapshot.readyAt;tx.phase='moving';
   // No user action can interleave this synchronous call. Still refuse to overwrite an occupied slot.
   if(consumed){try{if(inv.getItem(slot))throw Error('refund slot occupied');inv.setItem(slot,original);}catch(refundError){tx.phase='refund_pending';report('summon refund',refundError);}}
   const rolledBack=marked?rollback(tx):true;
   d.transaction=rolledBack&&tx.phase!=='refund_pending'?null:tx;
   try{save();}catch(saveError){d.transaction=tx;report('summon rollback save',saveError);}
   return reject(p,d.transaction?'이동을 취소했습니다. 복구 대기 중이므로 추가 사용을 막았습니다.':'이동을 취소하고 소집서를 보존했습니다.');
  }finally{busy=false;}
 }
 return {use,joined,recover,reset,pendingRecovery,resolveAtCurrent,hasPending:()=>!!data().transaction};
}
