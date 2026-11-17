import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_FORTRESS_MAX,naturalFortressSpawn,fortressBrickEvidence,rememberAutoFortress,nearestAutoFortress} from '../BP/scripts/fortress-detect.js';
const spawn=(cause='Spawned',type='minecraft:wither_skeleton',dim='minecraft:nether')=>({cause,entity:{typeId:type,dimension:{id:dim},location:{x:120.4,y:69,z:-520.2}}});
test('fortress spawn requires a naturally spawned wither skeleton in the Nether',()=>{
 assert(naturalFortressSpawn(spawn()));
 for(const value of [spawn('Loaded'),spawn('Event'),spawn('Born'),spawn('Spawned','minecraft:blaze'),spawn('Spawned','minecraft:wither_skeleton','minecraft:overworld')])assert(!naturalFortressSpawn(value));
 assert(!naturalFortressSpawn({cause:'Spawned',entity:{typeId:'minecraft:wither_skeleton',dimension:{id:'minecraft:nether'},location:{x:NaN,y:64,z:0}}}));
});
test('unloaded data and isolated decorative bricks never pass structure corroboration',()=>{
 let seen=0;
 const world={getBlock:p=>{seen++;return{typeId:p.x>=119&&p.x<=121?'minecraft:nether_brick':'minecraft:air'};}};
 assert(fortressBrickEvidence(world,{x:120,y:69,z:-520}));assert(seen<=147);
 assert(!fortressBrickEvidence({getBlock:()=>({typeId:'minecraft:air'})},{x:120,y:69,z:-520}));
 assert(!fortressBrickEvidence({getBlock:()=>undefined},{x:120,y:69,z:-520}));
 assert(!fortressBrickEvidence({getBlock:()=>{throw Error('unloaded')}},{x:120,y:69,z:-520}));
});
test('automatic fortress memory deduplicates, caps at eight and preserves historical entries',()=>{
 let a=[];for(let i=0;i<AUTO_FORTRESS_MAX;i++){const r=rememberAutoFortress(a,{x:i*256,z:i*512});assert(r.added);a=r.spots;}
 assert.equal(a.length,8);
 assert.equal(rememberAutoFortress(a,{x:256+1,z:512+2}).added,false);
 assert.equal(rememberAutoFortress(a,{x:4000,z:9000}).added,false);
 assert.deepEqual(a[0],{x:0,z:0});
});
test('hint selection chooses nearby explored fortress by dimension and excludes invalid data',()=>{
 const spots=[{x:100,z:20},{x:-100,z:200},{x:NaN,z:2}];
 assert.deepEqual(nearestAutoFortress(spots,{x:780,z:160},'minecraft:overworld'),{x:100,z:20});
 assert.deepEqual(nearestAutoFortress(spots,{x:-100,y:60,z:199},'minecraft:nether'),{x:-100,z:200});
 assert.equal(nearestAutoFortress([],{},'minecraft:overworld'),null);
});
