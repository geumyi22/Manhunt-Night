import {world, system, Player, ItemStack, ItemLockMode, GameMode, InputPermissionCategory,
  CommandPermissionLevel, CustomCommandStatus, EquipmentSlot} from '@minecraft/server';
import {createExpansion} from './expansion.js';
import {modeForSeed,parseFortressWaypoint,legacyLobbyAreaClear} from './world-compat.js';
import {createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS,wildRespawnBudget,wildRespawnsRemaining,hunterKilledRunner,damageByHunter} from './runner.js';
import {createRunnerSpecial} from './runner-special.js';
import {createSummon} from './summon.js';
import {createTrackerCrafting} from './tracker-crafting.js';
import {createTrackerDisplay,TRACKER_NAME} from './tracker-display.js';
import {ActionFormData, ModalFormData, MessageFormData} from '@minecraft/server-ui';
import {VERSION, MIN_PLAYERS, MAX_PLAYERS, ACTIVE, DIM_NAMES, TRACKER_UNLOCK_SECONDS, trackerUnlocked, normalizeConfig, featureOn, trackerMode, unlockAfter, newState, validateStart, tracking, targetFor, outcome, clock, teammateReadout} from './core.js';

const KEY='mh:state', PREFIX='§b[맨헌트]§r ', MENU='mh:menu', KIT_WINDOW_SECONDS=60;
let s=newState(), loaded=false, building=false;
let resolving;
let countdownDeadline=0, countdownPausedTicks, nextGameSecondTick=0, gamePausedTicks;
const openForms=new Set(), sneaking=new Map(), pendingKits=new Set(), lastErrors=new Map();
const deadPlayers=new Set();
const knownPlayerNames=new Map();
const enabled=key=>featureOn(s.config,key);
const runnerRules=createRunnerRules(world,system,()=>s,{tell,report,isDead:p=>deadPlayers.has(p.name)});
const expansion=createExpansion(world,system,()=>s,{tell,inventory,ItemStack,report,isDead:p=>deadPlayers.has(p.name)});
const runnerSpecial=createRunnerSpecial(world,system,()=>s,{inventory,tell,report,save,isAdmin:p=>isHost(p),isDead:p=>deadPlayers.has(p.name)});
const summon=createSummon(world,system,()=>s,{inventory,tell,report,save,isAdmin:p=>isHost(p),isDead:p=>deadPlayers.has(p.name)});
const trackerCraft=createTrackerCrafting(world,system,()=>s,{inventory,tell,report,save,ItemStack,makeTracker:()=>makeTool('mh:tracker_0'),isDead:p=>deadPlayers.has(p.name)});
const trackerDisplay=createTrackerDisplay({inventory,makeTracker:makeTool});
const players=()=>world.getAllPlayers();
const find=name=>players().find(p=>p.name===name);
const member=p=>s.roster.includes(p.name);
const isHost=p=>p.name===s.host;
const running=()=>ACTIVE.includes(s.phase);
const hunter=p=>member(p)&&p.name!==s.runner;
const dimName=id=>DIM_NAMES[id]??id;
function report(where,e){const msg=String(e);if(lastErrors.get(where)!==msg){console.warn(`[Manhunt ${VERSION}] ${where}: ${msg}`);lastErrors.set(where,msg);}}
function attempt(where,fn){try{return fn();}catch(e){report(where,e);return undefined;}}
function tell(p,msg){attempt('message',()=>p.sendMessage(PREFIX+msg));}
function say(msg){world.sendMessage(PREFIX+msg);}
let lastSaved='';
function save(){const next=JSON.stringify(s);if(next!==lastSaved){world.setDynamicProperty(KEY,next);lastSaved=next;}}
function location(p){return {x:p.location.x,y:p.location.y,z:p.location.z};}
function inventory(p){return p.getComponent('minecraft:inventory')?.container;}
function isTracker(item){return item?.typeId.startsWith('mh:tracker_');}
function kitMark(){return `§8MH-STARTER-${s.round}`;}
function isStarter(item){return item?.typeId==='minecraft:bread'&&item.getLore?.().includes(kitMark());}
function starterStack(amount){const item=new ItemStack('minecraft:bread',amount);item.setLore([kitMark(),'§7맨헌트 시작 지급품']);return item;}
function starterState(){if(!s.kit||s.kit.round!==s.round)s.kit={round:s.round,enabled:true,stored:{}};return s.kit;}
function hasPendingStarter(kit){return Object.values(kit.stored).some(n=>n>0);}
// Only remove bread identifiable as this round's starting kit, never mined/crafted food.
function takeStarter(p){const inv=inventory(p);if(!inv)return 0;let removed=0;
  for(let i=0;i<inv.size;i++){const item=inv.getItem(i);if(!isStarter(item))continue;removed+=item.amount;inv.setItem(i);}
  const off=p.getComponent('minecraft:equippable');const item=off?.getEquipment?.(EquipmentSlot.Offhand);
  if(isStarter(item)){removed+=item.amount;off.setEquipment(EquipmentSlot.Offhand);}
  return removed;
}
function kitOff(p){
  if(!member(p)){tell(p,'현재 경기 참가자만 시작 지급품을 조작할 수 있습니다.');return;}
  if(!enabled('kitControls')){tell(p,'이번 경기에서 시작 지급품 제어 기능은 꺼져 있습니다.');return;}
  if(!['countdown','grace','running','paused'].includes(s.phase)||s.seconds>=KIT_WINDOW_SECONDS){tell(p,'시작 지급품 중지는 경기 시작 후 1분 안에만 가능합니다.');return;}
  const kit=starterState();if(!kit.enabled){tell(p,'기본 지급품은 이미 꺼져 있습니다. /mh:kiton 으로 복구하세요.');return;}
  if(s.roster.some(n=>!find(n))){tell(p,'참가자 전원이 접속해 있어야 전체 지급품을 변경할 수 있습니다.');return;}
  kit.enabled=false;let removed=0;
  for(const q of players().filter(member)){const n=takeStarter(q);kit.stored[q.name]=(kit.stored[q.name]??0)+n;removed+=n;}
  save();say(`${p.name}님이 전체 시작 지급품을 껐습니다. 제거한 빵 ${removed}개 · /mh:kiton 으로 남은 수량 복구`);
}
function kitOn(p){
  if(!member(p)){tell(p,'현재 경기 참가자만 시작 지급품을 조작할 수 있습니다.');return;}
  if(!enabled('kitControls')){tell(p,'이번 경기에서 시작 지급품 제어 기능은 꺼져 있습니다.');return;}
  if(!['countdown','grace','running','paused'].includes(s.phase)){tell(p,'경기 중에만 시작 지급품을 복구할 수 있습니다.');return;}
  const kit=starterState();if(kit.enabled&&!hasPendingStarter(kit)){tell(p,'기본 지급품이 이미 켜져 있습니다.');return;}
  kit.enabled=true;let returned=0;
  for(const q of players().filter(member)){
    const n=kit.stored[q.name]??0;if(!n)continue;
    const inv=inventory(q);if(!inv)continue;
    const rest=inv.addItem(starterStack(n));const left=rest?.amount??0;
    kit.stored[q.name]=left;returned+=n-left;
    if(left)tell(q,`인벤토리 여유 공간이 부족해 시작 지급품 ${left}개가 보관 중입니다. 빈 칸을 만든 뒤 /mh:kiton 을 입력하세요.`);
  }
  save();say(`${p.name}님이 전체 시작 지급품을 켰습니다. 복구한 빵 ${returned}개${hasPendingStarter(kit)?' · 인벤토리 공간 부족으로 일부 보류':''}`);
}
function trackerReady(){if(!enabled('tracker'))return false;const mode=trackerMode(s.config);return mode==='random'?trackerCraft.ready():mode==='disabled'?false:s.seconds>=unlockAfter(s.config);}
function trackerWait(){return clock(Math.max(0,(trackerMode(s.config)==='random'?s.config.trackerRevealMinutes*60:unlockAfter(s.config))-s.seconds));}
function removeEarlyTrackers(p){/* Eligibility is checked at use/display; items are never deleted to enforce a timer. */}
function makeTool(type){const item=new ItemStack(type,1);
  // Both menu and crafted tracker are ordinary items: no inventory lock or free death retention.
  item.setLore(type===MENU?['§7들고 웅크리기: 메뉴 열기','§7버려도 됩니다 · /mh:item 재지급','§7아이템 없이 /mh:menu']:['§7붉은 바늘: 러너 또는 마지막 이동 위치','§7실시간/마지막 위치는 HUD에서 구분','§7제작법과 진행도: /mh:trackerrecipe']);if(type!==MENU)item.nameTag=TRACKER_NAME;return item;}
