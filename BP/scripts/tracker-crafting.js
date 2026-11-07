// A team recipe is committed once per round. Only attributed, fresh player drops
// are accepted; never guess the owner of nearby item entities.
export const MATERIALS=Object.freeze([
 ['cobblestone','조약돌',8,'돌 채굴'],['dirt','흙',8,'지표 채굴'],['sand','모래',8,'강·해변 채굴'],
 ['gravel','자갈',8,'강·동굴 채굴'],['oak_log','참나무 원목',4,'참나무 벌목'],['stick','막대기',8,'판자 제작'],
 ['coal','석탄',4,'석탄 광석 채굴'],['charcoal','목탄',4,'원목 제련'],['copper_ingot','구리 주괴',4,'구리 광석 채굴·제련'],
 ['glass','유리',4,'모래 제련'],['brick','벽돌',4,'점토 제련'],['clay_ball','점토 덩이',8,'강·호수 점토 채굴'],
 ['flint','부싯돌',2,'자갈 채굴'],['bone','뼈',3,'스켈레톤 처치'],['string','실',3,'거미 처치'],
 ['rotten_flesh','썩은 살점',4,'좀비 처치'],['gunpowder','화약',2,'크리퍼 처치'],['feather','깃털',3,'닭 처치'],
 ['sugar','설탕',4,'사탕수수 제작'],['paper','종이',4,'사탕수수 제작'],['wheat','밀',4,'재배·건초 더미'],
 ['iron_ingot','철 주괴',6,'철 채굴·제련',true],['gold_ingot','금 주괴',6,'깊은 동굴 금 채굴·제련',true],
 ['redstone','레드스톤 가루',6,'깊은 동굴 레드스톤 채굴',true],['lapis_lazuli','청금석',6,'동굴 청금석 채굴',true],
 ['diamond','다이아몬드',6,'깊은 동굴 다이아몬드 채굴',true],['book','책',6,'소 가죽 6개와 사탕수수로 만든 종이 18개 제작',true]
].map(([id,name,amount,method,hard=false])=>Object.freeze({id:'minecraft:'+id,name,amount,method,hard})));

const number=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
export function recipeTimes(config){const reveal=number(config.trackerRevealMinutes,20,0,120)*60;
 return {reveal,auto:Math.max(reveal,number(config.trackerAutoMinutes,40,0,180)*60)};}
