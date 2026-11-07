import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectFiles,readZip} from './archive.mjs';
import {readNBT} from './nbt.mjs';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const VERSION='1.5.0';
export const NAMES={world:`Manhunt_Night_v${VERSION}.mcworld`,addon:`Manhunt_Night_v${VERSION}.mcaddon`,source:`Manhunt_Night_Source_v${VERSION}.zip`,bundle:`Manhunt_Night_v${VERSION}_전체파일.zip`};
export const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
export const parseJSON=bytes=>JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\ufeff/,''));
const json=(files,name)=>{assert(files.has(name),'Missing '+name);return parseJSON(files.get(name));};
const asMap=dir=>new Map(collectFiles(dir).map(e=>[e.name,e.data]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILTIN_TEXTURES=new Set(['textures/items/paper','textures/items/totem']);
export function verifyPacks(bp,rp){
 const bm=json(bp,'manifest.json'),rm=json(rp,'manifest.json'),version=VERSION.split('.').map(Number),allIds=[];
 for(const manifest of [bm,rm]){
  assert.equal(manifest.format_version,2);assert.deepEqual(manifest.header.version,version);assert.deepEqual(manifest.header.min_engine_version,[1,26,62]);
  for(const entry of [manifest.header,...manifest.modules]){assert(UUID.test(entry.uuid));allIds.push(entry.uuid);assert.deepEqual(entry.version,version);}
 }
 assert.equal(new Set(allIds).size,allIds.length,'Manifest UUID collision');
 assert.equal(bm.dependencies.find(d=>d.module_name==='@minecraft/server')?.version,'2.11.0');assert.equal(bm.dependencies.find(d=>d.module_name==='@minecraft/server-ui')?.version,'2.3.0');
 assert.deepEqual(bm.dependencies.find(d=>d.uuid),{uuid:rm.header.uuid,version});assert(!JSON.stringify(bm).includes('-beta'));
 assert.equal(bm.modules.find(m=>m.type==='script').entry,'scripts/main.js');assert(bp.has('scripts/main.js'));assert(bp.has('scripts/tracker-crafting.js'));assert(bp.has('scripts/summon.js'));assert(bp.has('scripts/runner-special.js'));
 let jsonCount=0;for(const files of [bp,rp])for(const [name,data]of files){
  assert(!/(?:^|\/)node_modules\//.test(name));
  if(name.endsWith('.json')){parseJSON(data);jsonCount++;}
  if(name.endsWith('.js')){
   const code=data.toString('utf8');assert(!/QA_VIRTUAL_RUNNER|QA1[125]|qaRun\d+|mh:qa\d+|runtime-qa/i.test(code),'Runtime QA driver leaked: '+name);
   for(const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));assert(files.has(target),'Missing script import '+target);}
  }
 }
 const atlas=json(rp,'textures/item_texture.json').texture_data,ids=new Set(),frameHashes=[];
 for(const [name,bytes]of bp)if(name.startsWith('items/')&&name.endsWith('.json')){
  const definition=parseJSON(bytes),item=definition['minecraft:item'],id=item.description.identifier;
  assert(id.startsWith('mh:'));assert(!ids.has(id),'Duplicate item '+id);ids.add(id);assert(definition.format_version);assert.equal(item.components['minecraft:max_stack_size'],1);
  const icon=item.components['minecraft:icon'].textures.default,texture=atlas[icon]?.textures;assert(typeof texture==='string','Missing atlas '+icon);
  assert(rp.has(texture+'.png')||BUILTIN_TEXTURES.has(texture),'Missing texture '+texture);
 }
 for(let i=0;i<32;i++){
  const item=json(bp,`items/tracker_${i}.json`)['minecraft:item'];assert.equal(item.description.identifier,`mh:tracker_${i}`);assert.equal(item.components['minecraft:display_name'].value,'§a§l러너 추적기§r');
  const png=rp.get(`textures/items/tracker_${i}.png`);assert(png);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),16);assert.equal(png.readUInt32BE(20),16);frameHashes.push(sha256(png));
 }
 assert.equal([...ids].filter(id=>/^mh:tracker_\d+$/.test(id)).length,32);assert(new Set(frameHashes).size>=24,'Compass frames fail to improve angular detail');
 const revive=json(bp,'recipes/revive_totem.json')['minecraft:recipe_shaped'];assert.deepEqual(revive.pattern,['NNN','NTN','NNN']);assert.deepEqual(revive.key,{N:{item:'minecraft:netherite_ingot'},T:{item:'minecraft:totem_of_undying'}});assert.deepEqual(revive.result,{item:'mh:revive_totem',count:1});
 const summon=json(bp,'recipes/summon_scroll.json')['minecraft:recipe_shaped'];assert.deepEqual(summon.pattern,['PEP','ECE','PEP']);assert.deepEqual(summon.key,{P:{item:'minecraft:paper'},E:{item:'minecraft:ender_pearl'},C:{item:'minecraft:compass'}});assert.deepEqual(summon.result,{item:'mh:summon_scroll',count:1});
 for(const [name,bytes]of bp)if(name.startsWith('recipes/')){const recipe=parseJSON(bytes)['minecraft:recipe_shaped'];assert(recipe);assert.equal(recipe.unlock.context,'AlwaysUnlocked');assert(!recipe.result.item.startsWith('mh:tracker_'),'Random tracker must not have a workbench shortcut');}
 const main=bp.get('scripts/main.js').toString('utf8');for(const component of ['mh:receiver_use','mh:revive_use','mh:summon_use'])assert(main.includes(component),'Item callback registration missing '+component);
 return {jsonFiles:jsonCount,items:ids.size,compassFrames:32,uniqueCompassImages:new Set(frameHashes).size,stableDependencies:'PASS',manifestUUIDs:'PASS',recipes:'PASS',builtinTextureReferences:[...BUILTIN_TEXTURES],runtimeQANotDistributed:'PASS'};
}
export async function verifySource(root=ROOT){
 const result=verifyPacks(asMap(path.join(root,'BP')),asMap(path.join(root,'RP')));assert.equal(parseJSON(fs.readFileSync(path.join(root,'package.json'))).version,VERSION);
 const core=await import(pathToFileURL(path.join(root,'BP/scripts/core.js')).href);assert.equal(core.VERSION,VERSION);
 for(const [target,expected]of [[{x:0,y:0,z:10},0],[{x:-10,y:0,z:0},8],[{x:0,y:0,z:-10},16],[{x:10,y:0,z:0},24]])assert.equal(core.tracking({x:0,y:0,z:0},0,target).compassFrame,expected);
 const craft=await import(pathToFileURL(path.join(root,'BP/scripts/tracker-crafting.js')).href);assert.equal(craft.MATERIALS.length,27);assert.equal(new Set(craft.MATERIALS.map(m=>m.id)).size,27);
 for(let i=0;i<25;i++){const recipe=craft.createRecipe();assert.equal(recipe.length,9);assert.equal(new Set(recipe.map(m=>m.id)).size,9);assert.equal(recipe.filter(m=>m.hard).length,2);assert(recipe.filter(m=>m.hard).every(m=>m.amount===6));}
 return {...result,materialPool:27,recipeSelection:'7 common + 2 hard, distinct',compassCardinals:'PASS'};
}
export async function verifyDistribution(dir=path.join(ROOT,'dist'),{addonOnly=false,bundle=true}={}){
 const result=await verifySource(),addon=readZip(fs.readFileSync(path.join(dir,NAMES.addon))),bp=readZip(addon.get('ManhuntNight_BP.mcpack')),rp=readZip(addon.get('ManhuntNight_RP.mcpack'));
 verifyPacks(bp,rp);
 for(const [files,folder]of [[bp,'BP'],[rp,'RP']]){const expected=asMap(path.join(ROOT,folder));assert.equal(files.size,expected.size);for(const [name,data]of expected)assert(data.equals(files.get(name)),'Distributed pack differs from source '+name);}
 const source=readZip(fs.readFileSync(path.join(dir,NAMES.source)));for(const name of ['README.md','LICENSE','package.json','tests/integration.test.js','tools/build.mjs','tools/verify.mjs'])assert(source.has(name));assert(![...source.keys()].some(n=>/(^|\/)(?:\.git|node_modules|dist|work)\//.test(n)));
 for(const [files,prefix]of [[bp,'BP/'],[rp,'RP/']])for(const [name,data]of files)assert(data.equals(source.get(prefix+name)));
 const manifest=parseJSON(fs.readFileSync(path.join(dir,'BUILD_MANIFEST.json')));
 if(!addonOnly){
  const world=readZip(fs.readFileSync(path.join(dir,NAMES.world))),bm=json(bp,'manifest.json'),rm=json(rp,'manifest.json');
  assert.deepEqual(json(world,'world_behavior_packs.json'),[{pack_id:bm.header.uuid,version:bm.header.version}]);assert.deepEqual(json(world,'world_resource_packs.json'),[{pack_id:rm.header.uuid,version:rm.header.version}]);
  for(const [files,prefix]of [[bp,'behavior_packs/ManhuntNight_BP/'],[rp,'resource_packs/ManhuntNight_RP/']])for(const [name,data]of files)assert(data.equals(world.get(prefix+name)),'Embedded pack mismatch '+name);
  const nbt=readNBT(world.get('level.dat')).value;assert(nbt.LevelName.value.includes('v1.5.0'));assert.equal(nbt.spawnradius.value,0);assert.equal(nbt.commandblocksenabled.value,0);
  for(const [key,entry]of Object.entries(nbt.experiments?.value??{}))if(!['experiments_ever_used','saved_with_toggled_experiments'].includes(key))assert.equal(entry.value,0);
  const dbEntries=[...world.keys()].filter(n=>n.startsWith('db/'));assert.equal(dbEntries.length,manifest.baseWorld.databaseFiles.length);
  for(const entry of manifest.baseWorld.databaseFiles){assert(world.has(entry.file));assert.equal(sha256(world.get(entry.file)),entry.sha256,'Original terrain mismatch '+entry.file);}
  result.worldDatabase='PASS - byte-identical to preserved base';result.worldFiles=world.size;
 }
 for(const line of fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)){const match=line.match(/^([a-f0-9]{64})  (.+)$/);assert(match);assert.equal(sha256(fs.readFileSync(path.join(dir,match[2]))),match[1],'SHA-256 mismatch '+match[2]);}
 if(bundle&&!addonOnly){const whole=readZip(fs.readFileSync(path.join(dir,NAMES.bundle)));for(const name of [NAMES.world,NAMES.addon,NAMES.source,'README.md','INSTALL.md','FEATURES.md','CHANGELOG.md','QA_REPORT.md','SHA256SUMS.txt','BUILD_MANIFEST.json']){assert(whole.has(name));assert(whole.get(name).equals(fs.readFileSync(path.join(dir,name))));}
  assert.equal(fs.readFileSync(path.join(dir,NAMES.bundle+'.sha256'),'utf8').trim(),`${sha256(fs.readFileSync(path.join(dir,NAMES.bundle)))}  ${NAMES.bundle}`);result.bundle='PASS';}
 return {...result,zipCRC:'PASS',sourceAndDistributedPacks:'PASS',checksums:'PASS',mode:addonOnly?'addon-only':'world+addon+source'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const source=process.argv.includes('--source'),addonOnly=process.argv.includes('--addon-only');
 const result=source?await verifySource():await verifyDistribution(path.join(ROOT,'dist'),{addonOnly});
 if(!source)fs.writeFileSync(path.join(ROOT,'dist','VERIFICATION.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