// Convert legacy locked menus and reduce duplicate inventory copies in-place.
// Never grant a missing menu here: a player must be allowed to discard it.
function normalizeMenu(p){const inv=inventory(p);if(!inv)return false;let found=false;
  for(let i=0;i<inv.size;i++){const item=inv.getItem(i);if(item?.typeId!==MENU)continue;
    if(found){inv.setItem(i);continue;}
    found=true;
    if(item.keepOnDeath||item.lockMode!==ItemLockMode.none||item.amount!==1)inv.setItem(i,makeTool(MENU));
  }
  return found;
}
function giveMenu(p){if(!['lobby','ended'].includes(s.phase)){tell(p,'경기 중에는 메뉴 아이템을 지급하지 않습니다. /mh:menu 로 관리 메뉴를 열어 주세요.');return;}const inv=inventory(p);if(!inv)return;
  if(normalizeMenu(p)){tell(p,'메뉴 아이템이 이미 인벤토리에 있습니다. 아이템 없이 /mh:menu 도 가능합니다.');return;}
  if(inv.emptySlotsCount<1){tell(p,'인벤토리에 빈 칸이 없습니다. 한 칸 비우고 /mh:item 을 입력하세요.');return;}
  const rest=inv.addItem(makeTool(MENU));
  if(rest){tell(p,'인벤토리에 빈 칸이 없습니다. 한 칸 비우고 다시 시도하세요.');return;}
  tell(p,'메뉴 아이템을 지급했습니다. 자유롭게 이동하거나 버릴 수 있습니다.');
}
// Only the menu is given at the beginning; hunters must craft/find a vanilla compass.
function ensureMenu(p){if(!enabled('lobbyMenuItem'))return;const inv=inventory(p);if(!inv||normalizeMenu(p)||inv.emptySlotsCount<1)return;inv.addItem(makeTool(MENU));}
// Convert ONE held vanilla compass into a fully droppable tracking compass, never generating items.
function upgradeHeldCompass(p){
  if(!hunter(p)||!trackerReady()||!['grace','running'].includes(s.phase))return false;
  const mode=trackerMode(s.config);if(mode!=='compass'&&!(mode==='random'&&s.config.trackerReacquire))return false;
  const inv=inventory(p);if(!inv)return false;
  const i=p.selectedSlotIndex,item=inv.getItem(i);
  if(item?.typeId!=='minecraft:compass')return false;
  const remaining=Math.max(0,item.amount-1);
  inv.setItem(i,makeTool('mh:tracker_0'));
  if(remaining){
    const rest=inv.addItem(new ItemStack('minecraft:compass',remaining));
    if(rest) p.dimension.spawnItem(rest,p.location); // Do not destroy extra compasses in a full inventory.
  }
  trackerDisplay.scan(p);tell(p,'일반 나침반 1개를 추적기로 전환했습니다. 다시 필요하면 나침반을 제작하세요.');
  return true;
}
// Old v1.2.2 locked trackers become normal droppable items. This does not grant extras.
function unlockExistingTrackers(p){const inv=inventory(p);if(!inv)return;for(let i=0;i<inv.size;i++){
  const item=inv.getItem(i);if(isTracker(item)&&(item.keepOnDeath||item.lockMode===ItemLockMode.inventory)){
    inv.setItem(i,makeTool(item.typeId));
  }
}}
function stripMenus(p){const inv=inventory(p);if(inv)for(let i=0;i<inv.size;i++)if(inv.getItem(i)?.typeId===MENU)inv.setItem(i);
  const off=p.getComponent('minecraft:equippable');if(off?.getEquipment?.(EquipmentSlot.Offhand)?.typeId===MENU)off.setEquipment(EquipmentSlot.Offhand);
}
function stripTools(p){const inv=inventory(p);if(!inv)return;for(let i=0;i<inv.size;i++){const it=inv.getItem(i);if(it?.typeId===MENU||isTracker(it))inv.setItem(i);}}
function movement(p,enabled){p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement,enabled);}
function heal(p){for(const e of p.getEffects())p.removeEffect(e.typeId);p.extinguishFire();runnerRules.sync(p,true);if(!runnerRules.eligible(p))p.addEffect('saturation',20,{amplifier:10,showParticles:false});}
function clearPlayer(p){inventory(p)?.clearAll();const eq=p.getComponent('minecraft:equippable');for(const slot of [EquipmentSlot.Head,EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet,EquipmentSlot.Offhand])eq?.setEquipment(slot);p.resetLevel();heal(p);}
function teleport(p,loc){p.teleport(loc,{dimension:world.getDimension('overworld'),rotation:{x:0,y:0}});}
function lobbyPlayer(p,clear=false){if(!s.lobby)return;runnerRules.clear(p);if(clear)clearPlayer(p);movement(p,true);p.setGameMode(GameMode.Adventure);teleport(p,s.lobby);if(s.worldMode!=='portable')p.setSpawnPoint({...s.lobby,dimension:world.getDimension('overworld')});stripTools(p);ensureMenu(p);}
function titleAll(title,subtitle){for(const p of players())attempt('title',()=>p.onScreenDisplay.setTitle(title,{subtitle,stayDuration:60,fadeInDuration:5,fadeOutDuration:15}));}
function sound(id){for(const p of players())attempt('sound',()=>p.playSound(id));}

