import test from 'node:test';
import assert from 'node:assert/strict';
import {modeForSeed,borderCenter,parseFortressWaypoint,validFortressWaypoint,ORIGINAL_MANHUNT_SEED} from '../BP/scripts/world-compat.js';
import {inBounds} from '../BP/scripts/expansion-core.js';

test('original seed keeps classic mode and all other seeds choose portable',()=>{
 assert.equal(modeForSeed(ORIGINAL_MANHUNT_SEED),'classic');
 for(const seed of ['1','-42',0,undefined,'5722806843399174314'])assert.equal(modeForSeed(seed),'portable');
});
test('world bounds keep legacy origin while external maps follow start location and Nether /8',()=>{
 assert.deepEqual(borderCenter({worldMode:'classic',start:{x:80000,z:-16000}},'minecraft:overworld'),{x:0,z:0});
 const s={worldMode:'portable',start:{x:40000.5,z:-24000.5}};
 assert.deepEqual(borderCenter(s,'minecraft:overworld'),{x:40000,z:-24001});
 assert.deepEqual(borderCenter(s,'minecraft:nether'),{x:5000,z:-3001});
 assert.deepEqual(borderCenter(s,'minecraft:the_end'),{x:0,z:0});
 const c=borderCenter(s,'minecraft:overworld');
 assert(inBounds({x:c.x-5000,z:c.z+4999},'minecraft:overworld',c));
 assert(!inBounds({x:c.x+5000,z:c.z},'minecraft:overworld',c));
});
test('fortress waypoint accepts only safe finite integer coordinates and never guesses',()=>{
 assert.deepEqual(parseFortressWaypoint(' -352 ','640'),{x:-352,z:640});
 for(const [x,z] of [['3.5','0'],['1','Infinity'],['0','abc'],['3750001','0'],['0','-3750001'],['','5'],[300,400]])assert.equal(parseFortressWaypoint(x,z),null);
 assert.equal(validFortressWaypoint({x:0,z:0}),true);assert.equal(Boolean(validFortressWaypoint({x:Infinity,z:1})),false);
});
