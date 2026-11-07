import {wildRespawnBudget,wildRespawnsRemaining,wildRespawnLimit} from './runner.js';

export const REVIVE_ITEM='mh:revive_totem';
const RECEIPT='mh:revive_receipt';
export function createRunnerSpecial(world,system,state,{inventory,tell,report,isDead,save,isAdmin=(_p)=>false}){
 const lastUse=new Map(),notices=new Set();let busy=false,serial=0;
 function notifyPending(p){
  const tx=state().revivePending;if(!tx)return;
  const all=world.getAllPlayers(),recipients=[p,all.find(q=>q.name===state().host)].filter(Boolean);
  for(const q of recipients){const key=`${tx.token}:${q.id}`;if(notices.has(key))continue;notices.add(key);
   tell(q,'§e부활 아이템 거래 복구 대기 중입니다. 추가 사용과 경기 초기화가 차단됩니다. 표식 아이템을 옮기거나 버리지 말고 관리자 진단을 확인해 주세요.');
  }
 }
 function markedItems(p,token){const inv=inventory(p),found=[];if(!inv)return null;
  for(let slot=0;slot<inv.size;slot++){const item=inv.getItem(slot);if(item?.typeId===REVIVE_ITEM&&item.getDynamicProperty(RECEIPT)===token)found.push({inv,slot,item});}
  return found;
 }
 function clearPending(tx){const s=state();s.revivePending=null;
  try{save();return true;}catch(e){s.revivePending=tx;report('revive completion save',e);return false;}
 }
 function restoreMark(entry){const item=entry.item.clone();item.setDynamicProperty(RECEIPT);entry.inv.setItem(entry.slot,item);}
 function recover(){
  const s=state(),tx=s.revivePending;if(!tx)return true;if(busy)return false;
  const p=world.getAllPlayers().find(q=>q.name===tx.runner);
  if(tx.round!==s.round||tx.runner!==s.runner||!p||isDead(p)||!Number.isInteger(tx.bonusBefore)||tx.bonusBefore<0||tx.bonusBefore>=20||tx.bonusAfter!==tx.bonusBefore+1){notifyPending(p);return false;}
  busy=true;
  try{
   const found=markedItems(p,tx.token);if(!found||found.length>1||found[0]?.item.amount>1){notifyPending(p);return false;}
   const entry=found[0];
   if(tx.phase==='committed'){
    // The persisted commit records that debit succeeded. A surviving marked item is consumed once.
    s.runnerLifeBonus=tx.bonusAfter;if(entry)entry.inv.setItem(entry.slot);lastUse.set(`${s.round}:${p.id}`,system.currentTick);
    return clearPending(tx);
   }
   if(tx.phase==='prepared'||tx.phase==='restored'){
    // No debit was attempted, or an exact refund was confirmed before this phase was saved.
    s.runnerLifeBonus=tx.bonusBefore;if(entry)restoreMark(entry);
    return clearPending(tx);
   }
   if((tx.phase==='debit'||tx.phase==='rollback')&&entry){
    // A remaining uniquely marked item proves that no additional refund should be manufactured.
    s.runnerLifeBonus=tx.bonusBefore;tx.phase='restored';save();restoreMark(entry);
    return clearPending(tx);
   }
   // Missing receipt in an uncommitted debit is ambiguous. Preserve the journal indefinitely.
   notifyPending(p);return false;
  }catch(e){report('revive recovery',e);notifyPending(p);return false;}finally{busy=false;}
 }
 function useRevive(p){
  const s=state();
  if(s.config.features?.reviveItem===false||s.config.features?.wildRespawns===false)return false;
  if(p?.typeId!=='minecraft:player'||p.name!==s.runner||!s.roster.includes(p.name))return false;
  if(!['grace','running'].includes(s.phase)||s.runnerRespawning||isDead(p))return false;
  if((p.getComponent('minecraft:health')?.currentValue??0)<=0||busy)return false;
  if(s.revivePending){recover();if(s.revivePending){notifyPending(p);return false;}}
  const key=`${s.round}:${p.id}`;
  if(system.currentTick-(lastUse.get(key)??-Infinity)<5)return false;
  const inv=inventory(p),slot=p.selectedSlotIndex,item=inv?.getItem(slot);
  // This custom item has max_stack_size 1. Dynamic-property receipts require a non-stackable item.
  if(item?.typeId!==REVIVE_ITEM||item.amount!==1||item.getDynamicProperty(RECEIPT)!==undefined)return false;
  const limit=wildRespawnLimit(s);
  if(wildRespawnBudget(s)>=limit){tell(p,`이번 경기의 최대 야생 부활 기회(${limit}회)를 이미 확보했습니다. 아이템은 유지됩니다.`);return false;}
  const previous=Number.isFinite(s.runnerLifeBonus)?Math.max(0,Math.min(20,Math.floor(s.runnerLifeBonus))):0;
  const original=item.clone(),marked=original.clone();
  const tx={token:`${s.round}:${p.id}:${system.currentTick}:${++serial}`,round:s.round,runner:p.name,slot,phase:'prepared',bonusBefore:previous,bonusAfter:previous+1};
  marked.setDynamicProperty(RECEIPT,tx.token);s.revivePending=tx;busy=true;let debitAttempted=false;
  try{
   inv.setItem(slot,marked);save();
   tx.phase='debit';save();
   const current=inv.getItem(slot);
   if(current?.typeId!==REVIVE_ITEM||current.amount!==1||current.getDynamicProperty(RECEIPT)!==tx.token)throw Error('revive receipt changed before debit');
   debitAttempted=true;inv.setItem(slot);s.runnerLifeBonus=tx.bonusAfter;tx.phase='committed';save();
   if(!clearPending(tx))throw Error('revive completion could not be persisted');
   lastUse.set(key,system.currentTick);tell(p,`§a야생 부활 기회 1회 추가! 남은 부활 ${wildRespawnsRemaining(s)}회.`);return true;
  }catch(error){
   // Synchronous failure: refund the exact original stack, retaining its receipt until rollback is saved.
   s.runnerLifeBonus=previous;s.revivePending=tx;tx.phase='rollback';
   try{
    const current=inv.getItem(slot);
    if(current&&current.getDynamicProperty?.(RECEIPT)!==tx.token){
     if(debitAttempted)throw Error('revive refund slot occupied');
     // Marking failed before debit. Keep the untouched original item rather than overwrite it.
     tx.phase='restored';save();clearPending(tx);
    }else {inv.setItem(slot,marked);tx.phase='restored';save();restoreMark({inv,slot,item:marked});clearPending(tx);}
   }catch(rollbackError){report('revive rollback',rollbackError);try{save();}catch(saveError){report('revive rollback save',saveError);}}
   report('revive transaction',error);
   if(s.revivePending)notifyPending(p);else tell(p,'부활 아이템 사용을 취소하고 원래 아이템을 보존했습니다. 다시 사용할 수 있습니다.');
   return false;
  }finally{busy=false;}
 }
 function reset(){if(state().revivePending&&!recover())return false;lastUse.clear();notices.clear();return true;}
 function leave(p){for(const key of lastUse.keys())if(key.endsWith(`:${p.id??p.playerId}`))lastUse.delete(key);}
 function resolvePending(admin,consumedConfirmed,token){
  const s=state(),tx=s.revivePending;
  if(!isAdmin(admin)||busy||!['paused','ended','lobby'].includes(s.phase)||typeof consumedConfirmed!=='boolean'||!tx||tx.token!==token)return false;
  const p=world.getAllPlayers().find(q=>q.name===tx.runner);
  if(tx.round!==s.round||tx.runner!==s.runner||!p||isDead(p)||!['debit','rollback'].includes(tx.phase)
   ||!Number.isInteger(tx.bonusBefore)||tx.bonusBefore<0||tx.bonusBefore>=20||tx.bonusAfter!==tx.bonusBefore+1)return false;
  busy=true;
  try{
   const found=[];for(const online of world.getAllPlayers()){
    const items=markedItems(online,tx.token);if(items===null){tell(admin,'접속자 인벤토리를 모두 확인할 수 없어 복구를 보류합니다.');return false;}
    for(const entry of items)found.push({...entry,owner:online.name});
   }
   if(found.length>1||found.some(entry=>entry.item.amount!==1||entry.owner!==p.name)){tell(admin,'표식 아이템이 중복되었거나 다른 플레이어에게 있습니다. 러너에게 원본을 돌려준 뒤 확인해 주세요.');return false;}
   if(consumedConfirmed&&found.length){tell(admin,'소비되지 않은 표식 토템이 러너에게 남아 있습니다. 소비 완료로 확정할 수 없습니다.');return false;}
   const previousBonus=s.runnerLifeBonus,previousPhase=tx.phase;
   tx.phase=consumedConfirmed?'committed':'restored';s.runnerLifeBonus=consumedConfirmed?tx.bonusAfter:tx.bonusBefore;
   try{save();}catch(e){tx.phase=previousPhase;s.runnerLifeBonus=previousBonus;throw e;}
   if(!consumedConfirmed&&found[0])restoreMark(found[0]);
   if(!clearPending(tx)){notifyPending(p);return false;}
   if(consumedConfirmed)lastUse.set(`${s.round}:${p.id}`,system.currentTick);
   tell(admin,consumedConfirmed?'관리자 확인으로 소비 완료를 확정하고 부활 기회 1회를 적용했습니다.':'관리자 확인으로 거래를 취소했습니다. 부활 기회 추가와 아이템 자동 환불은 하지 않았습니다.');
   if(admin.name!==p.name)tell(p,'관리자가 중단된 부활 거래를 확인했습니다. 아이템은 자동 생성되지 않습니다.');
   return true;
  }catch(e){report('revive manual recovery',e);notifyPending(p);return false;}finally{busy=false;}
 }
 return {useRevive,reset,leave,recover,joined:recover,hasPending:()=>!!state().revivePending,resolvePending};
}