function* buildLobby(p){
  building=true;
  const d=world.getDimension('overworld'),base=location(p);
  s.worldMode=modeForSeed(world.seed);
  if(s.worldMode==='classic'&&!legacyLobbyAreaClear(d,Math.floor(base.x),Math.floor(base.z)))s.worldMode='portable';
  if(s.worldMode==='portable'){
    // External maps keep all blocks, terrain and the global world spawn untouched.
    if(p.dimension.id!=='minecraft:overworld')throw Error('외부 맵의 초기 설정은 오버월드에서 진행해 주세요.');
    if(![base.x,base.y,base.z].every(Number.isFinite))throw Error('플레이어의 안전한 시작 좌표를 확인할 수 없습니다.');
    s.start={...base};s.lobby={...base};
    s.host=p.name;s.phase='lobby';save();building=false;
    // Do not wipe a guest's inventory just by loading this addon onto an existing world.
    for(const q of players())lobbyPlayer(q,false);
    say('§lMANHUNT NIGHT§r 다른 맵 모드 준비 완료! 기존 블록·지형·월드 스폰은 변경하지 않았습니다.');
    tell(p,'경기 시작 시 참가자의 인벤토리가 초기화됩니다. 네더 요새 힌트는 관리 메뉴에서 실제 좌표를 등록하세요.');
    system.runTimeout(()=>showMenu(p),40);
    return;
  }
  let top=d.getTopmostBlock({x:Math.floor(base.x),z:Math.floor(base.z)});
  if(!top)throw Error('시작 지형이 아직 로드되지 않았습니다.');
  s.start={x:Math.floor(base.x)+0.5,y:top.location.y+1,z:Math.floor(base.z)+0.5};
  // Legacy original-seed platform; existing v1.6.0 source-world behavior retained.
  const cx=Math.floor(base.x),cz=Math.floor(base.z),y=304;
  s.lobby={x:cx+0.5,y:y+1,z:cz+0.5};
  d.runCommand(`tickingarea add circle ${cx} ${y} ${cz} 2 mh_lobby true`);
  yield;
  for(let x=-10;x<=10;x++){
    for(let z=-10;z<=10;z++){
      const edge=Math.abs(x)===10||Math.abs(z)===10;
      d.getBlock({x:cx+x,y,z:cz+z})?.setType(edge?'minecraft:sea_lantern':x<0?'minecraft:cyan_concrete':x>0?'minecraft:red_concrete':'minecraft:polished_deepslate');
      for(let h=1;h<=5;h++)d.getBlock({x:cx+x,y:y+h,z:cz+z})?.setType(edge&&h<=2?'minecraft:glass':'minecraft:air');
    }yield;
  }
  for(const [x,z] of [[-8,-8],[8,-8],[-8,8],[8,8]]){
    for(let h=1;h<=4;h++)d.getBlock({x:cx+x,y:y+h,z:cz+z})?.setType('minecraft:polished_deepslate');
    d.getBlock({x:cx+x,y:y+5,z:cz+z})?.setType('minecraft:sea_lantern');yield;
  }
  world.setDefaultSpawnLocation(s.lobby);
  world.gameRules.pvp=true;world.gameRules.keepInventory=Boolean(s.config.keepInventory);world.gameRules.doImmediateRespawn=true;world.gameRules.spawnRadius=0;
  world.gameRules.showCoordinates=false;world.gameRules.sendCommandFeedback=false;
  d.runCommand('gamerule playerwaypoints off');
  s.host=p.name;s.phase='lobby';save();building=false;
  for(const q of players())lobbyPlayer(q,true);
  say('§lMANHUNT NIGHT§r 준비 완료! 파란색은 러너, 빨간색은 헌터입니다.');
  tell(p,'관리자입니다. 메뉴 아이템을 들고 웅크리거나 /mh:menu 를 입력하세요.');
  console.warn(`[Manhunt ${VERSION}] READY lobby=${JSON.stringify(s.lobby)} start=${JSON.stringify(s.start)}`);
  system.runTimeout(()=>showMenu(p),40);
}
function initializePlayer(p){
  knownPlayerNames.set(p.id,p.name);
  if(!loaded||building)return;
  trackerDisplay.scan(p);summon.joined(p);runnerSpecial.joined();trackerCraft.joined(p);
  if(['lobby','ended'].includes(s.phase))normalizeMenu(p);else stripMenus(p);unlockExistingTrackers(p);
  if(!s.lobby){if(!building)system.runJob((function*(){try{yield* buildLobby(p);}catch(e){building=false;report('build lobby',e);tell(p,'로비 준비 오류입니다. /mh:menu 로 다시 시도해 주세요.');}})());return;}
  if(!s.host){s.host=p.name;save();}
  if(s.phase==='lobby'||s.phase==='ended'){lobbyPlayer(p,false);return;}
  if(!member(p)){movement(p,true);p.setGameMode(GameMode.Spectator);tell(p,'진행 중인 경기에는 관전자로 입장합니다.');return;}
  stripMenus(p);removeEarlyTrackers(p);
  // Reconnecting must not re-create a deliberately discarded menu. /mh:item is opt-in.
  applyPhase(p);
}
function applyPhase(p){
  if(!member(p))return;
  const waiting=s.phase==='countdown'||s.phase==='grace'&&hunter(p);
  movement(p,s.phase!=='paused'&&!waiting);
  const mode=waiting||s.phase==='paused'?GameMode.Adventure:GameMode.Survival;
  if(p.getGameMode()!==mode)p.setGameMode(mode);runnerRules.sync(p);
}
function activeRules(){const d=world.getDimension('overworld');world.gameRules.pvp=true;world.gameRules.keepInventory=Boolean(s.config.keepInventory);world.gameRules.doImmediateRespawn=true;world.gameRules.spawnRadius=0;world.gameRules.doDayLightCycle=true;world.gameRules.doMobSpawning=true;d.runCommand('gamerule playerwaypoints off');d.runCommand('difficulty normal');}
function startRound(p,practice=false){
  if(!isHost(p)||!['lobby','ended'].includes(s.phase))return;
  if(runnerSpecial.hasPending()&&!runnerSpecial.recover()){tell(p,'부활 거래 복구가 끝나야 진행할 수 있습니다.');return;}
  if(summon.hasPending()&&!summon.recover(true)){tell(p,'소집 복구가 끝나야 새 경기를 시작할 수 있습니다.');return;}
  if(s.dragonDefeated){tell(p,'드래곤이 처치된 월드입니다. 새 판은 원본 .mcworld를 다시 가져와 시작하세요.');return;}
  const names=players().map(q=>q.name);const runner=practice?p.name:(s.choice||names[Math.floor(Math.random()*names.length)]);
  if(names.some(name=>deadPlayers.has(name))){tell(p,'모든 참가자가 부활한 뒤 시작해 주세요.');return;}
  const error=validateStart(names,runner,practice);if(error){tell(p,error);return;}
  expansion.reset();s.runner=runner;s.roster=names;s.round++;s.practice=practice;s.seconds=0;s.remaining=5;s.phase='countdown';s.routes={};s.deaths={};s.result='';s.runnerRespawns=0;s.runnerLifeBonus=0;runnerSpecial.reset();trackerDisplay.reset();summon.reset();s.runnerRespawning=false;s.pendingRunnerVictory=false;s.pendingOutcome=null;s.kit={round:s.round,enabled:true,stored:{}};
  countdownDeadline=system.currentTick+100;countdownPausedTicks=undefined;gamePausedTicks=undefined;
  trackerCraft.startRound();activeRules();world.setTimeOfDay(1000);world.getDimension('overworld').runCommand('weather clear');
  for(const q of players()){clearPlayer(q);teleport(q,s.lobby);q.setSpawnPoint({...s.start,dimension:world.getDimension('overworld')});
    if(s.config.food)inventory(q)?.addItem(starterStack(s.config.food));
    // No menu, legacy tracker, or other out-of-game tools may enter the round.
    stripMenus(q);applyPhase(q);}
  save();say(`${practice?'§e연습 경기':'§a정식 경기'} §r| 러너 §b${runner}§r | 헌터 ${names.length-1}명`);
  if(!practice&&enabled('tracker')&&['compass','hud'].includes(trackerMode(s.config)))say(`§e추적기: ${enabled('craftCompass')?'나침반 직접 제작':'나침반 없이 HUD 추적'} · ${unlockAfter(s.config)/60}분 후 해금!`);
  say(enabled('kitControls')?'§7경기 시작 시 메뉴 아이템 제거 · 시작 지급품은 첫 1분 안에 /mh:kitoff, /mh:kiton 제어':'§7경기 시작 시 메뉴 아이템 제거 · 시작 지급품 제어 OFF');
  titleAll('§e5','잠시 후 러너 출발');sound('note.pling');
}
function countdownTick(){
  if(!loaded||building||s.phase!=='countdown')return;
  if(enabled('autoPause')&&s.roster.some(name=>!find(name))){pause('참가자 재접속 대기');return;}
  const ticks=Math.max(0,countdownDeadline-system.currentTick);
  if(ticks===0){releaseRunner();trackerCraft.second();expansion.second();save();return;}
  const remaining=Math.ceil(ticks/20);
  if(s.remaining!==remaining){s.remaining=remaining;save();titleAll(`§e${remaining}`,'잠시 후 러너 출발');sound('note.pling');}
}
function roundTimerTick(){
  if(!loaded||building||!s.lobby||!running())return;
  if(s.phase==='countdown'){countdownTick();return;}
  if(system.currentTick<nextGameSecondTick)return;
  if(enabled('autoPause')&&s.roster.some(name=>!find(name))){pause('참가자 재접속 대기');return;}
  nextGameSecondTick+=20;s.seconds++;
  if(s.phase==='grace'){s.remaining--;if(s.remaining<=0)releaseHunters();else if(s.remaining<=5)sound('note.pling');}
  if(enabled('tracker')&&trackerMode(s.config)!=='random'&&trackerMode(s.config)!=='disabled'&&unlockAfter(s.config)>0&&s.seconds===unlockAfter(s.config)){
    say(enabled('craftCompass')?'§a추적 해금! 직접 제작한 나침반을 들면 추적기로 전환됩니다.':'§a추적 해금! 헌터에게 자동 HUD 추적이 시작됩니다.');sound('random.levelup');}
  trackerCraft.second();expansion.second();save();
}
function releaseRunner(){countdownDeadline=0;countdownPausedTicks=undefined;nextGameSecondTick=system.currentTick+20;s.phase=s.config.grace?'grace':'running';s.remaining=s.config.grace;const r=find(s.runner);if(r&&!deadPlayers.has(r.name)){teleport(r,s.start);heal(r);}
  if(!s.config.grace){releaseHunters();return;}
  for(const p of players())applyPhase(p);save();titleAll('§b러너 출발!',`헌터 출발까지 ${s.remaining}초`);sound('random.levelup');}
function releaseHunters(){s.phase='running';s.remaining=0;for(const p of players()){if(hunter(p)){teleport(p,s.start);heal(p);}applyPhase(p);}save();titleAll('§c추격 시작','러너는 엔더드래곤을, 헌터는 러너를!');sound('raid.horn');}
function pause(reason){if(!running())return;
  if(s.phase==='countdown'){countdownPausedTicks=Math.max(0,countdownDeadline-system.currentTick);s.remaining=Math.ceil(countdownPausedTicks/20);countdownDeadline=0;}
  else gamePausedTicks=Math.max(0,nextGameSecondTick-system.currentTick);
  trackerCraft.clearSessions();expansion.clearAll();s.previous=s.phase;s.phase='paused';for(const p of players())applyPhase(p);save();say('§e일시정지: '+reason);}
function resume(p){if(!isHost(p)||s.phase!=='paused')return;const missing=s.roster.filter(n=>!find(n));if(missing.length){tell(p,'재접속 대기: '+missing.join(', '));return;}s.phase=s.previous;
  // Preserve sub-second ticks during a live pause; after reload retain the saved
  // integer remaining seconds, never reuse a previous world's absolute tick.
  if(s.phase==='countdown'){countdownDeadline=system.currentTick+(countdownPausedTicks??Math.max(0,Math.round(s.remaining*20)));countdownPausedTicks=undefined;}
  else {nextGameSecondTick=system.currentTick+(gamePausedTicks??20);gamePausedTicks=undefined;}
  for(const q of players())applyPhase(q);save();say('경기를 재개했습니다.');}
