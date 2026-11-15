import {RECEIVER,newExtra,inBounds,closestFortress,hintReason} from './expansion-core.js';
import {FORTRESS_FLOOR_CELLS} from './fortress-map.js';
import {borderCenter,validFortressWaypoint} from './world-compat.js';

// Stable API implementation: no beta natural-structure detection dependency.
export function createExpansion(world,system,state,api){
 const floorCells=new Set(FORTRESS_FLOOR_CELLS),cameras=new Map();let signal=null,nextBorderTick=0,nextBeamTick=0;
 const {tell,inventory,ItemStack,report}=api;
 const alive=p=>!api.isDead(p);
 const playable=()=>['grace','running'].includes(state().phase);
 const participants=()=>world.getAllPlayers().filter(p=>state().roster.includes(p.name));
 const runner=()=>world.getAllPlayers().find(p=>p.name===state().runner);
 const extra=()=>state().extra??=(newExtra());
 const enabled=key=>state().config.features?.[key]!==false;
 function clearCamera(p){if(!cameras.has(p.name))return;try{p.camera.clear();}catch(e){report('camera clear',e);}cameras.delete(p.name);}
 function clearAll(){for(const p of world.getAllPlayers())if(cameras.has(p.name))clearCamera(p);signal=null;nextBorderTick=0;nextBeamTick=0;}
 function reset(){clearAll();state().extra=newExtra();}
 function joined(p){clearCamera(p);}
 function grantEnd(p){if(!enabled('endReward')||extra().endReward)return;const item=new ItemStack('minecraft:ender_eye',32),rest=inventory(p)?.addItem(item);if(rest)p.dimension.spawnItem(rest,p.location);extra().endReward=true;tell(p,'§d엔드 첫 입장 보상: 엔더의 눈 32개! 소지품이 가득 차면 발밑에 떨어집니다.');}
 function sendHint(){
  if(!enabled('fortressHint'))return;
  const s=state(),e=extra(),r=runner(),reason=hintReason(e,s.seconds);
  if(!r||!reason)return;
  const f=s.worldMode==='portable'?(validFortressWaypoint(s.fortressWaypoint)?s.fortressWaypoint:null):closestFortress(r.location,r.dimension.id);
  // A fixed seed's coordinates are never shown as if they were measured on another map.
  if(!f){if(!e.missingWaypointNotified){tell(r,'§e[요새 안내] 이 월드의 네더 요새 좌표가 아직 확인되지 않았습니다. 호스트가 /locate structure fortress 결과를 관리 메뉴에 등록하면 정확한 좌표를 안내합니다.');e.missingWaypointNotified=true;}return;}
  tell(r,`§a[러너 전용] ${reason}\n§e네더 요새 좌표: X ${f.x}, Z ${f.z} §7(${s.worldMode==='portable'?'호스트 등록 좌표':'원본 맵 좌표'}, 네더 기준, 높이는 현장에서 확인)`);
  e.hintSent=true;e.hintReason='';e.missingWaypointNotified=false;
 }
 function dimensionChanged(e){clearCamera(e.player);if(signal?.runner===e.player.name)clearAll();if(!playable()||!state().roster.includes(e.player.name))return;
  if(enabled('fortressHint')&&e.toDimension.id==='minecraft:nether'){
   if(e.player.name===state().runner)extra().runnerNether=true;
   else if(!extra().runnerNether&&!extra().hintSent){extra().hintReason='헌터가 먼저 네더에 진입했습니다.';sendHint();}
  }
  if(e.player.name===state().runner&&e.toDimension.id==='minecraft:the_end')grantEnd(e.player);
 }
 function enteredFortress(p){if(p.dimension.id!=='minecraft:nether')return false;const s=state(),l=p.location;
  const portable=s.worldMode==='portable',waypoint=s.fortressWaypoint;
  if(portable){
   // External worlds need a user-verified waypoint; no seed-wide fortress is inferred from arbitrary bricks.
   if(!validFortressWaypoint(waypoint)||Math.abs(l.x-waypoint.x)>192||Math.abs(l.z-waypoint.z)>192)return false;
   let bricks=0;
   for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=-1;dy<=0;dy++){
    let type;try{type=p.dimension.getBlock({x:Math.floor(l.x)+dx,y:Math.floor(l.y)+dy,z:Math.floor(l.z)+dz})?.typeId;}catch{return false;}
    if(['minecraft:nether_brick','minecraft:nether_brick_stairs','minecraft:nether_brick_fence'].includes(type))bricks++;
   }
   return bricks>=6;
  }
  for(let dy=-2;dy<=1;dy++){const y=Math.floor(l.y)+dy;
   const cell=`${Math.floor(l.x/4)},${Math.floor(y/4)},${Math.floor(l.z/4)}`;
   if(!floorCells.has(cell))continue;
   let type;try{type=p.dimension.getBlock({x:Math.floor(l.x),y,z:Math.floor(l.z)})?.typeId;}catch{return false;}
   if(['minecraft:nether_brick','minecraft:nether_brick_stairs','minecraft:nether_brick_fence'].includes(type))return true;
  }return false;
 }
 function border(p){if(!enabled('borders'))return;const e=extra(),dim=p.dimension.id;const saved=e.safe[p.name]??=( {} );
  if(inBounds(p.location,dim,borderCenter(state(),dim))){saved[dim]={x:p.location.x,y:p.location.y,z:p.location.z};return;}
  // Roll back to a previously visited position, never blindly into an unloaded wall or lava.
  const back=saved[dim];clearCamera(p);
  if(back)p.teleport(back,{dimension:p.dimension});else p.teleport(state().start,{dimension:world.getDimension('overworld')});
  const center=borderCenter(state(),dim),half=dim==='minecraft:nether'?625:5000;
  tell(p,`§e${dim==='minecraft:nether'?'네더':'월드'} 구역 경계: X [${center.x-half}, ${center.x+half}), Z [${center.z-half}, ${center.z+half})`);
 }
 function useReceiver(p){const s=state(),e=extra();if(!playable()||p.name!==s.runner||!alive(p)){tell(p,'수신기는 경기 중 러너만 사용할 수 있습니다.');return false;}
  if(!enabled('receiver')){tell(p,'이번 경기에서는 신호 수신기가 비활성화되어 있습니다.');return false;}
  if(inventory(p)?.getItem(p.selectedSlotIndex)?.typeId!==RECEIVER)return false;
  if(s.seconds<e.receiverReady){tell(p,`수신기 재사용까지 ${e.receiverReady-s.seconds}초`);return false;}
  e.receiverReady=s.seconds+30;signal=enabled('receiverBeam')?{runner:p.name,dimension:p.dimension.id,until:system.currentTick+160}:null;nextBeamTick=system.currentTick;
  for(const h of participants())if(h.name!==s.runner&&alive(h)){
   if(h.dimension.id!==p.dimension.id){tell(h,`§a러너 신호 수신! 러너는 ${p.dimension.id.replace('minecraft:','')} 차원입니다. 다른 차원에서는 카메라를 전환하지 않습니다.`);continue;}
   if(!enabled('receiverCamera')){tell(h,'§a러너가 같은 차원에서 신호를 보냈습니다. (카메라 전환 OFF)');continue;}
   try{h.camera.setCamera('minecraft:free',{location:h.getHeadLocation(),facingLocation:p.getHeadLocation()});cameras.set(h.name,{until:system.currentTick+60,dimension:h.dimension.id});tell(h,'§a러너가 신호를 보냈습니다. 3초 동안 러너 방향을 비춥니다.');}catch(err){report('receiver camera',err);clearCamera(h);}
  }
  tell(p,`§a신호 송출! ${enabled('receiverBeam')?'광선 8초':'광선 OFF'} · ${enabled('receiverCamera')?'카메라 3초':'카메라 OFF'} · 재사용 30초`);return true;
 }
 function tick(){
  if(!playable()){clearAll();return;}
  const now=system.currentTick;
  // runInterval callbacks can start at any tick phase; an absolute modulo can starve forever.
  if(!enabled('borders'))nextBorderTick=0;
  else if(now>=nextBorderTick){nextBorderTick=now+10;for(const p of participants())if(alive(p))border(p);}
  for(const [name,c] of cameras){const p=world.getAllPlayers().find(q=>q.name===name);if(!p){cameras.delete(name);continue;}if(system.currentTick>=c.until||p.dimension.id!==c.dimension||!alive(p))clearCamera(p);}
  if(!enabled('receiver')||!enabled('receiverBeam')){signal=null;nextBeamTick=0;}
  if(signal){const r=runner();if(!r||!alive(r)||r.dimension.id!==signal.dimension||now>=signal.until){signal=null;nextBeamTick=0;return;}
   if(now>=nextBeamTick){nextBeamTick=now+10;try{r.dimension.spawnParticle('mh:signal_beam',{x:r.location.x,y:Math.min(r.location.y+24,(r.dimension.heightRange?.max??320)-1),z:r.location.z});}catch(e){report('signal beam',e);}}
  }
 }
 function second(){if(!playable()||!enabled('fortressHint'))return;const r=runner();if(r&&alive(r)&&!extra().fortressEntered&&enteredFortress(r)){extra().fortressEntered=true;tell(r,'§a네더 요새 도착 확인!');}sendHint();}
 return {reset,joined,clearCamera,clearAll,dimensionChanged,useReceiver,tick,second,enteredFortress,grantEnd};
}
