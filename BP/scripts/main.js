import {world, system, Player, ItemStack, ItemLockMode, GameMode, InputPermissionCategory,
  CommandPermissionLevel, CustomCommandStatus, EquipmentSlot} from '@minecraft/server';
import {createExpansion} from './expansion.js';
import {createRunnerRules,responsiblePlayer,MAX_WILD_RESPAWNS} from './runner.js';
import {ActionFormData, ModalFormData, MessageFormData} from '@minecraft/server-ui';
import {VERSION, ACTIVE, DIM_NAMES, TRACKER_UNLOCK_SECONDS, trackerUnlocked, normalizeConfig, featureOn, unlockAfter, newState, validateStart, tracking, targetFor, outcome, clock, teammateReadout} from './core.js';

const KEY='mh:state', PREFIX='§b[맨헌트]§r ', MENU='mh:menu', KIT_WINDOW_SECONDS=60;
let s=newState(), loaded=false, building=false, resolving=false, pendingDeath=false, pendingDragon=false;
const openForms=new Set(), sneaking=new Map(), pendingKits=new Set(), lastErrors=new Map();
const deadPlayers=new Set();
const enabled=key=>featureOn(s.config,key);
const runnerRules=createRunnerRules(world,system,()=>s,{tell,report,isDead:p=>deadPlayers.has(p.name)});
const expansion=createExpansion(world,system,()=>s,{tell,inventory,ItemStack,report,isDead:p=>deadPlayers.has(p.name)});
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
function save(){world.setDynamicProperty(KEY,JSON.stringify(s));}
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
function trackerReady(){return enabled('tracker')&&s.seconds>=unlockAfter(s.config);}
function trackerWait(){return clock(Math.max(0,unlockAfter(s.config)-s.seconds));}
function removeEarlyTrackers(p){if(!hunter(p)||trackerReady()||['lobby','ended'].includes(s.phase))return;const inv=inventory(p);if(!inv)return;for(let i=0;i<inv.size;i++)if(isTracker(inv.getItem(i)))inv.setItem(i);}
function makeTool(type){const item=new ItemStack(type,1);
  // Both menu and crafted tracker are ordinary items: no inventory lock or free death retention.
  item.setLore(type===MENU?['§7들고 웅크리기: 메뉴 열기','§7버려도 됩니다 · /mh:item 재지급','§7아이템 없이 /mh:menu']:['§7철 4개 + 레드스톤 1개로 일반 나침반 제작','§7해금 후 나침반을 손에 들면 추적기로 전환','§7버리거나 잃으면 직접 다시 제작']);return item;}
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
  if(!hunter(p)||!enabled('craftCompass')||!trackerReady()||!['grace','running'].includes(s.phase))return false;
  const inv=inventory(p);if(!inv)return false;
  const i=p.selectedSlotIndex,item=inv.getItem(i);
  if(item?.typeId!=='minecraft:compass')return false;
  const remaining=Math.max(0,item.amount-1);
  inv.setItem(i,makeTool('mh:tracker_0'));
  if(remaining){
    const rest=inv.addItem(new ItemStack('minecraft:compass',remaining));
    if(rest) p.dimension.spawnItem(rest,p.location); // Do not destroy extra compasses in a full inventory.
  }
  tell(p,'일반 나침반 1개를 추적기로 전환했습니다. 다시 필요하면 나침반을 제작하세요.');
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
function lobbyPlayer(p,clear=false){if(!s.lobby)return;runnerRules.clear(p);if(clear)clearPlayer(p);movement(p,true);p.setGameMode(GameMode.Adventure);teleport(p,s.lobby);p.setSpawnPoint({...s.lobby,dimension:world.getDimension('overworld')});stripTools(p);ensureMenu(p);}
function titleAll(title,subtitle){for(const p of players())attempt('title',()=>p.onScreenDisplay.setTitle(title,{subtitle,stayDuration:60,fadeInDuration:5,fadeOutDuration:15}));}
function sound(id){for(const p of players())attempt('sound',()=>p.playSound(id));}