function finish(winner){if(!running()&&s.phase!=='paused')return;trackerCraft.clearSessions();expansion.clearAll();runnerRules.clearAll();s.pendingOutcome=null;s.pendingRunnerVictory=false;s.runnerRespawning=false;s.phase='ended';s.result=winner==='runner'?'러너 승리':'헌터 승리';
  if(winner==='runner')s.dragonDefeated=true;
  if(!s.practice){for(const name of s.roster){if((winner==='runner')===(name===s.runner))s.wins[name]=(s.wins[name]||0)+1;}}
  save();for(const p of players()){if(deadPlayers.has(p.name))continue;movement(p,true);p.setGameMode(GameMode.Adventure);heal(p);ensureMenu(p);}
  titleAll(winner==='runner'?'§b러너 승리!':'§c헌터 승리!',`기록 ${clock(s.seconds)}${s.practice?' · 연습':''}`);sound('random.levelup');
  say(`${s.result}! 경기 시간 ${clock(s.seconds)}. 메뉴에서 로비로 돌아갈 수 있습니다.`);
}
function queueOutcome(runnerDied=false,dragonDied=false){
  if(runnerDied||dragonDied){
    const pending=s.pendingOutcome?.round===s.round?s.pendingOutcome:{round:s.round,runnerDied:false,dragonDied:false};
    pending.runnerDied||=runnerDied;pending.dragonDied||=dragonDied;s.pendingOutcome=pending;save();
  }
  const pending=s.pendingOutcome;
  if(!pending||pending.round!==s.round||(!running()&&s.phase!=='paused')||resolving===pending)return;
  resolving=pending;
  system.run(()=>{
    if(resolving===pending)resolving=undefined;
    // A reset or a new round invalidates this exact journal, even if its callback is still queued.
    if(s.pendingOutcome!==pending||pending.round!==s.round||(!running()&&s.phase!=='paused'))return;
    if(pending.dragonDied&&s.runnerRespawning&&!pending.runnerDied)s.pendingRunnerVictory=true;
    const winner=outcome(pending.runnerDied,pending.dragonDied,!pending.runnerDied&&!s.runnerRespawning&&!deadPlayers.has(s.runner));
    s.pendingOutcome=null;if(winner)finish(winner);else save();
  });
}
function reset(p){if(!isHost(p))return;if(runnerSpecial.hasPending()&&!runnerSpecial.recover()){tell(p,'부활 거래 복구가 끝나야 진행할 수 있습니다.');return;}
  if(summon.hasPending()&&!summon.recover(true)){tell(p,'소집 복구가 끝나야 초기화할 수 있습니다.');return;}trackerCraft.reset();expansion.reset();runnerRules.clearAll();s.runnerRespawns=0;s.runnerLifeBonus=0;runnerSpecial.reset();trackerDisplay.reset();summon.reset();s.runnerRespawning=false;s.pendingRunnerVictory=false;s.pendingOutcome=null;s.phase='lobby';s.roster=[];s.seconds=0;s.remaining=0;s.routes={};s.practice=false;s.kit=null;pendingKits.clear();
  for(const q of players())if(!deadPlayers.has(q.name))lobbyPlayer(q,true);save();say('로비로 돌아왔습니다. 경기 상태와 소지품이 초기화되었습니다. 지형은 유지됩니다.');}

async function form(p,f){if(openForms.has(p.id))return null;openForms.add(p.id);try{return await f.show(p);}catch(e){report('form',e);return null;}finally{openForms.delete(p.id);}}
async function confirm(p,title,body,action){const r=await form(p,new MessageFormData().title(title).body(body).button1('취소').button2('확인'));if(r&&!r.canceled&&r.selection===1)action();}
async function showMenu(p){
  if(!loaded)return;
  if(!s.lobby){initializePlayer(p);return;}
  const status={lobby:'대기실',countdown:'출발 준비',grace:'러너 도주 중',running:'추격 중',paused:'일시정지',ended:s.result}[s.phase];
  const f=new ActionFormData().title('§lMANHUNT NIGHT').body(`§b${status}§r  ·  ${clock(s.seconds)}\n러너: ${s.runner||'시작 시 무작위'}\n접속 ${players().length}명 · 관리자 ${s.host}\n\n§7게임 중 메뉴 아이템 없음 · /mh:menu 사용\n§7시작 지급품: /mh:kitoff · /mh:kiton (누구나 전원 적용)`);
  const actions=[];const add=(label,fn)=>{f.button(label);actions.push(fn);};
  if(isHost(p)){
    if(['lobby','ended'].includes(s.phase)){
      add(`§a▶  경기 시작 · ${MIN_PLAYERS}~${MAX_PLAYERS}명`,()=>confirm(p,'경기 시작','접속한 전원이 참가합니다. 소지품·장비·경험치를 초기화하고 시작합니다.',()=>startRound(p)));
      add('러너 선택 / 무작위',()=>selectRunner(p));add('§b게임 설정 · 기능별 ON/OFF',()=>settings(p));
      if(players().length===1)add('혼자 연습 · 러너',()=>confirm(p,'혼자 연습','시작·도주·사망·승패 흐름을 연습합니다. 소지품이 초기화되며 전적에는 반영되지 않습니다.',()=>startRound(p,true)));
    }
    if(running())add('일시정지',()=>pause('관리자 요청'));
    if(s.phase==='paused')add('§a경기 재개',()=>resume(p));
    if(s.phase!=='lobby')add('로비로 / 경기 초기화',()=>confirm(p,'경기 초기화','모두 로비로 이동하고 소지품·장비·경험치가 초기화됩니다. 지형·상자·드래곤은 복원되지 않습니다.',()=>reset(p)));
  }
  if(isHost(p))add('다른 맵 / 네더 요새 좌표 관리',()=>fortressSetup(p));
  if(s.phase==='ended')add('로비로 이동',()=>lobbyPlayer(p,false));
  if(isHost(p)&&s.trackerCraft?.pending)add('중단된 제작 거래 확인 / 복구',()=>recoverCraft(p));
  if(isHost(p)&&summon.hasPending())add('중단된 소집 복구',()=>recoverSummon(p));
  if(isHost(p)&&runnerSpecial.hasPending())add('중단된 부활 거래 확인',()=>recoverRevive(p));
  if(hunter(p)){add('추적기 제작법 / 진행도',()=>recipeMenu(p));add('재료 투척 제작 모드 켜기 / 끄기',()=>trackerCraft.toggle(p));}
  add('러너 패시브 / 부활 / 접근 알림',()=>runnerHelp(p));
  add('구역 / 요새 안내 / 수신기',()=>expansionHelp(p));
  add('규칙 / 추적 사용법',()=>help(p));add('전적 / 진단',()=>diagnostics(p));
  const r=await form(p,f);if(r&&!r.canceled)await actions[r.selection]?.();
}
async function selectRunner(p){const names=players().map(q=>q.name), f=new ActionFormData().title('러너 선택').body('한 명이 러너, 나머지는 모두 헌터입니다.').button('매 경기 무작위');names.forEach(n=>f.button(n));const r=await form(p,f);if(r&&!r.canceled&&isHost(p)&&['lobby','ended'].includes(s.phase)){s.choice=r.selection===0?'':names[r.selection-1];s.runner=s.choice;save();tell(p,'러너: '+(s.choice||'무작위'));}}
// Sectioned forms avoid giant mobile dialogs. Changes apply to the NEXT round only.
const GROUPS=[
  {title:'① 기본 경기 / 지급품',fields:[
    ['slider','grace','러너 도주 유예 (초)',0,180,15],['slider','food','시작 지급 빵 (개)',0,16,1],
    ['bool','friendlyFire','헌터 팀 피해 허용'],['bool','keepInventory','인벤토리 유지'],
    ['feature','autoPause','참가자 이탈 시 자동 일시정지'],['feature','kitControls','시작 지급품 /mh:kitoff · kiton'],
    ['feature','lobbyMenuItem','로비 메뉴 아이템 자동 지급']]},
  {title:'② 추적 / 헌터 정보',fields:[
    ['feature','tracker','러너 추적 기능'],['feature','trackerDelay','기존 모드 해금 시간 적용'],
    ['slider','trackerDelayMinutes','기존 모드 해금까지 (분)',0,30,5],
    ['feature','craftCompass','기존 모드: 직접 나침반 (OFF=자동 HUD)'],
    ['feature','lastKnown','차원 이동 전 마지막 위치 추적'],
    ['feature','dimensionNotice','러너 차원 이동 알림'],
    ['feature','teammateHud','헌터 팀원 방향·거리 표시']]},
  {title:'③ 러너 능력 / 부활',fields:[
    ['feature','runnerHealth','추가 체력 20HP'],['feature','runnerSaturation','러너 포만감 효과'],
    ['feature','graceBuffs','도주 유예 중 회복·낙하 완화'],
    ['feature','wildRespawns','러너 야생 부활 허용 (횟수는 상세 설정)' ],
    ['feature','proximityWarning','러너 4단계 접근 경고']]},
  {title:'④ 월드 / 안내 / 보상',fields:[
    ['feature','borders','월드 구역 경계 제한'],
    ['feature','fortressHint','러너 요새 좌표 힌트'],
    ['feature','endReward','러너 엔드 첫 입장 눈 32개 보상']]},
  {title:'⑤ 신호 수신기',fields:[
    ['feature','receiver','러너 신호 수신기 사용'],
    ['feature','receiverCamera','헌터 카메라 3초 전환'],
    ['feature','receiverBeam','녹색 신호 광선 표시']]}
];
async function settings(p){
  if(!isHost(p)||!['lobby','ended'].includes(s.phase))return;
  const f=new ActionFormData().title('§l맨헌트 게임 설정').body('기능별로 설정을 변경합니다. §e모든 변경은 다음 경기부터 적용§r됩니다.\n§7승패 판정·세이브 보호 등 필수 엔진은 항상 활성화됩니다.');
  for(const g of GROUPS)f.button(g.title);
  const r=await form(p,f);if(r&&!r.canceled&&GROUPS[r.selection])await settingsCategory(p,r.selection);
}
async function settingsSection(p,index){
  if(!isHost(p)||!['lobby','ended'].includes(s.phase))return;
  const group=GROUPS[index],ui=new ModalFormData().title(group.title);
  for(const [kind,key,label,min,max,step] of group.fields){
    if(kind==='slider')ui.slider(String(label),Number(min),Number(max),{valueStep:Number(step),defaultValue:Number(s.config[key])});
    else ui.toggle(String(label),{defaultValue:kind==='feature'?enabled(key):Boolean(s.config[key])});
  }
  const r=await form(p,ui);
  if(!r||r.canceled||!isHost(p)||!['lobby','ended'].includes(s.phase))return;
  if(!Array.isArray(r.formValues)||r.formValues.length!==group.fields.length){tell(p,'잘못된 설정 응답입니다. 변경되지 않았습니다.');return;}
  const next=normalizeConfig(s.config);
  group.fields.forEach(([kind,key,_label,min,max,step],i)=>{
    const value=r.formValues[i];
    if(kind==='feature')next.features[key]=Boolean(value);
    else if(kind==='bool')next[key]=Boolean(value);
    else {const n=Number(value);if(!Number.isFinite(n)||n<Number(min)||n>Number(max)||((n-Number(min))%Number(step))!==0)throw Error('설정 값 범위 오류: '+key);next[key]=n;}
  });
  if(index===1&&next.trackerMode!=='random')next.trackerMode=next.features.craftCompass?'compass':'hud';
  s.config=next;world.gameRules.keepInventory=next.keepInventory;save();
  if(group.fields.some(field=>field[1]==='lobbyMenuItem'))for(const q of players())enabled('lobbyMenuItem')?ensureMenu(q):stripMenus(q);
  tell(p,`${group.title} 설정 저장 완료. 다음 경기부터 적용됩니다.`);
}
async function help(p){await form(p,new ActionFormData().title('맨헌트 규칙 · v1.7.0').body(
  '§b승패§r: 러너가 살아 있는 동안 엔더 드래곤이 죽으면 러너 승리, 러너의 최종 사망은 헌터 승리입니다. 이 핵심 규칙은 끌 수 없습니다.\n\n§e옵션 기능§r: 로비에서 관리자 → 게임 설정 → ①기본 경기, ②추적/헌터, ③러너, ④월드, ⑤수신기 항목별로 ON/OFF. 다음 경기부터 적용됩니다.\n\n§e추적§r: 새 월드는 20분에 헌터에게 무작위 제작법 공개, 순서대로 투척해 팀 공동 제작, 미완성 팀은 40분에 1인 1개 지급합니다. /mh:trackerrecipe · /mh:craft. 분실 시 기본 재지급 없음. 기존 월드는 저장된 추적 방식을 유지하며 설정에서 변경합니다.\n\n§a러너§r: 추가 체력, 포만감, 도주 유예 버프, 야생 사망 기본 2회 부활, 4단계 접근 경보를 각각 끌 수 있습니다. 부활을 끄면 첫 사망에 패배합니다.\n\n§d추가 기능§r: 경계 제한, 요새 힌트, 엔드 보상, 수신기(카메라/광선 분리), 자동 일시정지, 시작 지급품 제어를 설정할 수 있습니다.\n\n경기 중 메뉴 아이템은 제거되고 /mh:menu 명령어로 관리 메뉴를 열 수 있습니다. 지급품 제어가 켜져 있다면 /mh:kitoff · /mh:kiton을 이용하세요.\n\n새로운 지형·드래곤으로 다시 시작하려면 원본 .mcworld를 새로 가져오세요.').button('확인'));}
