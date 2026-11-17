import {validFortressWaypoint} from './world-compat.js';

// Conservative, explored-chunk discovery. No beta structure API, seed calculator or /locate output parser.
export const AUTO_FORTRESS_MAX=8;
const BRICKS=new Set(['minecraft:nether_brick','minecraft:nether_brick_stairs','minecraft:nether_brick_fence']);
export function naturalFortressSpawn(event){
 const entity=event?.entity,position=entity?.location;
 return event?.cause==='Spawned'&&entity?.typeId==='minecraft:wither_skeleton'
   &&entity?.dimension?.id==='minecraft:nether'
   &&position&&[position.x,position.y,position.z].every(Number.isFinite);
}
export function fortressBrickEvidence(dimension,location){
 if(!dimension||!location)return false;
 let bricks=0;
 // A natural wither skeleton alone is not enough. Corroborate with an extended fortress-brick surface.
 // This is intentionally a sufficient heuristic, NOT a proof of a generated structure.
 try{
  const cx=Math.floor(location.x),cy=Math.floor(location.y),cz=Math.floor(location.z);
  for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)for(let dy=-2;dy<=0;dy++){
   const block=dimension.getBlock({x:cx+dx,y:cy+dy,z:cz+dz});
   if(!block)return false; // Unloaded or unknown chunks: do not assume a fortress.
   if(BRICKS.has(block.typeId)&&++bricks>=8)return true;
  }
 }catch{return false;}
 return false;
}
export function rememberAutoFortress(existing,location){
 if(!validFortressWaypoint(location))return {spots:Array.isArray(existing)?existing:[],added:false};
 const spots=Array.isArray(existing)?existing.filter(validFortressWaypoint).slice(0,AUTO_FORTRESS_MAX):[];
 if(spots.some(p=>Math.hypot(p.x-location.x,p.z-location.z)<96))return {spots,added:false};
 if(spots.length>=AUTO_FORTRESS_MAX)return {spots,added:false};
 return {spots:[...spots,{x:location.x,z:location.z}],added:true};
}
export function nearestAutoFortress(existing,position,dimension){
 if(!Array.isArray(existing)||!existing.length)return null;
 const spots=existing.filter(validFortressWaypoint);
 if(!spots.length)return null;
 const scale=dimension==='minecraft:nether'?1:8;
 const x=Number.isFinite(position?.x)?position.x/scale:0;
 const z=Number.isFinite(position?.z)?position.z/scale:0;
 return spots.reduce((best,p)=>!best||Math.hypot(p.x-x,p.z-z)<Math.hypot(best.x-x,best.z-z)?p:best,null);
}