function* buildLobby(p){
  building=true;
  const d=world.getDimension('overworld'), base=location(p);
  let top=d.getTopmostBlock({x:Math.floor(base.x),z:Math.floor(base.z)});
  if(!top)throw Error('시작 지형이 아직 로드되지 않았습니다.');
  s.start={x:Math.floor(base.x)+0.5,y:top.location.y+1,z:Math.floor(base.z)+0.5};
  // A separate platform above the new world's spawn; keep all source terrain intact.
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
  if(!loaded||building)return;
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
  if(s.dragonDefeated){tell(p,'드래곤이 처치된 월드입니다. 새 판은 원본 .mcworld를 다시 가져와 시작하세요.');return;}
  const names=players().map(q=>q.name);const runner=practice?p.name:(s.choice||names[Math.floor(Math.random()*names.length)]);
  if(names.some(name=>deadPlayers.has(name))){tell(p,'모든 참가자가 부활한 뒤 시작해 주세요.');return;}
  const error=validateStart(names,runner,practice);if(error){tell(p,error);return;}
  expansion.reset();s.runner=runner;s.roster=names;s.round++;s.practice=practice;s.seconds=0;s.remaining=5;s.phase='countdown';s.routes={};s.deaths={};s.result='';s.runnerRespawns=0;s.runnerRespawning=false;s.pendingRunnerVictory=false;s.kit={round:s.round,enabled:true,stored:{}};
  activeRules();world.setTimeOfDay(1000);world.getDimension('overworld').runCommand('weather clear');
  for(const q of players()){clearPlayer(q);teleport(q,s.lobby);q.setSpawnPoint({...s.start,dimension:world.getDimension('overworld')});
    if(s.config.food)inventory(q)?.addItem(starterStack(s.config.food));
    // No menu, legacy tracker, or other out-of-game tools may enter the round.
    stripMenus(q);applyPhase(q);}
  save();say(`${practice?'§e연습 경기':'§a정식 경기'} §r| 러너 §b${runner}§r | 헌터 ${names.length-1}명`);
  if(!practice&&enabled('tracker'))say(`§e추적기: ${enabled('craftCompass')?'나침반 직접 제작':'나침반 없이 HUD 추적'} · ${unlockAfter(s.config)/60}분 후 해금!`);
  say(enabled('kitControls')?'§7경기 시작 시 메뉴 아이템 제거 · 시작 지급품은 첫 1분 안에 /mh:kitoff, /mh:kiton 제어':'§7경기 시작 시 메뉴 아이템 제거 · 시작 지급품 제어 OFF');
  titleAll('§e5','잠시 후 러너 출발');sound('note.pling');
}
function releaseRunner(){s.phase=s.config.grace?'grace':'running';s.remaining=s.config.grace;const r=find(s.runner);if(r&&!deadPlayers.has(r.name)){teleport(r,s.start);heal(r);}
  if(!s.config.grace){releaseHunters();return;}
  for(const p of players())applyPhase(p);save();titleAll('§b러너 출발!',`헌터 출발까지 ${s.remaining}초`);sound('random.levelup');}
function releaseHunters(){s.phase='running';s.remaining=0;for(const p of players()){if(hunter(p)){teleport(p,s.start);heal(p);}applyPhase(p);}save();titleAll('§c추격 시작','러너는 엔더드래곤을, 헌터는 러너를!');sound('raid.horn');}
function pause(reason){if(!running())return;expansion.clearAll();s.previous=s.phase;s.phase='paused';for(const p of players())applyPhase(p);save();say('§e일시정지: '+reason);}
function resume(p){if(!isHost(p)||s.phase!=='paused')return;const missing=s.roster.filter(n=>!find(n));if(missing.length){tell(p,'재접속 대기: '+missing.join(', '));return;}s.phase=s.previous;for(const q of players())applyPhase(q);save();say('경기를 재개했습니다.');}
function finish(winner){if(!running()&&s.phase!=='paused')return;expansion.clearAll();runnerRules.clearAll();s.pendingRunnerVictory=false;s.runnerRespawning=false;s.phase='ended';s.result=winner==='runner'?'러너 승리':'헌터 승리';
  if(winner==='runner')s.dragonDefeated=true;
  if(!s.practice){for(const name of s.roster){if((winner==='runner')===(name===s.runner))s.wins[name]=(s.wins[name]||0)+1;}}
  save();for(const p of players()){if(deadPlayers.has(p.name))continue;movement(p,true);p.setGameMode(GameMode.Adventure);heal(p);ensureMenu(p);}
  titleAll(winner==='runner'?'§b러너 승리!':'§c헌터 승리!',`기록 ${clock(s.seconds)}${s.practice?' · 연습':''}`);sound('random.levelup');
  say(`${s.result}! 경기 시간 ${clock(s.seconds)}. 메뉴에서 로비로 돌아갈 수 있습니다.`);
}
function queueOutcome(){if(resolving)return;resolving=true;system.run(()=>{resolving=false;
  if(pendingDragon&&s.runnerRespawning&&!pendingDeath)s.pendingRunnerVictory=true;
  const winner=outcome(pendingDeath,pendingDragon,!pendingDeath&&!s.runnerRespawning&&!deadPlayers.has(s.runner));
  pendingDeath=false;pendingDragon=false;if(winner)finish(winner);else save();});}