async function diagnostics(p){const wins=Object.entries(s.wins).map(([n,v])=>`${n}: ${v}승`).join('\n')||'아직 정식 경기 기록이 없습니다.';
  const r=await form(p,new ActionFormData().title('전적 / 상태').body(`버전 ${VERSION} · 정식 API\n상태 ${s.phase} · ${s.practice?'연습':'정식'}\n현재 경기 ${s.round} · 시간 ${clock(s.seconds)}\n${wins}\n\n시작 좌표 ${s.start?`${Math.floor(s.start.x)}, ${Math.floor(s.start.y)}, ${Math.floor(s.start.z)}`:'준비 중'}\n감지된 오류 ${lastErrors.size}개`).button('확인').button('추적기 표시 점검 (10초)'));
  if(r&&!r.canceled&&r.selection===1){
    if(!['lobby','ended'].includes(s.phase)&&!trackerReady()){tell(p,`추적기 개방까지 ${trackerWait()} 남았습니다. 경기 중에는 미리 테스트할 수 없습니다.`);return;}
    const origin=location(p);tell(p,'10초 동안 가상 표식 방향을 화면에 표시합니다. 테스트로 추적기를 지급하지 않습니다.');
    let n=0;const id=system.runInterval(()=>{if(++n>40||!p.isValid){system.clearRun(id);return;}
      const t=tracking(p.location,p.getRotation().y,{x:origin.x,y:origin.y,z:origin.z+30});
      p.onScreenDisplay.setActionBar(`§e표시 점검 §f${t.arrow} ${t.distance}m §7| 높이 ${t.dy>=0?'+':''}${t.dy} §8| TEST`);
    },5);}}

function drawTracker(p,target,label,test=false,team=''){const t=tracking(p.location,p.getRotation().y,target);const inv=inventory(p);if(!inv)return;const item=inv.getItem(p.selectedSlotIndex);if(!isTracker(item))return;
  trackerDisplay.update(p,target);
  p.onScreenDisplay.setActionBar(`${label} §f${t.arrow} ${t.distance}m §7| 높이 ${t.dy>=0?'+':''}${t.dy} §8| ${test?'TEST':clock(s.seconds)}${team?'\n§a팀원 §f'+team:''}`);}
function updateHUD(p){if(!s.lobby||deadPlayers.has(p.name))return;
  if(hunter(p)&&trackerReady()&&running())upgradeHeldCompass(p);
  const inv=inventory(p),held=inv?.getItem(p.selectedSlotIndex),tool=held?.typeId===MENU&&['lobby','ended'].includes(s.phase);
  // Private hunter-only teammate directions. No use of the global player locator bar (which leaks the runner).
  const team=hunter(p)&&enabled('teammateHud')?teammateReadout(p,players(),s.roster,s.runner,dimName):'';
  const withTeam=msg=>msg+(team?'\n§a팀원 §f'+team:'');
  const bar=msg=>p.onScreenDisplay.setActionBar(withTeam(msg));
  const was=sneaking.get(p.id)||false;sneaking.set(p.id,p.isSneaking);
  if(tool&&p.isSneaking&&!was)system.run(()=>showMenu(p));
  if(s.phase==='lobby'||s.phase==='ended'){p.onScreenDisplay.setActionBar(`§bMANHUNT NIGHT §7| ${s.phase==='lobby'?'친구를 초대하고 메뉴에서 시작':s.result} §7| /mh:menu · /mh:item`);return;}
  if(s.phase==='paused'){p.onScreenDisplay.setActionBar('§e일시정지 §7| 전원 재접속 후 관리자가 재개');return;}
  if(!member(p)){p.onScreenDisplay.setActionBar(`§7관전 중 · ${clock(s.seconds)}`);return;}
  if(s.phase==='countdown'){p.onScreenDisplay.setActionBar(`§e${s.remaining}초 후 시작 §7| ${p.name===s.runner?'러너':'헌터'}`);return;}
  if(s.phase==='grace'&&hunter(p)){bar(`§c헌터 대기 §f${s.remaining}초 §7| 러너 도주 중${enabled('tracker')?' · 추적 해금 '+trackerWait()+' 후':' · 추적 기능 OFF'}`);return;}
  if(hunter(p)&&enabled('tracker')&&trackerMode(s.config)==='random'&&!trackerReady()){bar(s.config.trackerProgress?craftHUD():'§c헌터 §7| 제작법: /mh:trackerrecipe');return;}
  if(hunter(p)&&trackerMode(s.config)==='disabled'){bar('§c헌터 §7| 무작위 추적 기능 OFF');return;}
  if(hunter(p)&&enabled('tracker')&&!trackerReady()){bar(`§c헌터 §7| 추적 해금까지 §e${trackerWait()} §7· ${enabled('craftCompass')?'나침반 직접 제작':'자동 추적 예정'}`);return;}
  const r=find(s.runner);
  if(hunter(p)&&trackerReady()&&(trackerMode(s.config)==='hud'||isTracker(held))){
    const target=targetFor(p.dimension.id,r?{dimension:r.dimension.id,location:r.location}:null,enabled('lastKnown')?s.routes:{});
    if(target){
      if(trackerMode(s.config)!=='hud')drawTracker(p,target,target.live?'§c러너':'§e마지막 위치 · 러너 '+(r?dimName(r.dimension.id):'접속 대기'),false,team);
      else {const t=tracking(p.location,p.getRotation().y,target);bar(`${target.live?'§c러너':'§e마지막 위치 · 러너 '+(r?dimName(r.dimension.id):'접속 대기')} §f${t.arrow} ${t.distance}m §7| 높이 ${t.dy>=0?'+':''}${t.dy} §8| ${clock(s.seconds)}`);}
    }else bar(`§e이 차원에 추적 정보 없음${enabled('dimensionNotice')?' §7| 러너: '+(r?dimName(r.dimension.id):'접속 대기'):''}`);
  }else bar(`${p.name===s.runner?'§b러너':'§c헌터'} §f${clock(s.seconds)} §7| ${s.phase==='grace'?`도주 유예 ${s.remaining}초`:hunter(p)?(enabled('tracker')?'러너 추적기를 들면 추적':'추적 기능 OFF'):`목표: 엔더드래곤 · 야생 부활 ${wildRespawnsRemaining(s)}회`}`);
}

