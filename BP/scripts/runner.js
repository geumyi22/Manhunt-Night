// Own only our passive/grace effects; do not clear unrelated potion effects each tick.
const EFFECTS_KEY='mh:runner_effects', HEALTH=1, SATURATION=2, GRACE=4;
// Kept as a compatibility export; callers should use wildRespawnBudget/Remaining.
export const MAX_WILD_RESPAWNS=2;
export const DEFAULT_PROXIMITY_DISTANCES=Object.freeze([90,60,40,10]);
const int=(n,fallback,max=20)=>Number.isFinite(n)?Math.max(0,Math.min(max,Math.floor(n))):fallback;
export function wildRespawnLimit(s){return Math.max(int(s.config.wildRespawnBase,2),int(s.config.wildRespawnMax,3));}
export function wildRespawnBudget(s){
 if(s.config.features?.wildRespawns===false)return 0;
 return Math.min(wildRespawnLimit(s),int(s.config.wildRespawnBase,2)+int(s.runnerLifeBonus,0));
}
export function wildRespawnsRemaining(s){return Math.max(0,wildRespawnBudget(s)-int(s.runnerRespawns,0,1000));}
export function proximityDistances(config){
 const values=config.proximityDistances;
 return Array.isArray(values)&&values.length===4&&values.every((n,i)=>Number.isFinite(n)&&n>=1&&n<=1024&&(i===0||values[i-1]>n))?values:DEFAULT_PROXIMITY_DISTANCES;
}
export function responsiblePlayer(source){
 for(const entity of [source?.damagingEntity,source?.damagingProjectile]){
  if(!entity)continue;
  try{if(entity.typeId==='minecraft:player')return entity;
   const owner=entity.getComponent('minecraft:projectile')?.owner;if(owner?.typeId==='minecraft:player')return owner;}catch{}
 }
 return null;
}
export function hunterKilledRunner(s,source){const p=responsiblePlayer(source);return !!p&&p.name!==s.runner&&s.roster.includes(p.name);}
export function nearbyHunters(s,runner,players,isDead,maxDistance=proximityDistances(s.config)[0]){
 return players.filter(p=>p.name!==s.runner&&s.roster.includes(p.name)&&!isDead(p)&&p.dimension.id===runner.dimension.id
  &&Math.hypot(p.location.x-runner.location.x,p.location.y-runner.location.y,p.location.z-runner.location.z)<=maxDistance);
}
export function createRunnerRules(world,system,state,{tell,isDead,report}){
 let warningRunner='',warningRound=-1,warningBand=-1,pendingBand=-1;
 const lastWarning=[-Infinity,-Infinity,-Infinity,-Infinity];
 const warningText=['주변에서 헌터의 기척이 느껴집니다.','헌터가 가까워지고 있습니다.','위험! 헌터가 접근 중입니다.','긴급! 헌터가 바로 근처에 있습니다!'];
 function resetWarning(){warningRunner='';warningRound=-1;warningBand=-1;pendingBand=-1;lastWarning.fill(-Infinity);}
 const enabled=key=>state().config.features?.[key]!==false;
 const eligible=p=>state().roster.includes(p.name)&&p.name===state().runner&&['countdown','grace','running','paused'].includes(state().phase);
 const effect=(p,id)=>p.getEffect(id);
 function ensure(p,id,amplifier,duration){const old=effect(p,id);
  if(old?.amplifier===amplifier&&old.duration>60)return;
  if(old&&old.amplifier!==amplifier)p.removeEffect(id);
  p.addEffect(id,duration,{amplifier,showParticles:false});
 }
 function clear(p){const flags=Number(p.getDynamicProperty(EFFECTS_KEY)||0);
  if(flags&GRACE){p.removeEffect('regeneration');p.removeEffect('slow_falling');}
  if(flags&SATURATION)p.removeEffect('saturation');
  if(flags&HEALTH)p.removeEffect('health_boost');
  if(flags)p.setDynamicProperty(EFFECTS_KEY,0);
 }
 function sync(p,fill=false){
  if(isDead(p))return;
  if(!eligible(p))clear(p);
  else {
   const flags=Number(p.getDynamicProperty(EFFECTS_KEY)||0),grace=state().phase==='grace';
   // Only touch effects owned by Manhunt; disabled buffs are removed promptly.
   const health=enabled('runnerHealth'), sat=enabled('runnerSaturation'), graceEffects=grace&&enabled('graceBuffs');
   if(health)ensure(p,'health_boost',4,20000000);
   else if(flags&HEALTH)p.removeEffect('health_boost');
   if(sat)ensure(p,'saturation',graceEffects?4:0,100);
   else if(flags&SATURATION)p.removeEffect('saturation');
   if(graceEffects){ensure(p,'regeneration',0,100);ensure(p,'slow_falling',0,100);}
   else if(flags&GRACE){p.removeEffect('regeneration');p.removeEffect('slow_falling');}
   const next=(health?HEALTH:0)|(sat?SATURATION:0)|(graceEffects?GRACE:0);
   if(next!==flags)p.setDynamicProperty(EFFECTS_KEY,next);
  }
  if(fill){const round=state().round,name=state().runner;
   const heal=()=>{const h=p.getComponent('minecraft:health');if(h&&h.currentValue>0)h.setCurrentValue(h.effectiveMax);};
   heal();system.run(()=>{try{if(p.isValid&&!isDead(p)&&state().round===round&&state().runner===name)heal();}catch(e){report('respawn heal',e);}});
  }
 }
 function tick(){const s=state();
  // Feature OFF short-circuits before any player/position lookup.
  if(!enabled('proximityWarning')){resetWarning();return;}
  if(!['grace','running'].includes(s.phase)){if(s.phase!=='paused')resetWarning();return;}
  const all=world.getAllPlayers(),r=all.find(p=>p.name===s.runner);if(!r||isDead(r)){warningBand=-1;pendingBand=-1;return;}
  if(warningRunner!==r.name||warningRound!==s.round){resetWarning();warningRunner=r.name;warningRound=s.round;}
  const distances=proximityDistances(s.config);let nearestSquared=Infinity;
  for(const p of all){if(p.name===s.runner||!s.roster.includes(p.name)||isDead(p)||p.dimension.id!==r.dimension.id)continue;
   const dx=p.location.x-r.location.x,dy=p.location.y-r.location.y,dz=p.location.z-r.location.z;
   nearestSquared=Math.min(nearestSquared,dx*dx+dy*dy+dz*dz);
  }
  let raw=-1;for(let i=0;i<4;i++)if(nearestSquared<=distances[i]*distances[i])raw=i;
  const previous=warningBand;
  if(raw>warningBand)warningBand=raw;
  // A two-block exit margin avoids repeated boundary crossings from small movements.
  else while(warningBand>raw&&nearestSquared>(distances[warningBand]+2)**2)warningBand--;
  if(warningBand>previous)pendingBand=warningBand;
  else if(warningBand<previous)pendingBand=-1;
  const cooldown=int(s.config.proximityCooldownSeconds,10,300)*20;
  if(pendingBand!==warningBand||pendingBand<0||system.currentTick-lastWarning[pendingBand]<cooldown)return;
  const band=pendingBand;lastWarning[band]=system.currentTick;pendingBand=-1;
  tell(r,`${band>=2?'§c':'§e'}${warningText[band]} §7(${distances[band]}블록 이내)`);
  if(s.config.proximitySound!==false)r.playSound('note.bass',{pitch:[0.6,0.85,1.1,1.4][band],volume:1});
 }
 function clearAll(){for(const p of world.getAllPlayers())if(!isDead(p))clear(p);resetWarning();}
 return {sync,clear,clearAll,tick,eligible};
}
