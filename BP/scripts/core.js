import {newExtra} from './expansion-core.js';
export const VERSION = '1.5.1';
export const TRACKER_UNLOCK_SECONDS = 15 * 60;
// All optional game systems are configurable. Core victory and data safety rules stay mandatory.
export const FEATURE_DEFAULTS = Object.freeze({
  autoPause:true,kitControls:true,lobbyMenuItem:true,
  tracker:true,trackerDelay:true,craftCompass:true,lastKnown:true,dimensionNotice:true,teammateHud:true,
  runnerHealth:true,runnerSaturation:true,graceBuffs:true,wildRespawns:true,proximityWarning:true,
  borders:true,fortressHint:true,endReward:true,receiver:true,receiverCamera:true,receiverBeam:true,reviveItem:true,summon:true
});
export const DEFAULT_CONFIG = Object.freeze({configVersion:2,grace:60,food:8,friendlyFire:false,keepInventory:false,trackerDelayMinutes:15,
 trackerMode:'random',randomCrafting:true,trackerRevealMinutes:20,trackerAutoMinutes:40,trackerAutoGive:true,
 trackerCommonMultiplier:1,trackerRareCount:6,trackerProgress:true,trackerNotices:true,trackerReacquire:false,
 proximityDistances:[90,60,40,10],proximitySound:true,proximityCooldownSeconds:10,wildRespawnBase:2,wildRespawnMax:3,
 summonDistance:350,summonCooldownSeconds:300,summonMaxUses:2,summonAcquire:'recipe',summonSound:true});
export function normalizeConfig(old={},migrateLegacy=false) {
  const legacy=migrateLegacy&&!old.configVersion;
  return {...DEFAULT_CONFIG,...old,...(legacy?{trackerMode:old.features?.craftCompass===false?'hud':'compass',wildRespawnBase:3}:{}),configVersion:2,
    proximityDistances:[...(old.proximityDistances??DEFAULT_CONFIG.proximityDistances)],features:{...FEATURE_DEFAULTS,...(old.features||{})}};
}
export function trackerMode(config){return config.trackerMode==='random'?(config.randomCrafting===false?'disabled':'random'):config.trackerMode;}
export function featureOn(config,key) {return config.features?.[key]!==false;}
export function unlockAfter(config){return featureOn(config,'trackerDelay')?Math.max(0,Math.min(30,Math.floor(config.trackerDelayMinutes??15)))*60:0;}

export const trackerUnlocked = seconds => seconds >= TRACKER_UNLOCK_SECONDS;
export const ACTIVE = ['countdown', 'grace', 'running'];
export const DIM_NAMES = {'minecraft:overworld':'오버월드','minecraft:nether':'네더','minecraft:the_end':'엔드'};
export function newState() {
  return {schema:1, phase:'lobby', host:'', runner:'', choice:'', roster:[], config:normalizeConfig(),
    seconds:0, remaining:0, previous:'running', routes:{}, deaths:{}, wins:{}, round:0, practice:false,
    start:null, lobby:null, result:'', kit:null, runnerRespawns:0,runnerLifeBonus:0,revivePending:null,trackerCraft:null,summon:null, runnerRespawning:false, pendingRunnerVictory:false,pendingOutcome:null, dragonDefeated:false, extra:newExtra()};
}
export function validateStart(names, runner, practice=false) {
  if (new Set(names).size !== names.length) return '참가자가 중복되었습니다.';
  if (!names.includes(runner)) return '접속 중인 러너를 선택해 주세요.';
  if (practice ? names.length !== 1 : names.length < 3 || names.length > 4)
    return practice ? '혼자 있을 때 연습할 수 있습니다.' : '정식 경기는 3~4명이 모두 접속해야 합니다.';
  return '';
}
export function tracking(from, yaw, target) {
  const dx=target.x-from.x, dz=target.z-from.z;
  const bearing=Math.atan2(-dx,dz)*180/Math.PI;
  const relative=((bearing-yaw)%360+360)%360;
  const frame=Math.round(relative/45)%8;
  return {frame,compassFrame:Math.round(relative/(360/32))%32,relative, arrow:['↑','↗','→','↘','↓','↙','←','↖'][frame], distance:Math.round(Math.hypot(dx,dz)), dy:Math.round(target.y-from.y)};
}
export function targetFor(dimension, runner, routes) {
  if (runner && runner.dimension===dimension) return {...runner.location, live:true};
  return routes[dimension] ? {...routes[dimension],live:false} : null;
}
export function outcome(runnerDied, dragonDied, runnerAlive) {
  if(runnerDied)return 'hunters';
  if(dragonDied&&runnerAlive)return 'runner';
  return null;
}
export function clock(seconds) {return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}

// Read-only, hunter-scoped direction HUD; never exposes the runner to teammates or vice versa.
export function teammateReadout(self, online, roster, runner, nameForDimension) {
  if(self.name===runner||!roster.includes(self.name))return '';
  const byName=new Map(online.map(p=>[p.name,p]));
  const members=roster.filter(name=>name!==runner&&name!==self.name);
  return members.map(name=>{
    const other=byName.get(name);
    if(!other)return `${name} 연결 끊김`;
    if(other.dimension.id!==self.dimension.id)return `${name} ${nameForDimension(other.dimension.id)}`;
    const t=tracking(self.location,self.getRotation().y,other.location);
    return `${name} ${t.arrow}${t.distance}m (${t.dy>=0?'+':''}${t.dy}Y)`;
  }).join(' §7| §f');
}