system.beforeEvents.startup.subscribe(e=>{
  e.itemComponentRegistry.registerCustomComponent('mh:receiver_use',{onUse:e=>expansion.useReceiver(e.source),onUseOn:e=>expansion.useReceiver(e.source)});
  e.itemComponentRegistry.registerCustomComponent('mh:revive_use',{onUse:e=>runnerSpecial.useRevive(e.source),onUseOn:e=>runnerSpecial.useRevive(e.source)});
  const useSummon=p=>{if(String(s.config.summonAcquire)==='disabled'){tell(p,'소집서 획득·사용이 비활성화되어 있습니다. 아이템을 보존합니다.');return;}summon.use(p);};
  e.itemComponentRegistry.registerCustomComponent('mh:summon_use',{onUse:e=>useSummon(e.source),onUseOn:e=>useSummon(e.source)});
  const reg=e.customCommandRegistry;
  /** @type {Array<[string,string,CommandPermissionLevel,(p:Player)=>unknown]>} */
  const commands = [
    ['mh:craft','헌터 투척 제작 모드 전환',CommandPermissionLevel.Any,p=>trackerCraft.toggle(p)],
    ['mh:trackerrecipe','헌터 추적기 제작법과 진행도',CommandPermissionLevel.Any,p=>recipeMenu(p)],
    ['mh:menu','맨헌트 메뉴',CommandPermissionLevel.Any,p=>showMenu(p)],
    ['mh:item','대기실/종료 후 메뉴 아이템 받기',CommandPermissionLevel.Any,p=>giveMenu(p)],
    ['mh:kitoff','경기 시작 1분 안에 모든 참가자의 시작 지급품 회수',CommandPermissionLevel.Any,p=>kitOff(p)],
    ['mh:kiton','회수된 모든 참가자의 시작 지급품 복구',CommandPermissionLevel.Any,p=>kitOn(p)],
    ['mh:admin','맨헌트 관리자 복구',CommandPermissionLevel.Host,p=>{s.host=p.name;save();tell(p,'관리자 권한을 복구했습니다.');}],
    ['mh:unstuck','로비 이동 또는 입력 잠금 복구',CommandPermissionLevel.Any,p=>{if(['lobby','ended'].includes(s.phase))lobbyPlayer(p,false);else {expansion.clearCamera(p);applyPhase(p);}}]
  ];
  for(const [name,desc,level,fn] of commands)reg.registerCommand({name,description:desc,permissionLevel:level,cheatsRequired:false},origin=>{
    const p=origin.sourceEntity;if(!(p instanceof Player))return {status:CustomCommandStatus.Failure,message:'플레이어만 사용할 수 있습니다.'};
    system.run(()=>attempt(name,()=>fn(p)));return {status:CustomCommandStatus.Success};
  });
});
world.afterEvents.worldLoad.subscribe(()=>{
  try{const raw=world.getDynamicProperty(KEY);if(typeof raw==='string'){const stored=JSON.parse(raw);if(stored.schema!==1)throw Error('지원하지 않는 저장 형식');s={...newState(),...stored,config:normalizeConfig(stored.config,true)};}
    if(running()){s.previous=s.phase;s.phase='paused';save();}
    world.gameRules.keepInventory=Boolean(s.config.keepInventory);loaded=true;console.warn(`[Manhunt ${VERSION}] LOADED phase=${s.phase}`);for(const p of players())initializePlayer(p);queueOutcome();
  }catch(e){report('load',e);world.sendMessage(PREFIX+'저장 상태를 읽지 못했습니다. 원본 월드에서 다시 시작해 주세요.');}
});
world.afterEvents.playerSpawn.subscribe(({player,initialSpawn})=>system.runTimeout(()=>{
  deadPlayers.delete(player.name);expansion.joined(player);trackerDisplay.scan(player);summon.joined(player);runnerSpecial.joined();
  if(!loaded)return;
  if(initialSpawn){initializePlayer(player);if(player.name===s.runner&&s.runnerRespawning)completeRunnerRespawn(player);return;}
  heal(player);stripMenus(player);
  if(running()||s.phase==='paused'){
    if(hunter(player)){removeEarlyTrackers(player);player.addEffect('resistance',60,{amplifier:4,showParticles:false});applyPhase(player);}
    else if(member(player)){applyPhase(player);completeRunnerRespawn(player);}
  }else lobbyPlayer(player,false);
},1));
world.afterEvents.playerLeave.subscribe(e=>{trackerCraft.clearSessions();runnerSpecial.reset();trackerDisplay.reset();sneaking.delete(e.playerId);openForms.delete(e.playerId);if(enabled('autoPause')&&s.roster.includes(e.playerName)&&running())pause(`${e.playerName}님 접속 종료`);});
world.afterEvents.playerDimensionChange.subscribe(e=>{trackerCraft.clearSessions();trackerDisplay.scan(e.player);
  attempt('dimension rewards',()=>expansion.dimensionChanged(e));
  if(running()&&e.player.name===s.runner){if(enabled('tracker')&&enabled('lastKnown'))s.routes[e.fromDimension.id]={x:e.fromLocation.x,y:e.fromLocation.y,z:e.fromLocation.z};save();if(enabled('dimensionNotice'))say(`러너가 §e${dimName(e.toDimension.id)}§r에 진입했습니다!`);}
});
world.beforeEvents.entityHurt.subscribe(e=>{
  if(!loaded)return;const p=e.hurtEntity;if(p.typeId!=='minecraft:player')return;
  system.run(()=>expansion.clearCamera(p));
  if(['lobby','countdown','paused','ended'].includes(s.phase)||s.phase==='grace'&&hunter(p)){e.cancel=true;return;}
  if(!s.config.friendlyFire&&hunter(p)&&damageByHunter(s,e.damageSource,knownPlayerNames))e.cancel=true;
});
world.beforeEvents.playerInteractWithBlock.subscribe(e=>{if(s.phase==='paused'||s.phase==='countdown'||s.phase==='grace'&&hunter(e.player))e.cancel=true;});
world.afterEvents.entityDie.subscribe(e=>{
  if(!loaded)return;const dead=e.deadEntity;
  const dragon=dead.typeId==='minecraft:ender_dragon'&&dead.dimension.id==='minecraft:the_end';
  if(dragon){s.dragonDefeated=true;save();}
  if(!running()&&s.phase!=='paused')return;
  if(dead instanceof Player){
    const name=dead.name;if(!s.roster.includes(name)||deadPlayers.has(name))return;trackerCraft.clearSessions();expansion.clearCamera(dead);deadPlayers.add(name);s.deaths[name]=(s.deaths[name]||0)+1;
    if(name===s.runner){
      if(hunterKilledRunner(s,e.damageSource,knownPlayerNames)||wildRespawnsRemaining(s)<=0){queueOutcome(true,false);}
      else {s.runnerRespawns++;s.runnerRespawning=true;say(`§e러너 야생 사망 · ${s.runnerRespawns}/${wildRespawnBudget(s)}회 부활 사용. 경기는 계속됩니다.`);}
    }save();
  }else if(dragon){queueOutcome(false,true);}
});
system.runInterval(()=>{
  if(!loaded||building)return;attempt('expansion tick',()=>expansion.tick());for(const p of players())attempt('hud',()=>updateHUD(p));
},5);
// Deadlines are relative to actual release/resume, never the global loop phase.
// Most ticks only perform the phase/deadline check; game work runs once per second.
system.runInterval(()=>{try{roundTimerTick();}catch(e){report('round timer',e);if(running())pause('경기 시간 처리 오류가 감지되었습니다.');}},1);
system.runInterval(()=>{if(loaded&&!building)attempt('runner proximity',()=>runnerRules.tick());},20);
system.runInterval(()=>{
  if(!loaded||!s.lobby||building)return;
  try{
    if(running()&&enabled('autoPause')){const missing=s.roster.filter(n=>!find(n));if(missing.length){pause('참가자 재접속 대기');return;}}
    for(const p of players()){
      if(deadPlayers.has(p.name))continue;
      if(['lobby','ended'].includes(s.phase))normalizeMenu(p);else stripMenus(p);
      if(['lobby','ended'].includes(s.phase)){if(s.worldMode!=='portable'&&p.location.y<298&&p.dimension.id==='minecraft:overworld'&&s.phase==='lobby')lobbyPlayer(p,false);}
      else if(member(p)){if(hunter(p)){removeEarlyTrackers(p);unlockExistingTrackers(p);}applyPhase(p);}
    }
    if(runnerSpecial.hasPending())runnerSpecial.recover();if(summon.hasPending())summon.recover();save();
  }catch(e){report('game loop',e);if(running())pause('진행 오류가 감지되었습니다. 관리자 메뉴에서 확인하세요.');}
},20);