function reset(p){if(!isHost(p))return;expansion.reset();runnerRules.clearAll();s.runnerRespawns=0;s.runnerRespawning=false;s.pendingRunnerVictory=false;s.phase='lobby';s.roster=[];s.seconds=0;s.remaining=0;s.routes={};s.practice=false;s.kit=null;pendingKits.clear();
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
      add('§a▶  경기 시작 · 3~4명',()=>confirm(p,'경기 시작','접속한 전원이 참가합니다. 소지품·장비·경험치를 초기화하고 시작합니다.',()=>startRound(p)));
      add('러너 선택 / 무작위',()=>selectRunner(p));add('§b게임 설정 · 기능별 ON/OFF',()=>settings(p));
      if(players().length===1)add('혼자 연습 · 러너',()=>confirm(p,'혼자 연습','시작·도주·사망·승패 흐름을 연습합니다. 소지품이 초기화되며 전적에는 반영되지 않습니다.',()=>startRound(p,true)));
    }
    if(running())add('일시정지',()=>pause('관리자 요청'));
    if(s.phase==='paused')add('§a경기 재개',()=>resume(p));
    if(s.phase!=='lobby')add('로비로 / 경기 초기화',()=>confirm(p,'경기 초기화','모두 로비로 이동하고 소지품·장비·경험치가 초기화됩니다. 지형·상자·드래곤은 복원되지 않습니다.',()=>reset(p)));
  }
  if(s.phase==='ended')add('로비로 이동',()=>lobbyPlayer(p,false));
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
    ['feature','tracker','러너 추적 기능'],['feature','trackerDelay','추적기 해금 시간 적용'],
    ['slider','trackerDelayMinutes','추적 해금까지 (분)',0,30,5],
    ['feature','craftCompass','나침반 직접 제작 필수 (OFF=자동 HUD)'],
    ['feature','lastKnown','차원 이동 전 마지막 위치 추적'],
    ['feature','dimensionNotice','러너 차원 이동 알림'],
    ['feature','teammateHud','헌터 팀원 방향·거리 표시']]},
  {title:'③ 러너 능력 / 부활',fields:[
    ['feature','runnerHealth','추가 체력 20HP'],['feature','runnerSaturation','러너 포만감 효과'],
    ['feature','graceBuffs','도주 유예 중 회복·낙하 완화'],
    ['feature','wildRespawns','러너 야생 사망 3회 부활'],
    ['feature','proximityWarning','러너에게 5칸 근접 경보']]},
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
  const r=await form(p,f);if(r&&!r.canceled&&GROUPS[r.selection])await settingsSection(p,r.selection);
}
async function settingsSection(p,index){
  if(!isHost(p)||!['lobby','ended'].includes(s.phase))return;
  const group=GROUPS[index],ui=new ModalFormData().title(group.title);
  for(const [kind,key,label,min,max,step] of group.fields){
    if(kind==='slider')ui.slider(label,Number(min),Number(max),{valueStep:Number(step),defaultValue:Number(s.config[key])});
    else ui.toggle(label,{defaultValue:kind==='feature'?enabled(key):Boolean(s.config[key])});
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
  s.config=next;world.gameRules.keepInventory=next.keepInventory;save();
  if(group.fields.some(field=>field[1]==='lobbyMenuItem'))for(const q of players())enabled('lobbyMenuItem')?ensureMenu(q):stripMenus(q);
  tell(p,`${group.title} 설정 저장 완료. 다음 경기부터 적용됩니다.`);
}
async function help(p){await form(p,new ActionFormData().title('맨헌트 규칙 · v1.4').body(
  '§b승패§r: 러너가 살아 있는 동안 엔더 드래곤이 죽으면 러너 승리, 러너의 최종 사망은 헌터 승리입니다. 이 핵심 규칙은 끌 수 없습니다.\n\n§e옵션 기능§r: 로비에서 관리자 → 게임 설정 → ①기본 경기, ②추적/헌터, ③러너, ④월드, ⑤수신기 항목별로 ON/OFF. 다음 경기부터 적용됩니다.\n\n§e추적§r: 기본은 나침반을 직접 제작하고 15분 후 손에 들면 추적합니다. 설정에서 추적 자체, 시간제한, 나침반 필수 여부, 차원 이탈 흔적과 팀원 HUD를 끌 수 있습니다.\n\n§a러너§r: 추가 체력, 포만감, 도주 유예 버프, 야생 사망 3회 부활, 근접 경보를 각각 끌 수 있습니다. 부활을 끄면 첫 사망에 패배합니다.\n\n§d추가 기능§r: 경계 제한, 요새 힌트, 엔드 보상, 수신기(카메라/광선 분리), 자동 일시정지, 시작 지급품 제어를 설정할 수 있습니다.\n\n경기 중 메뉴 아이템은 제거되고 /mh:menu 명령어로 관리 메뉴를 열 수 있습니다. 지급품 제어가 켜져 있다면 /mh:kitoff · /mh:kiton을 이용하세요.\n\n새로운 지형·드래곤으로 다시 시작하려면 원본 .mcworld를 새로 가져오세요.').button('확인'));}
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
  const type=`mh:tracker_${t.frame}`;if(item.typeId!==type)inv.setItem(p.selectedSlotIndex,makeTool(type));
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
  if(hunter(p)&&enabled('tracker')&&!trackerReady()){bar(`§c헌터 §7| 추적 해금까지 §e${trackerWait()} §7· ${enabled('craftCompass')?'나침반 직접 제작':'자동 추적 예정'}`);return;}
  const r=find(s.runner);
  if(hunter(p)&&trackerReady()&&(!enabled('craftCompass')||isTracker(held))){
    const target=targetFor(p.dimension.id,r?{dimension:r.dimension.id,location:r.location}:null,enabled('lastKnown')?s.routes:{});
    if(target){
      if(enabled('craftCompass'))drawTracker(p,target,target.live?'§c러너':'§e마지막 이동 지점',false,team);
      else {const t=tracking(p.location,p.getRotation().y,target);bar(`${target.live?'§c러너':'§e마지막 이동 지점'} §f${t.arrow} ${t.distance}m §7| 높이 ${t.dy>=0?'+':''}${t.dy} §8| ${clock(s.seconds)}`);}
    }else bar(`§e이 차원에 추적 정보 없음${enabled('dimensionNotice')?' §7| 러너: '+(r?dimName(r.dimension.id):'접속 대기'):''}`);
  }else bar(`${p.name===s.runner?'§b러너':'§c헌터'} §f${clock(s.seconds)} §7| ${s.phase==='grace'?`도주 유예 ${s.remaining}초`:hunter(p)?(enabled('tracker')?'제작한 나침반을 들면 추적':'추적 기능 OFF'):`목표: 엔더드래곤 · 야생 부활 ${(enabled('wildRespawns')?MAX_WILD_RESPAWNS-s.runnerRespawns:0)}회`}`);
}

