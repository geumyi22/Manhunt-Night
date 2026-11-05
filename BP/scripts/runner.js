// Own only our passive/grace effects; do not clear unrelated potion effects each tick.
const EFFECTS_KEY='mh:runner_effects', HEALTH=1, SATURATION=2, GRACE=4;
export const MAX_WILD_RESPAWNS=3;
export function responsiblePlayer(source){
 for(const entity of [source?.damagingEntity,source?.damagingProjectile]){
  if(!entity)continue;
  if(entity.typeId==='minecraft:player')return entity;
  try{const owner=entity.getComponent('minecraft:projectile')?.owner;if(owner?.typeId==='minecraft:player')return owner;}catch{}
 }
 return null;
}
export function nearbyHunters(s,runner,players,isDead){
 return players.filter(p=>p.name!==s.runner&&s.roster.includes(p.name)&&!isDead(p)&&p.dimension.id===runner.dimension.id
  &&Math.hypot(p.location.x-runner.location.x,p.location.y-runner.location.y,p.location.z-runner.location.z)<=5);
}
export function createRunnerRules(world,system,state,{tell,isDead,report}){
 let lastWarning=-100,warningRunner='';
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
 function tick(){const s=state();if(!['grace','running'].includes(s.phase)||!enabled('proximityWarning')){lastWarning=-100;warningRunner='';return;}
  const all=world.getAllPlayers(),r=all.find(p=>p.name===s.runner);if(!r||isDead(r))return;
  if(warningRunner!==r.name){warningRunner=r.name;lastWarning=-100;}
  const close=nearbyHunters(s,r,all,isDead);
  if(close.length&&system.currentTick-lastWarning>=100){lastWarning=system.currentTick;tell(r,`§c경고! 5칸 이내에 헌터 ${close.length}명!`);r.playSound('note.bass');}
 }
 function clearAll(){for(const p of world.getAllPlayers())if(!isDead(p))clear(p);lastWarning=-100;warningRunner='';}
 return {sync,clear,clearAll,tick,eligible};
}
