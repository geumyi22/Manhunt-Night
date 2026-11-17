import test from 'node:test';
import assert from 'node:assert/strict';
import {findSafeGroundStart,safeGroundAt,safeFloorId} from '../BP/scripts/start-ground.js';
function dimension({groundY=64,surface='minecraft:stone',blockOverride=()=>undefined,topOverride=null}={}){
 return {heightRange:{min:-64,max:320},
  getTopmostBlock({x,z}){return topOverride?topOverride(x,z):{location:{y:groundY}};},
  getBlock(pos){const extra=blockOverride(pos);
   if(extra!==undefined)return extra===null?undefined:{typeId:extra,isLiquid:extra==='minecraft:water'||extra==='minecraft:lava',isWaterlogged:false};
   const type=pos.y===groundY?surface:'minecraft:air';return {typeId:type,isLiquid:false,isWaterlogged:false};
  }};
}
test('Y100 above ground is corrected to standing Y65',()=>{
 assert.deepEqual(findSafeGroundStart(dimension(),{x:12.5,y:100,z:4.5}),{x:12.5,y:65,z:4.5});
});
test('old Y304 lobby platform is never chosen as ground for a match',()=>{
 const d=dimension({topOverride:()=>({location:{y:309}}),blockOverride:({x,y,z})=>
  y===304&&Math.abs(x-12)<11&&Math.abs(z-4)<11?'minecraft:cyan_concrete':undefined});
 assert.deepEqual(findSafeGroundStart(d,{x:12.5,y:100,z:4.5},{x:12.5,y:305,z:4.5}),{x:12.5,y:65,z:4.5});
});
test('unsafe terrain surfaces are not accepted as match landing',()=>{
 for(const type of ['minecraft:lava','minecraft:magma_block','minecraft:powder_snow','minecraft:oak_leaves',
  'minecraft:ice','minecraft:farmland','minecraft:oak_fence'])assert(!safeFloorId(type));
});
test('unloaded ground and no valid natural ground both fail closed',()=>{
 assert.equal(findSafeGroundStart(dimension({topOverride:()=>undefined}),{x:1,y:100,z:1}),null);
 assert.equal(findSafeGroundStart(dimension({surface:'minecraft:lava'}),{x:1,y:100,z:1}),null);
});
test('changed terrain selects the first safe nearby column without modifying blocks',()=>{
 const d=dimension({blockOverride:({x,y})=>x===10&&y===64?'minecraft:lava':undefined});
 assert.deepEqual(findSafeGroundStart(d,{x:10.5,y:100,z:10.5}),{x:12.5,y:65,z:10.5});
});
test('blocked head space, water and absent footing reject an otherwise valid start',()=>{
 const p={x:1.5,y:65,z:1.5};
 assert.equal(safeGroundAt(dimension({blockOverride:({x,y,z})=>x===1&&y===66&&z===1?'minecraft:stone':undefined}),p),false);
 assert.equal(safeGroundAt(dimension({blockOverride:({x,y,z})=>x===1&&y===65&&z===1?'minecraft:water':undefined}),p),false);
});