system.beforeEvents.startup.subscribe(e=>{
  e.itemComponentRegistry.registerCustomComponent('mh:receiver_use',{onUse:e=>expansion.useReceiver(e.source),onUseOn:e=>expansion.useReceiver(e.source)});
  const reg=e.customCommandRegistry;
  /** @type {Array<[string,string,CommandPermissionLevel,(p:Player)=>unknown]>} */
  const commands = [
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
  try{const raw=world.getDynamicProperty(KEY);if(typeof raw==='string'){const stored=JSON.parse(raw);if(stored.schema!==1)throw Error('지원하지 않는 저장 형식');s={...newState(),...stored,config:normalizeConfig(stored.config)};}
    if(running()){s.previous=s.phase;s.phase='paused';save();}
    world.gameRules.keepInventory=Boolean(s.config.keepInventory);loaded=true;console.warn(`[Manhunt ${VERSION}] LOADED phase=${s.phase}`);for(const p of players())initializePlayer(p);
  }catch(e){report('load',e);world.sendMessage(PREFIX+'저장 상태를 읽지 못했습니다. 원본 월드에서 다시 시작해 주세요.');}
});
world.afterEvents.playerSpawn.subscribe(({player,initialSpawn})=>system.runTimeout(()=>{
  deadPlayers.delete(player.name);expansion.joined(player);
  if(!loaded)return;
  if(initialSpawn){initializePlayer(player);if(player.name===s.runner&&s.runnerRespawning)completeRunnerRespawn(player);return;}
  heal(player);stripMenus(player);
  if(running()||s.phase==='paused'){
    if(hunter(player)){removeEarlyTrackers(player);player.addEffect('resistance',60,{amplifier:4,showParticles:false});applyPhase(player);}
    else if(member(player)){applyPhase(player);completeRunnerRespawn(player);}
  }else lobbyPlayer(player,false);
},1));
world.afterEvents.playerLeave.subscribe(e=>{sneaking.delete(e.playerId);openForms.delete(e.playerId);if(enabled('autoPause')&&s.roster.includes(e.playerName)&&running())pause(`${e.playerName}님 접속 종료`);});
world.afterEvents.playerDimensionChange.subscribe(e=>{
  attempt('dimension rewards',()=>expansion.dimensionChanged(e));
  if(running()&&e.player.name===s.runner){if(enabled('tracker')&&enabled('lastKnown'))s.routes[e.fromDimension.id]={x:e.fromLocation.x,y:e.fromLocation.y,z:e.fromLocation.z};save();if(enabled('dimensionNotice'))say(`러너가 §e${dimName(e.toDimension.id)}§r에 진입했습니다!`);}
});
world.beforeEvents.entityHurt.subscribe(e=>{
  if(!loaded)return;const p=e.hurtEntity;if(p.typeId!=='minecraft:player')return;
  system.run(()=>expansion.clearCamera(p));
  if(['lobby','countdown','paused','ended'].includes(s.phase)||s.phase==='grace'&&hunter(p)){e.cancel=true;return;}
  const attacker=e.damageSource.damagingEntity??e.damageSource.damagingProjectile?.getComponent('minecraft:projectile')?.owner;
  if(!s.config.friendlyFire&&hunter(p)&&attacker?.typeId==='minecraft:player'&&hunter(attacker))e.cancel=true;
});
world.beforeEvents.playerInteractWithBlock.subscribe(e=>{if(s.phase==='paused'||s.phase==='countdown'||s.phase==='grace'&&hunter(e.player))e.cancel=true;});
world.afterEvents.entityDie.subscribe(e=>{
  if(!loaded)return;const dead=e.deadEntity;
  const dragon=dead.typeId==='minecraft:ender_dragon'&&dead.dimension.id==='minecraft:the_end';
  if(dragon){s.dragonDefeated=true;save();}
  if(!running()&&s.phase!=='paused')return;
  if(dead instanceof Player){
    const name=dead.name;if(!s.roster.includes(name)||deadPlayers.has(name))return;expansion.clearCamera(dead);deadPlayers.add(name);s.deaths[name]=(s.deaths[name]||0)+1;
    if(name===s.runner){
      if(responsiblePlayer(e.damageSource)||(!enabled('wildRespawns')||s.runnerRespawns>=MAX_WILD_RESPAWNS)){pendingDeath=true;queueOutcome();}
      else {s.runnerRespawns++;s.runnerRespawning=true;say(`§e러너 야생 사망 · ${s.runnerRespawns}/${MAX_WILD_RESPAWNS}회 부활 사용. 경기는 계속됩니다.`);}
    }save();
  }else if(dragon){pendingDragon=true;queueOutcome();}
});
system.runInterval(()=>{
  if(!loaded||building)return;attempt('expansion tick',()=>expansion.tick());if(system.currentTick%20===0)attempt('runner proximity',()=>runnerRules.tick());for(const p of players())attempt('hud',()=>updateHUD(p));
},5);
system.runInterval(()=>{
  if(!loaded||!s.lobby||building)return;
  try{
    if(running()){
      if(enabled('autoPause')){const missing=s.roster.filter(n=>!find(n));if(missing.length){pause('참가자 재접속 대기');return;}}
      if(s.phase==='countdown'){s.remaining--;if(s.remaining<=0)releaseRunner();else {titleAll(`§e${s.remaining}`,'잠시 후 러너 출발');sound('note.pling');}}
      else {s.seconds++;if(s.phase==='grace'){s.remaining--;if(s.remaining<=0)releaseHunters();else if(s.remaining<=5)sound('note.pling');}
        if(enabled('tracker')&&unlockAfter(s.config)>0&&s.seconds===unlockAfter(s.config)){say(enabled('craftCompass')?'§a추적 해금! 직접 제작한 나침반을 들면 추적기로 전환됩니다.':'§a추적 해금! 헌터에게 자동 HUD 추적이 시작됩니다.');sound('random.levelup');}}
    }
    for(const p of players()){
      if(deadPlayers.has(p.name))continue;
      if(['lobby','ended'].includes(s.phase))normalizeMenu(p);else stripMenus(p);
      if(['lobby','ended'].includes(s.phase)){if(p.location.y<298&&p.dimension.id==='minecraft:overworld'&&s.phase==='lobby')lobbyPlayer(p,false);}
      else if(member(p)){if(hunter(p)){removeEarlyTrackers(p);unlockExistingTrackers(p);}applyPhase(p);}
    }
    expansion.second();save();
  }catch(e){report('game loop',e);if(running())pause('진행 오류가 감지되었습니다. 관리자 메뉴에서 확인하세요.');}
},20);

async function expansionHelp(p){await form(p,new ActionFormData().title('추가 규칙 · v1.4 (설정 변경 가능)').body('구역: 오버월드·엔드 X/Z -5000~4999, 네더 -625~624. 경계를 넘으면 안쪽 이전 위치로 돌아갑니다.\n\n러너 출발 후 40분간 요새 미도착 또는 헌터가 먼저 네더 진입 시 러너에게만 요새 좌표 1회 안내. 일시정지 시간 제외.\n\n수신기 작업대 조합 (왼쪽 위부터):\n석탄 / 구리 주괴 / 철 주괴\n금 주괴 / 바다의 심장 / 청금석\n에메랄드 / 다이아몬드 / 네더라이트 파편\n\n러너만 수신기를 우클릭 사용: 녹색 광선 8초, 같은 차원 헌터의 카메라를 러너 방향으로 3초 전환. 재사용 30초. 멀리 있거나 벽 뒤에서는 러너·광선이 안 보일 수 있습니다. 다른 차원 헌터에게는 차원 알림만 보냅니다.\n\n러너 엔드 첫 입장: 엔더의 눈 32개, 경기당 1회.').button('확인'));}

function completeRunnerRespawn(p){if(p.name!==s.runner||!s.runnerRespawning||(!running()&&s.phase!=='paused'))return;
  s.runnerRespawning=false;heal(p);applyPhase(p);tell(p,`체력을 모두 회복했습니다. 야생 부활 ${(enabled('wildRespawns')?MAX_WILD_RESPAWNS-s.runnerRespawns:0)}회 남음.`);
  if(s.pendingRunnerVictory)finish('runner');else save();
}
async function runnerHelp(p){await form(p,new ActionFormData().title('러너 규칙 · v1.4 (설정 변경 가능)').body('기본 최대 체력: 하트 20개(두 줄), 포만감 I.\n\n도주 유예 중에는 포만감 V·재생 I·느린 낙하 I. 유예 종료 시 임시 효과가 사라지고 포만감 I만 유지됩니다.\n\n낙하·몬스터·아사 등 야생 사망: 최대 3회 부활해 경기 계속. 부활 시 체력 두 줄을 모두 채웁니다. 4번째 야생 사망 또는 플레이어에게 처치되면 즉시 헌터 승리. 부활 횟수는 재접속해도 유지됩니다.\n\n같은 차원의 헌터가 3차원 거리 5칸 안이면 러너에게 채팅·소리 알림(최대 5초에 한 번).\n\n경기 전 게임 설정에서 인벤세이브를 선택할 수 있습니다. 새 경기/로비 초기화의 소지품 초기화는 그대로 적용됩니다.').button('확인'));}