function shuffle(values,rng){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.min(i,Math.max(0,Math.floor(rng()*(i+1))));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function createRecipe(config={},rng=Math.random){const common=shuffle(MATERIALS.filter(m=>!m.hard),rng).slice(0,7),hard=shuffle(MATERIALS.filter(m=>m.hard),rng).slice(0,2);
 return shuffle([...common,...hard],rng).map(m=>({...m,amount:m.hard?number(config.trackerRareCount,6,1,64):Math.min(64,m.amount*number(config.trackerCommonMultiplier,1,1,8))}));}
export function newTrackerCraft(round,config,rng=Math.random){return {round,recipe:createRecipe(config,rng),step:0,amount:0,completion:null,delivered:{},announced:{},seen:[],pending:null};}

export function createTrackerCrafting(world,system,state,{tell,save,report,inventory,ItemStack,isDead,makeTracker}){
 const sessions=new Set(),born=new Map(),fullNotice=new Set();let busy=false;
 const enabled=()=>state().config.features?.tracker!==false&&state().config.trackerMode==='random'&&state().config.randomCrafting!==false;
 const live=()=>['grace','running'].includes(state().phase);
 const hunter=p=>!!p&&p.typeId==='minecraft:player'&&state().roster.includes(p.name)&&p.name!==state().runner;
 const alive=p=>{try{return !isDead(p)&&p.isValid!==false&&(p.getComponent('minecraft:health')?.currentValue??0)>0;}catch{return false;}};
 const data=()=>state().trackerCraft?.round===state().round?state().trackerCraft:null;
 const message=(p,msg)=>{try{tell(p,msg);}catch(e){report('tracker notice',e);}};
 const safeSave=()=>{try{save();return true;}catch(e){report('tracker save',e);return false;}};
 function startRound(){clearSessions();state().trackerCraft=enabled()?newTrackerCraft(state().round,state().config):null;}
 function clearSessions(){sessions.clear();born.clear();fullNotice.clear();}
 function reset(){clearSessions();state().trackerCraft=null;}
 function ready(){return enabled()&&!!data()?.completion&&!data()?.pending;}
 function canCraft(p){const d=data();return enabled()&&live()&&hunter(p)&&alive(p)&&d&&!d.completion&&!d.pending&&state().seconds>=recipeTimes(state().config).reveal;}
 function toggle(p){if(sessions.delete(p.name)){message(p,'제작 모드를 종료했습니다. 아이템을 버리면 일반 투척으로 처리됩니다.');return false;}
  if(!canCraft(p)){message(p,data()?.pending?'제작 거래 확인이 필요합니다. 관리자에게 문의하세요.':'지금은 추적기 제작 모드를 켤 수 없습니다.');return false;}
  sessions.add(p.name);message(p,'제작 모드 ON. 지정 재료만 다음 순서대로 버리세요. 초과 수량은 소비하지 않습니다. /mh:craft 로 종료합니다.');message(p,describe(p));return true;}
 function describe(p){if(!hunter(p))return '헌터 전용 제작 정보입니다.';
  if(!enabled())return '무작위 추적기 제작 방식이 비활성화되어 있습니다.';
  const d=data(),s=state(),times=recipeTimes(s.config);if(!d)return '경기를 시작하면 제작법이 결정됩니다.';
  if(s.seconds<times.reveal)return `제작법 비공개 · 공개까지 ${Math.ceil((times.reveal-s.seconds)/60)}분`;
  if(d.pending)return '미완료 거래가 있어 제작·지급을 중단했습니다. 관리자 확인 필요.';
  const lines=d.recipe.map((m,i)=>`${i+1}. ${m.name} ${m.amount}개${i<d.step?' · 완료':i===d.step?` · ${d.amount}/${m.amount}`:''}`);
  return lines.join('\n')+`\n완료 ${d.step}/9 · 남은 단계 ${9-d.step}`+(d.completion?`\n팀 완료: ${d.completion==='crafted'?'직접 제작':'자동 지급'} · ${d.delivered[p.name]?'지급 완료':'지급 대기'}`:s.config.trackerAutoGive===false?'\n자동 지급 OFF':`\n자동 지급까지 ${Math.max(0,times.auto-s.seconds)}초`);}
 function spawned(entity){if(!enabled()||!live()||!sessions.size||entity?.typeId!=='minecraft:item')return;
  try{const item=entity.getComponent('minecraft:item')?.itemStack;if(item)born.set(entity.id,{tick:system.currentTick,typeId:item.typeId,amount:item.amount});}catch{}
 }
 function plain(item){try{return !item.nameTag&&!(item.getLore?.().length)&&!(item.getDynamicPropertyIds?.().length)&&!(item.getComponent('minecraft:enchantable')?.getEnchantments?.().length);}catch{return false;}}
 function applyConsumption(d,op){d.step=op.nextStep;d.amount=op.nextAmount;if(!d.seen.includes(op.id))d.seen.push(op.id);if(d.step===9)d.completion='crafted';}
 function drop(event){const p=event.entity,d=data();if(busy||!canCraft(p)||!sessions.has(p.name)||!d)return false;let accepted=false;
  // Synchronous handler: each callback observes the prior callback's committed step.
  // Native event collections can expose length/index/map without Symbol.iterator.
  const dropped=event.items;busy=true;try{for(let index=0;index<(dropped?.length??0);index++){const entity=dropped[index];if(d.completion||d.pending)break;
   if(!entity||entity.typeId!=='minecraft:item'||d.seen.includes(entity.id))continue;
   const birth=born.get(entity.id);born.delete(entity.id);
   if(!birth||system.currentTick-birth.tick>2||system.currentTick<birth.tick){message(p,'새 투척인지 확인할 수 없어 재료를 소비하지 않았습니다. 다시 주워서 버려 주세요.');continue;}
   let item;try{if(entity.isValid===false)continue;item=entity.getComponent('minecraft:item')?.itemStack;}catch{continue;}
   const expected=d.recipe[d.step],remaining=expected.amount-d.amount;
   if(!item||item.typeId!==birth.typeId||item.amount!==birth.amount||!plain(item)){message(p,'합쳐졌거나 특수 정보가 있는 아이템은 소비하지 않습니다.');continue;}
   if(item.typeId!==expected.id||!Number.isInteger(item.amount)||item.amount<1||item.amount>remaining){message(p,`다음 재료: ${expected.name} ${remaining}개. 다른 재료·초과 수량은 그대로 둡니다.`);continue;}
   const total=d.amount+item.amount,op={kind:'consume',id:entity.id,typeId:item.typeId,amount:item.amount,player:p.name,step:d.step,previousAmount:d.amount,nextStep:total===expected.amount?d.step+1:d.step,nextAmount:total===expected.amount?0:total};
   d.pending=op;if(!safeSave()){d.pending=null;message(p,'저장 실패로 투척 재료를 소비하지 않았습니다.');break;}
   try{entity.remove();}catch(e){report('tracker consume',e);message(p,'재료 소비 결과를 확인할 수 없어 제작을 중단했습니다. 관리자 확인이 필요합니다.');break;}
   applyConsumption(d,op);d.pending=null;if(!safeSave()){d.pending=op;message(p,'저장 결과를 확인할 수 없어 제작을 중단했습니다.');break;}
   accepted=true;if(state().config.trackerProgress!==false)message(p,`팀 제작 ${d.step}/9 단계 완료${d.step<9?` · 현재 ${d.amount}/${d.recipe[d.step].amount}`:''}`);
  }}finally{busy=false;}
  if(d.completion&&!d.pending){clearSessions();if(state().config.trackerNotices!==false)for(const h of world.getAllPlayers())if(hunter(h))message(h,'헌터 팀 추적기 제작 완료! 헌터별 1개씩 지급합니다.');for(const h of world.getAllPlayers())deliver(h);}
  return accepted;
 }
 function deliver(p){const d=data();if(busy||!enabled()||!live()||!hunter(p)||!alive(p)||!d?.completion||d.pending||d.delivered[p.name])return false;
  const inv=inventory(p);if(!inv)return false;let slot=-1;for(let i=0;i<inv.size;i++)if(!inv.getItem(i)){slot=i;break;}
  if(slot<0){if(!fullNotice.has(p.name)){fullNotice.add(p.name);message(p,'추적기 지급 대기: 인벤토리 한 칸을 비우면 1개를 받습니다.');}return false;}
  let item;try{item=makeTracker?makeTracker():new ItemStack('mh:tracker_0',1);}catch(e){report('tracker item',e);return false;}
  const op={kind:'grant',player:p.name,slot};d.pending=op;if(!safeSave()){d.pending=null;return false;}
  busy=true;try{if(inv.getItem(slot))throw Error('Reserved inventory slot changed');inv.setItem(slot,item);d.delivered[p.name]=true;d.pending=null;if(!safeSave()){d.pending=op;return false;}
   fullNotice.delete(p.name);message(p,'러너 추적기 1개를 받았습니다. 기본 설정에서는 분실·사망 시 재지급하지 않습니다.');return true;
  }catch(e){report('tracker grant',e);message(p,'추적기 지급 결과를 확인할 수 없어 재지급을 보류했습니다. 관리자 확인 필요.');return false;}finally{busy=false;}
 }
 function second(){if(!enabled()||!live())return;const d=data();if(!d||d.pending)return;
  for(const [id,b]of born)if(system.currentTick-b.tick>2)born.delete(id);
  const s=state(),times=recipeTimes(s.config);let dirty=false;
  if(s.seconds>=times.reveal)for(const p of world.getAllPlayers())if(hunter(p)&&alive(p)&&!d.announced[p.name]){d.announced[p.name]=true;dirty=true;if(s.config.trackerNotices!==false){message(p,'추적기 제작법이 공개됐습니다. /mh:trackerrecipe 로 다시 확인하고 /mh:craft 로 투척 제작 모드를 켜세요.');message(p,describe(p));}}
  if(!d.completion&&s.config.trackerAutoGive!==false&&s.seconds>=times.auto){d.completion='auto';dirty=true;clearSessions();if(s.config.trackerNotices!==false)for(const p of world.getAllPlayers())if(hunter(p))message(p,'제작 제한 시간이 끝나 헌터에게 추적기를 자동 지급합니다.');}
  if(dirty&&!safeSave())return;
  if(d.completion)for(const p of world.getAllPlayers())deliver(p);
 }
 function joined(p){sessions.delete(p.name);fullNotice.delete(p.name);if(enabled()&&live())deliver(p);}
 function resolvePending(p,consumedConfirmed){const d=data();if(p.name!==state().host||!d?.pending||busy)return false;const op=d.pending;
  if(op.kind==='consume'){if(consumedConfirmed)applyConsumption(d,op);else{d.step=op.step;d.amount=op.previousAmount;d.completion=null;if(!d.seen.includes(op.id))d.seen.push(op.id);}}
  else if(op.kind==='grant'){if(consumedConfirmed)d.delivered[op.player]=true;else delete d.delivered[op.player];}
  d.pending=null;if(!safeSave()){d.pending=op;return false;}message(p,'관리자 확인대로 미완료 거래를 정리했습니다. 아이템을 자동 복제·환불하지 않았습니다.');return true;
 }
 return {startRound,second,spawned,drop,toggle,describe,joined,reset,clearSessions,ready,resolvePending,active:p=>sessions.has(p.name)};
}
