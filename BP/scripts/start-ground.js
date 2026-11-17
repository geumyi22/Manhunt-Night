// Portable-world match start resolver, independent of lobby Y.
// Uses stable Dimension.getTopmostBlock/getBlock, never the pre-release Block.isSolid.
// Read only: never changes terrain, players, gamerules or saved data.
const SAFE_FLOORS = new Set([
 'minecraft:grass_block','minecraft:grass','minecraft:dirt','minecraft:coarse_dirt',
 'minecraft:rooted_dirt','minecraft:podzol','minecraft:mycelium','minecraft:stone',
 'minecraft:granite','minecraft:diorite','minecraft:andesite','minecraft:cobblestone',
 'minecraft:deepslate','minecraft:cobbled_deepslate','minecraft:tuff','minecraft:calcite',
 'minecraft:bedrock','minecraft:moss_block','minecraft:mud','minecraft:packed_mud',
 'minecraft:clay','minecraft:sand','minecraft:red_sand','minecraft:gravel',
 'minecraft:snow_block','minecraft:terracotta','minecraft:netherrack',
 'minecraft:basalt','minecraft:blackstone','minecraft:end_stone','minecraft:obsidian',
 'minecraft:polished_deepslate','minecraft:polished_andesite','minecraft:polished_diorite',
 'minecraft:polished_granite','minecraft:stone_bricks','minecraft:deepslate_bricks',
 'minecraft:bricks','minecraft:planks','minecraft:oak_planks','minecraft:spruce_planks',
 'minecraft:birch_planks','minecraft:jungle_planks','minecraft:acacia_planks',
 'minecraft:dark_oak_planks','minecraft:mangrove_planks','minecraft:cherry_planks',
 'minecraft:bamboo_planks','minecraft:crimson_planks','minecraft:warped_planks'
]);
const BAD_FLOORS = new Set([
 'minecraft:magma','minecraft:magma_block','minecraft:lava','minecraft:water',
 'minecraft:powder_snow','minecraft:fire','minecraft:soul_fire','minecraft:campfire',
 'minecraft:soul_campfire','minecraft:cactus','minecraft:slime_block',
 'minecraft:honey_block','minecraft:farmland','minecraft:grass_path',
 'minecraft:dirt_path','minecraft:ice','minecraft:blue_ice',
 'minecraft:packed_ice','minecraft:scaffolding'
]);
const AIR = new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air']);
const PASSABLE = new Set([...AIR,'minecraft:short_grass','minecraft:tall_grass',
 'minecraft:fern','minecraft:large_fern','minecraft:deadbush','minecraft:dead_bush']);
const OFFSETS = Object.freeze([[0,0],[2,0],[-2,0],[0,2],[0,-2],
 [4,0],[-4,0],[0,4],[0,-4],[4,4],[-4,4],[4,-4],[-4,-4],
 [8,0],[-8,0],[0,8],[0,-8],[8,8],[-8,8],[8,-8],[-8,-8],
 [16,0],[-16,0],[0,16],[0,-16]]);

export function safeFloorId(id) {
 if(typeof id!=='string'||BAD_FLOORS.has(id))return false;
 if(SAFE_FLOORS.has(id))return true;
 if(!id.startsWith('minecraft:'))return false; // unknown add-on blocks: fail closed
 return /_(?:concrete|terracotta|planks|bricks|brick|stone|sandstone|copper_block)$/.test(id)
  || /^minecraft:(?:smooth_stone|smooth_sandstone|smooth_red_sandstone|quartz_block)$/.test(id);
}
function passable(block) {return Boolean(block&&!block.isLiquid&&!block.isWaterlogged&&PASSABLE.has(block.typeId));}
function getBlock(d,x,y,z){return d.getBlock({x,y,z});}
// A stable, safe, two-block standing volume with physical support below.
export function safeGroundAt(d,pos,lobby=null) {
 if(!d||![pos?.x,pos?.y,pos?.z].every(Number.isFinite))return false;
 const x=Math.floor(pos.x),y=Math.floor(pos.y),z=Math.floor(pos.z);
 try {
  const range=d.heightRange;
  if(range&&(y-1<range.min||y+1>=range.max))return false;
  if(lobby&&Math.abs(x-Math.floor(lobby.x))<=10&&Math.abs(z-Math.floor(lobby.z))<=10
    &&y>=Math.floor(lobby.y)-1&&y<=Math.floor(lobby.y)+6)return false;
  const ground=getBlock(d,x,y-1,z);
  const feet=getBlock(d,x,y,z),head=getBlock(d,x,y+1,z);
  if(!ground||!safeFloorId(ground.typeId)||ground.isWaterlogged||ground.isLiquid
     ||!passable(feet)||!passable(head))return false;
  // Avoid unsupported gravel/sand above empty space.
  if(['minecraft:sand','minecraft:red_sand','minecraft:gravel'].includes(ground.typeId)) {
   const beneath=getBlock(d,x,y-2,z);
   if(!beneath||AIR.has(beneath.typeId)||beneath.isLiquid)return false;
  }
  // A tiny column in a void is not a safe common start for all players.
  let neighboringSupports=0;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
   const a=getBlock(d,x+dx,y-1,z+dz);
   const lower=!a||!safeFloorId(a.typeId)?getBlock(d,x+dx,y-2,z+dz):a;
   if(lower&&safeFloorId(lower.typeId))neighboringSupports++;
  }
  return neighboringSupports>=2;
 }catch{return false;}
}
export function findSafeGroundStart(d,anchor,lobby=null){
 if(!d||![anchor?.x,anchor?.z].every(Number.isFinite))return null;
 // Fast path: a saved start remains grounded after a restart and is not the lobby floor.
 if(Number.isFinite(anchor.y)&&safeGroundAt(d,anchor,lobby))
  return {x:Math.floor(anchor.x)+0.5,y:Math.floor(anchor.y),z:Math.floor(anchor.z)+0.5};
 for(const [dx,dz] of OFFSETS){
  const x=Math.floor(anchor.x)+dx,z=Math.floor(anchor.z)+dz;
  try{
   const top=d.getTopmostBlock({x,z});
   if(!top||!Number.isFinite(top.location?.y))continue;
   const min=Math.max(-63,d.heightRange?.min??-63);
   const ceiling=lobby&&Math.abs(x-Math.floor(lobby.x))<=10&&Math.abs(z-Math.floor(lobby.z))<=10
    ?Math.floor(lobby.y)-8:Infinity;
   let y=Math.min(Math.floor(top.location.y)+1,ceiling);
   for(;y>=min+1;y--){
    if(safeGroundAt(d,{x,y,z},lobby))return {x:x+0.5,y,z:z+0.5};
   }
  }catch{/* an unloaded/out-of-bounds candidate is not safe */}
 }
 return null;
}
