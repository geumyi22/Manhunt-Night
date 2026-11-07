import {tracking} from './core.js';
export const TRACKER_NAME='§a§l러너 추적기§r';
export const isTrackingItem=item=>/^mh:tracker_\d+$/.test(item?.typeId??'');
// All animation state is stored on each owned stack. No global texture/animation variable.
export function createTrackerDisplay({inventory,makeTracker}){
 const slots=new Map();
 function scan(p){const inv=inventory(p),found=new Set();if(inv)for(let i=0;i<inv.size;i++)if(isTrackingItem(inv.getItem(i)))found.add(i);slots.set(p.id,found);return found;}
 function changed(e){
  // Inventory events distinguish hotbar/main indices. Reconcile actual container slots once
  // on changes, never guess a section-relative slot or scan every animation tick.
  if(isTrackingItem(e.itemStack)!==isTrackingItem(e.beforeItemStack))scan(e.player);
 }
 function update(p,target){const inv=inventory(p);if(!inv)return;const found=slots.get(p.id)??scan(p);
  if(isTrackingItem(inv.getItem(p.selectedSlotIndex)))found.add(p.selectedSlotIndex);
  const type=`mh:tracker_${tracking(p.location,p.getRotation().y,target).compassFrame}`;
  for(const slot of found){const old=inv.getItem(slot);if(!isTrackingItem(old)){found.delete(slot);continue;}
   if(old.typeId!==type){const item=makeTracker(type);item.amount=old.amount;item.nameTag=TRACKER_NAME;
    for(const id of old.getDynamicPropertyIds?.()??[])item.setDynamicProperty(id,old.getDynamicProperty(id));
    inv.setItem(slot,item);}
  }
 }
 return {scan,changed,update,clear:p=>slots.delete(p.id),reset:()=>slots.clear()};
}
