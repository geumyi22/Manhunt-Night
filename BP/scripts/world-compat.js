// Pure helpers for applying Manhunt to arbitrary Bedrock worlds.
// Existing imported save states retain their historical mode until explicitly migrated.
export const ORIGINAL_MANHUNT_SEED='5722806843399174313';
export function modeForSeed(seed){return String(seed??'')===ORIGINAL_MANHUNT_SEED?'classic':'portable';}
export function borderCenter(state,dimension){
 if(state?.worldMode!=='portable'||!state.start)return {x:0,z:0};
 if(dimension==='minecraft:the_end')return {x:0,z:0};
 if(dimension==='minecraft:nether')return {x:Math.floor(state.start.x/8),z:Math.floor(state.start.z/8)};
 return {x:Math.floor(state.start.x),z:Math.floor(state.start.z)};
}
export function parseFortressWaypoint(x,z){
 const integer=v=>typeof v==='string'&&/^-?\d{1,8}$/.test(v.trim())?Number(v.trim()):NaN;
 const px=integer(x),pz=integer(z);
 if(!Number.isSafeInteger(px)||!Number.isSafeInteger(pz)||Math.abs(px)>3750000||Math.abs(pz)>3750000)return null;
 return {x:px,z:pz};
}
export function validFortressWaypoint(point){return point&&Number.isInteger(point.x)&&Number.isInteger(point.z)&&Math.abs(point.x)<=3750000&&Math.abs(point.z)<=3750000;}