async function fortressSetup(p){
 if(!isHost(p))return;
 if(s.worldMode!=='portable'){tell(p,'원본 월드는 기존 요새 지도를 사용합니다. 다른 시드에서 새로 생성한 월드에 애드온을 적용했을 때 사용하세요.');return;}
 const current=s.fortressWaypoint;
 const menu=new ActionFormData().title('다른 맵 · 네더 요새 좌표')
  .body(`현재 등록: ${current?`X ${current.x}, Z ${current.z}`:'없음'}\\n네더에서 /locate structure fortress 명령으로 실제 X/Z를 확인한 뒤 등록하세요. 미등록일 경우 잘못된 좌표를 안내하지 않습니다.`)
  .button('X/Z 좌표 직접 입력').button('현재 네더 위치로 등록').button('등록 좌표 삭제').button('취소');
 const r=await form(p,menu);if(!r||r.canceled||!isHost(p))return;
 if(r.selection===0){
  const ui=new ModalFormData().title('네더 요새 좌표 등록')
   .textField('네더 요새 X 좌표','정수',{defaultValue:String(current?.x??0)})
   .textField('네더 요새 Z 좌표','정수',{defaultValue:String(current?.z??0)});
  const input=await form(p,ui);
  if(!input||input.canceled||!isHost(p)||!Array.isArray(input.formValues))return;
  const point=parseFortressWaypoint(input.formValues[0],input.formValues[1]);
  if(!point){tell(p,'좌표는 네더 범위 내 정수여야 합니다. 이전 값을 유지합니다.');return;}
  s.fortressWaypoint=point;
 }else if(r.selection===1){
  if(p.dimension.id!=='minecraft:nether'){tell(p,'현재 위치 등록은 네더 안에서만 가능합니다.');return;}
  const point=parseFortressWaypoint(String(Math.floor(p.location.x)),String(Math.floor(p.location.z)));
  if(!point){tell(p,'현재 위치가 좌표 범위를 벗어났습니다.');return;}
  s.fortressWaypoint=point;
 }else if(r.selection===2){s.fortressWaypoint=null;}
 else return;
 if(s.extra)s.extra.missingWaypointNotified=false;
 save();
 tell(p,s.fortressWaypoint?`네더 요새 좌표 저장: X ${s.fortressWaypoint.x}, Z ${s.fortressWaypoint.z}. 실제 구조물 위치를 등록했는지 확인하세요.`:'등록된 요새 좌표를 제거했습니다. 잘못된 위치는 안내하지 않습니다.');
}

async function expansionHelp(p){await form(p,new ActionFormData().title('추가 규칙 · v1.7.0 (설정 변경 가능)').body('구역: 원본 맵은 오버월드·엔드 X/Z -5000~4999, 네더 -625~624. 다른 시드는 출발 위치를 중심으로 오버월드/네더 경계를 이동하며 엔드는 원점을 유지합니다. 경계를 넘으면 안쪽 이전 위치로 돌아갑니다.\n\n러너 출발 후 40분간 요새 미도착 또는 헌터의 네더 선진입 시 러너에게 요새를 안내합니다. 다른 시드의 월드는 관리 메뉴에서 호스트가 실제 요새 X/Z를 등록해야 좌표를 표시합니다. 일시정지 시간 제외.\n\n수신기 작업대 조합 (왼쪽 위부터):\n석탄 / 구리 주괴 / 철 주괴\n금 주괴 / 바다의 심장 / 청금석\n에메랄드 / 다이아몬드 / 네더라이트 파편\n\n러너만 수신기를 우클릭 사용: 녹색 광선 8초, 같은 차원 헌터의 카메라를 러너 방향으로 3초 전환. 재사용 30초. 멀리 있거나 벽 뒤에서는 러너·광선이 안 보일 수 있습니다. 다른 차원 헌터에게는 차원 알림만 보냅니다.\n\n러너 엔드 첫 입장: 엔더의 눈 32개, 경기당 1회.').button('확인'));}

function completeRunnerRespawn(p){if(p.name!==s.runner||!s.runnerRespawning||(!running()&&s.phase!=='paused'))return;
  s.runnerRespawning=false;heal(p);applyPhase(p);tell(p,`체력을 모두 회복했습니다. 야생 부활 ${wildRespawnsRemaining(s)}회 남음.`);
  if(s.pendingRunnerVictory)finish('runner');else save();
}
async function runnerHelp(p){await form(p,new ActionFormData().title('러너 규칙 · v1.7.0 (설정 변경 가능)').body('기본 최대 체력: 하트 20개(두 줄), 포만감 I.\n\n도주 유예 중에는 포만감 V·재생 I·느린 낙하 I. 유예 종료 시 임시 효과가 사라지고 포만감 I만 유지됩니다.\n\n새 월드 기본: 야생 사망 2회 부활, 참가 헌터에게 처치되면 즉시 패배. 러너 부활 토템(주변 네더라이트 주괴 8개 + 중앙 불사의 토템) 사용 시 1회 추가, 경기 누적 최대 3회. 재접속 후에도 횟수 유지, 부활 체력 회복. 기존 월드는 부활 설정을 보존합니다.\n\n같은 차원의 가장 가까운 헌터를 3차원 거리 90·60·40·10블록의 네 단계로 감지합니다. 단계 진입 시 러너에게만 알리고, 구간별 쿨다운으로 반복 알림을 제한합니다. 거리와 소리는 설정에서 조절합니다.\n\n경기 전 게임 설정에서 인벤세이브를 선택할 수 있습니다. 새 경기/로비 초기화의 소지품 초기화는 그대로 적용됩니다.').button('확인'));}

world.afterEvents.entitySpawn.subscribe(e=>trackerCraft.spawned(e.entity));
world.afterEvents.entityItemDrop.subscribe(e=>attempt('tracker crafting',()=>trackerCraft.drop(e)));
world.afterEvents.playerInventoryItemChange.subscribe(e=>trackerDisplay.changed(e));
// Update the owner's whole carried compass set at 10 Hz; one direction calculation per hunter.
system.runInterval(()=>{if(!loaded||!running()||!trackerReady()||trackerMode(s.config)==='hud')return;const all=players(),r=all.find(p=>p.name===s.runner);if(!r||deadPlayers.has(r.name))return;for(const p of all){if(!hunter(p)||deadPlayers.has(p.name))continue;const target=targetFor(p.dimension.id,{dimension:r.dimension.id,location:r.location},enabled('lastKnown')?s.routes:{});if(target)attempt('compass rotation',()=>trackerDisplay.update(p,target));}},2);
async function recipeMenu(p){if(!hunter(p)){tell(p,'헌터만 제작법을 확인할 수 있습니다.');return;}await form(p,new ActionFormData().title('러너 추적기 제작법').body(trackerCraft.describe(p)).button('확인'));}

