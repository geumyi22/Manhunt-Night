import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {collectFiles,writeZip,readZip} from './archive.mjs';
import {readNBT,writeNBT} from './nbt.mjs';
import {ROOT,VERSION,NAMES,parseJSON,sha256,verifySource,verifyDistribution} from './verify.mjs';

const args=process.argv.slice(2),addonOnly=args.includes('--addon-only'),baseIndex=args.indexOf('--base');
const requested=baseIndex>=0?args[baseIndex+1]:process.env.MANHUNT_BASE_WORLD;
if(baseIndex>=0&&!requested)throw Error('--base requires an unpacked world directory or .mcworld file');
if(!addonOnly&&!requested)throw Error('Provide --base <world directory or .mcworld>, or MANHUNT_BASE_WORLD. Use --addon-only for CI without a private world.');
const dist=path.join(ROOT,'dist');fs.mkdirSync(dist,{recursive:true});
const write=(name,bytes)=>fs.writeFileSync(path.join(dist,name),bytes);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const packSource=await verifySource();
const bp=collectFiles(path.join(ROOT,'BP')),rp=collectFiles(path.join(ROOT,'RP'));
const bm=parseJSON(bp.find(e=>e.name==='manifest.json').data),rm=parseJSON(rp.find(e=>e.name==='manifest.json').data);
write(NAMES.addon,writeZip([{name:'ManhuntNight_BP.mcpack',data:writeZip(bp)},{name:'ManhuntNight_RP.mcpack',data:writeZip(rp)}]));
const source=[];for(const folder of ['BP','RP','tests','docs','tools','.github'])source.push(...collectFiles(path.join(ROOT,folder),folder+'/'));
for(const file of ['README.md','LICENSE','package.json','package-lock.json','tsconfig.json','.gitignore','.gitattributes']){assert(fs.existsSync(path.join(ROOT,file)),'Missing source file '+file);source.push({name:file,data:fs.readFileSync(path.join(ROOT,file))});}
write(NAMES.source,writeZip(source));
const report={version:VERSION,targetGame:'26.62',releaseStatus:'PRE-RELEASE until documented runtime QA supports promotion',sourcePackChecks:packSource,baseWorld:null,metadataChanges:[]};
const outputs=[NAMES.addon,NAMES.source];
if(!addonOnly){
 const base=path.resolve(requested),stat=fs.statSync(base),readBase=()=>stat.isDirectory()?new Map(collectFiles(base).map(e=>[e.name,e.data])):readZip(fs.readFileSync(base));
 const original=readBase();assert(original.has('level.dat'),'World must contain level.dat at archive/directory root');
 const database=[...original].filter(([name])=>name.startsWith('db/'));assert(database.length>0,'World must contain a Bedrock db directory');
 const originalMetadata=original.get('level.dat'),nbt=readNBT(originalMetadata),seed=nbt.value.RandomSeed?.value;
 report.baseWorld={name:path.basename(base),provenance:'Preserved user-supplied MANHUNT terrain. GitHub contained v1.4.0 source and QA text but no downloadable v1.4.0 world release; no v1.4.0 archive comparison is claimed.',seed:seed===undefined?null:String(seed),databaseFiles:database.map(([file,data])=>({file,bytes:data.length,sha256:sha256(data)})),baseContentSha256:sha256(Buffer.from(JSON.stringify([...original].map(([name,data])=>[name,sha256(data)]).sort((a,b)=>a[0].localeCompare(b[0],'en')))))};
 // Modify only the new output metadata. The base directory/archive is always read-only.
 const settings={LevelName:`MANHUNT NIGHT v${VERSION} · 3~4인`,GameType:2,ForceGameType:1,Difficulty:2,cheatsEnabled:1,commandsEnabled:1,commandblocksenabled:0,commandblockoutput:0,sendcommandfeedback:0,showcoordinates:0,showdaysplayed:0,spawnradius:0,MultiplayerGame:1,MultiplayerGameIntent:1,texturePacksRequired:1,keepinventory:0,doimmediaterespawn:1};
 for(const [name,value]of Object.entries(settings)){
  const before=nbt.value[name]?.value;if(before!==value)report.metadataChanges.push({field:name,before:before??null,after:value});
  if(nbt.value[name])nbt.value[name].value=value;else nbt.value[name]={type:typeof value==='string'?8:1,value};
 }
 for(const [name,tag]of Object.entries(nbt.value.experiments?.value??{}))if(!['experiments_ever_used','saved_with_toggled_experiments'].includes(name)&&tag.value!==0){report.metadataChanges.push({field:'experiments.'+name,before:tag.value,after:0});tag.value=0;}
 const excluded=name=>name.startsWith('behavior_packs/')||name.startsWith('resource_packs/')||['level.dat','level.dat_old','levelname.txt','world_behavior_packs.json','world_resource_packs.json'].includes(name);
 const entries=[...original].filter(([name])=>!excluded(name)).map(([name,data])=>({name,data}));
 entries.push({name:'level.dat',data:writeNBT(nbt,originalMetadata.readInt32LE(0))},{name:'levelname.txt',data:Buffer.from(settings.LevelName)},
  {name:'world_behavior_packs.json',data:Buffer.from(JSON.stringify([{pack_id:bm.header.uuid,version:bm.header.version}]))},
  {name:'world_resource_packs.json',data:Buffer.from(JSON.stringify([{pack_id:rm.header.uuid,version:rm.header.version}]))});
 for(const [pack,prefix]of [[bp,'behavior_packs/ManhuntNight_BP/'],[rp,'resource_packs/ManhuntNight_RP/']])entries.push(...pack.map(e=>({name:prefix+e.name,data:e.data})));
 write(NAMES.world,writeZip(entries));outputs.unshift(NAMES.world);
 const after=readBase();assert.equal(after.size,original.size,'Base world changed during build');for(const [name,data]of original)assert(data.equals(after.get(name)),'Base input changed: '+name);
}
json('BUILD_MANIFEST.json',report);outputs.push('BUILD_MANIFEST.json');
for(const [from,to]of [['README.md','README.md'],['LICENSE','LICENSE'],['docs/INSTALL.md','INSTALL.md'],['docs/FEATURES.md','FEATURES.md'],['docs/CHANGELOG.md','CHANGELOG.md'],['docs/QA_REPORT.md','QA_REPORT.md'],['docs/FRIENDS_TEST.md','FRIENDS_TEST.md']]){
 const file=path.join(ROOT,from);if(!fs.existsSync(file)){if(!addonOnly)throw Error('Required delivery document missing: '+from);continue;}
 write(to,fs.readFileSync(file));outputs.push(to);
}
function sums(){write('SHA256SUMS.txt',outputs.map(name=>`${sha256(fs.readFileSync(path.join(dist,name)))}  ${name}`).join('\n')+'\n');}
sums();const verified=await verifyDistribution(dist,{addonOnly,bundle:false});json('PACKAGE_CHECKS.json',verified);outputs.push('PACKAGE_CHECKS.json');sums();
if(!addonOnly){
 const included=[...outputs,'SHA256SUMS.txt'];write(NAMES.bundle,writeZip(included.map(name=>({name,data:fs.readFileSync(path.join(dist,name))}))));
 write(NAMES.bundle+'.sha256',`${sha256(fs.readFileSync(path.join(dist,NAMES.bundle)))}  ${NAMES.bundle}\n`);
 await verifyDistribution(dist,{bundle:true});
}
console.log(JSON.stringify({version:VERSION,mode:addonOnly?'addon-only':'full',outputDirectory:dist,files:[...outputs,'SHA256SUMS.txt',...(addonOnly?[]:[NAMES.bundle,NAMES.bundle+'.sha256'])],baseInputUnchanged:!addonOnly},null,2));