const EXTRA_SETTINGS={
 tracker:{title:'추적 방식 / 무작위 제작',fields:[
  ['choice','trackerMode','추적 방식 (한 가지만 적용)',['random','compass','hud'],['무작위 투척 제작','기존 나침반 직접 제작','기존 자동 HUD']],
  ['bool','randomCrafting','무작위 제작 사용 (OFF면 이 방식의 추적 전체 중지)'],
  ['number','trackerRevealMinutes','제작법 공개 (분)',0,60,1],['bool','trackerAutoGive','미완성 팀 자동 지급'],
  ['number','trackerAutoMinutes','자동 지급 (분, 공개 시간 이상)',0,120,1],
  ['number','trackerCommonMultiplier','일반 재료 수량 배수',1,4,1],['number','trackerRareCount','어려운 재료별 수량',1,16,1],
  ['bool','trackerProgress','제작 진행 HUD'],['bool','trackerNotices','헌터 제작 안내 채팅'],
  ['bool','trackerReacquire','팀 완료 후 일반 나침반으로 재획득 허용 (기본 OFF)']]},
 runner:{title:'러너 접근 경고 / 부활 상세',fields:[
  ['number','proximity0','1단계 거리 (블록)',1,200,1],['number','proximity1','2단계 거리 (블록)',1,200,1],
  ['number','proximity2','3단계 거리 (블록)',1,200,1],['number','proximity3','4단계 거리 (블록)',1,200,1],
  ['bool','proximitySound','단계별 경고 소리'],['number','proximityCooldownSeconds','구간별 알림 간격 (초)',1,60,1],
  ['number','wildRespawnBase','기본 야생 부활 기회',0,10,1],['feature','reviveItem','러너 부활 아이템 사용'],
  ['number','wildRespawnMax','아이템 포함 경기 누적 최대 기회',0,10,1]]},
 summon:{title:'헌터 소집서',fields:[
  ['feature','summon','헌터 소집 기능'],['number','summonDistance','러너 접근 제한 (블록, 이하 금지)',0,1000,10],
  ['number','summonCooldownSeconds','팀 공용 재사용 대기 (초)',0,900,30],['number','summonMaxUses','팀 공용 경기당 사용 횟수',1,10,1],
  ['choice','summonAcquire','획득 방식',['recipe','disabled'],['작업대 제작','획득 중지']],['bool','summonSound','소집 효과음']]}
};
async function settingsCategory(p,index){
 if(index!==1&&index!==2)return settingsSection(p,index);
 const choices=index===1?['기존 추적 옵션 / 팀원 HUD','추적 방식 / 투척 제작','헌터 소집서']:['기존 러너 버프 / 기능 ON·OFF','4단계 거리 / 부활 횟수·아이템'];
 const f=new ActionFormData().title(GROUPS[index].title).body('기존 설정과 신규 상세 설정을 선택하세요. 변경은 다음 경기부터 적용됩니다.');choices.forEach(t=>f.button(t));
 const r=await form(p,f);if(!r||r.canceled)return;if(r.selection===0)return settingsSection(p,index);
 return extraSettings(p,index===2?'runner':r.selection===1?'tracker':'summon');
}
async function extraSettings(p,key){
 if(!isHost(p)||!['lobby','ended'].includes(s.phase))return;
 const group=EXTRA_SETTINGS[key];if(!group)return;const ui=new ModalFormData().title(group.title);
 for(const [kind,name,label,a,b,step] of group.fields){
  const value=String(name).startsWith('proximity')&&/^proximity\d$/.test(name)?s.config.proximityDistances[Number(name.at(-1))]:s.config[name];
  if(kind==='number')ui.slider(label,Number(a),Number(b),{valueStep:Number(step),defaultValue:Number(value)});
  else if(kind==='choice')ui.dropdown(label,b,{defaultValueIndex:Math.max(0,a.indexOf(value))});
  else ui.toggle(label,{defaultValue:kind==='feature'?enabled(name):Boolean(value)});
 }
 const r=await form(p,ui);if(!r||r.canceled||!isHost(p)||!['lobby','ended'].includes(s.phase))return;
 if(!Array.isArray(r.formValues)||r.formValues.length!==group.fields.length){tell(p,'설정 응답이 올바르지 않아 변경하지 않았습니다.');return;}
 const next=normalizeConfig(s.config);
 try{group.fields.forEach(([kind,name,_label,a,b,step],i)=>{const value=r.formValues[i];
  if(kind==='choice'){if(!Number.isInteger(value)||!a[value])throw Error('선택 값 오류');next[name]=a[value];}
  else if(kind==='feature')next.features[name]=Boolean(value);
  else if(kind==='bool')next[name]=Boolean(value);
  else {if(typeof value!=='number'||!Number.isFinite(value)||value<Number(a)||value>Number(b)||(value-Number(a))%Number(step))throw Error('수치 범위 오류');
   if(/^proximity\d$/.test(name))next.proximityDistances[Number(name.at(-1))]=value;else next[name]=value;}
 });
 if(next.proximityDistances.some((n,i,arr)=>i>0&&n>=arr[i-1]))throw Error('거리 단계는 1→4 순서로 작아져야 합니다.');
 if(next.wildRespawnMax<next.wildRespawnBase)throw Error('최대 부활 기회는 기본 기회 이상이어야 합니다.');
 if(next.trackerAutoMinutes<next.trackerRevealMinutes)throw Error('자동 지급 시간은 제작법 공개 이후여야 합니다.');
 }catch(e){tell(p,String(e));return;}
 if(key==='tracker'&&next.trackerMode!=='random')next.features.craftCompass=next.trackerMode==='compass';
 s.config=next;save();tell(p,'상세 설정을 저장했습니다. 다음 경기부터 적용됩니다.');
}

function craftHUD(){
 const d=s.trackerCraft;if(!d)return '§c헌터 §7| 제작 준비 중';
 if(d.pending)return '§e제작 거래 확인 필요 · 관리자 메뉴';
 if(s.seconds<s.config.trackerRevealMinutes*60)return `§c헌터 §7| 제작법 공개까지 ${trackerWait()} · /mh:trackerrecipe`;
 const next=d.recipe[d.step];return `§c헌터 §7| 팀 제작 ${d.step}/9${next?` · ${next.name} ${d.amount}/${next.amount}`:''} §7| ${s.config.trackerAutoGive?`자동 지급 ${clock(Math.max(0,s.config.trackerAutoMinutes*60-s.seconds))}`:'자동 지급 OFF'} · /mh:trackerrecipe`;
}
async function recoverCraft(p){
 if(!isHost(p)||!s.trackerCraft?.pending)return;const pending=JSON.stringify(s.trackerCraft.pending),op=s.trackerCraft.pending;
 const label=op.kind==='consume'?`${op.player}: ${op.typeId} ${op.amount}개 재료 소비`:`${op.player}: 추적기 1개 지급`;
 const result=await form(p,new ActionFormData().title('중단된 제작 거래 확인').body(`${label} 결과를 실제 인벤토리와 바닥에서 확인하세요. 확실하지 않다면 보류하세요. 잘못 확인하면 손실 또는 중복 지급이 생길 수 있습니다.`).button('보류 · 변경하지 않음').button(op.kind==='consume'?'소비됨 확인 · 진행 반영':'지급됨 확인 · 재지급 금지').button(op.kind==='consume'?'소비 안 됨 확인 · 해당 단계 유지':'지급 안 됨 확인 · 다시 지급 대기'));
 if(!result||result.canceled||!isHost(p)||JSON.stringify(s.trackerCraft?.pending)!==pending||![1,2].includes(result.selection))return;
 trackerCraft.resolvePending(p,result.selection===1);
}

async function recoverSummon(p){
 if(!isHost(p))return;const snapshot=summon.pendingRecovery();if(!snapshot)return;
 const r=await form(p,new ActionFormData().title('중단된 소집 복구').body(`관련 참가자: ${snapshot.names.join(', ')}. 원래 위치의 청크가 읽히지 않으면 복귀가 지연될 수 있습니다.\n현재 위치 유지로 정리하려면 먼저 경기를 일시정지하고 전원이 안전한 곳에 서 있어야 합니다.\n${snapshot.refundUncertain?'아이템 환급 여부가 불명확합니다. 자동 보상하지 않습니다.':'아이템 추가 지급·소비 없이 실패 거래를 정리합니다.'}`).button('보류').button('원래 위치 복구 재시도').button('현재 안전 위치 유지 · 실패 거래 정리'));
 if(!r||r.canceled||!isHost(p))return;if(r.selection===1){tell(p,summon.recover(true)?'소집 복구 완료':'복구 대기: 참가자와 원래 위치를 확인해 주세요.');return;}
 if(r.selection===2){const c=await form(p,new MessageFormData().title('현재 위치 유지 확인').body('관련자들을 원래 위치로 다시 이동시키지 않습니다. 현재 안전 위치를 유지하며 불명확한 환급은 자동 보상하지 않습니다.').button1('보류').button2('확인 · 거래 정리'));
 if(c&&!c.canceled&&c.selection===1)summon.resolveAtCurrent(p,snapshot.token);}
}

async function recoverRevive(p){
 if(!isHost(p)||!s.revivePending)return;const tx={...s.revivePending};
 const r=await form(p,new ActionFormData().title('중단된 부활 거래').body(`${tx.runner}님의 토템 소비 여부를 실제 인벤토리에서 확인하세요. 일시정지 후 러너가 접속한 상태에서만 정리합니다. 확실하지 않으면 보류하세요. 아이템을 자동 생성·환불하지 않습니다.`).button('보류').button('토템 소비됨 확인 · 기회 1회 반영').button('소비 안 됨 확인 · 이전 기회 유지'));
 if(!r||r.canceled||![1,2].includes(r.selection))return;runnerSpecial.resolvePending(p,r.selection===1,tx.token);
}
