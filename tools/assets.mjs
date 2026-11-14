import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const table=Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=b=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function png(pixels,size){const chunk=(name,data)=>{const n=Buffer.from(name),h=Buffer.alloc(4),c=Buffer.alloc(4);h.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([h,n,data,c]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(size);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;const rows=[];for(let y=0;y<size;y++)rows.push(Buffer.from([0]),pixels.subarray(y*size*4,(y+1)*size*4));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
function vanillaCompass(){
 const root='tools/vendor/vanilla-compass/',source=JSON.parse(fs.readFileSync(root+'SOURCE.json','utf8')),bytes=fs.readFileSync(root+'compass_atlas.png');
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.files.find(v=>v.file==='compass_atlas.png').sha256,'Vanilla compass source hash mismatch');
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const parts=[];let width,height;
 for(let offset=8;offset<bytes.length;){const length=bytes.readUInt32BE(offset),name=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);offset+=length+12;
  if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.deepEqual([...data.subarray(8)],[8,6,0,0,0],'Expected non-interlaced RGBA8 source');}
  if(name==='IDAT')parts.push(data);
 }
 assert.equal(width,16);assert.equal(height,512);
 const raw=zlib.inflateSync(Buffer.concat(parts)),stride=width*4,pixels=Buffer.alloc(width*height*4);assert.equal(raw.length,height*(stride+1));
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)];assert(filter<=4,'Unsupported PNG row filter');
  for(let x=0;x<stride;x++){
   const index=y*stride+x,left=x>=4?pixels[index-4]:0,up=y?pixels[index-stride]:0,corner=x>=4&&y?pixels[index-stride-4]:0;
   const estimate=left+up-corner,dl=Math.abs(estimate-left),du=Math.abs(estimate-up),dc=Math.abs(estimate-corner);
   const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):dl<=du&&dl<=dc?left:du<=dc?up:corner;
   pixels[index]=(raw[y*(stride+1)+1+x]+predictor)&255;
  }
 }
 return pixels;
}
const atlas=JSON.parse(fs.readFileSync('RP/textures/item_texture.json','utf8'));
const compass=vanillaCompass();
// Preserve Mojang's exact pixels; its atlas starts pointing down, while logical
// frame zero points up. See tools/vendor/vanilla-compass/NOTICE.md for terms.
for(let frame=0;frame<32;frame++){
 const size=16,sourceFrame=(frame+16)%32,pix=compass.subarray(sourceFrame*size*size*4,(sourceFrame+1)*size*size*4);
 const name=`tracker_${frame}`;fs.writeFileSync(`RP/textures/items/${name}.png`,png(pix,size));
 atlas.texture_data['mh_'+name]={textures:'textures/items/'+name};
 write(`BP/items/${name}.json`,{format_version:'1.21.80','minecraft:item':{description:{identifier:'mh:'+name,menu_category:{category:'items'}},components:{'minecraft:display_name':{value:'§a§l러너 추적기§r'},'minecraft:icon':{textures:{default:'mh_'+name}},'minecraft:max_stack_size':1,'minecraft:allow_off_hand':false}}});
}
fs.copyFileSync('tools/vendor/vanilla-compass/NOTICE.md','RP/NOTICE.md');
for(const [id,label,texture,component]of [['revive_totem','§a러너 부활 토템','totem','mh:revive_use'],['summon_scroll','§f헌터 소집서','paper','mh:summon_use']]){
 atlas.texture_data['mh_'+id]={textures:'textures/items/'+texture};
 write(`BP/items/${id}.json`,{format_version:'1.21.90','minecraft:item':{description:{identifier:'mh:'+id,menu_category:{category:'equipment'}},components:{'minecraft:display_name':{value:label},'minecraft:icon':{textures:{default:'mh_'+id}},'minecraft:max_stack_size':1,'minecraft:interact_button':'사용','minecraft:use_modifiers':{use_duration:0.1,movement_modifier:1},[component]:{}}}});
}
write('RP/textures/item_texture.json',atlas);
const recipe=(id,pattern,key)=>({format_version:'1.20.10','minecraft:recipe_shaped':{description:{identifier:'mh:'+id},tags:['crafting_table'],unlock:{context:'AlwaysUnlocked'},assume_symmetry:false,pattern,key,result:{item:'mh:'+id,count:1}}});
write('BP/recipes/revive_totem.json',recipe('revive_totem',['NNN','NTN','NNN'],{N:{item:'minecraft:netherite_ingot'},T:{item:'minecraft:totem_of_undying'}}));
write('BP/recipes/summon_scroll.json',recipe('summon_scroll',['PEP','ECE','PEP'],{P:{item:'minecraft:paper'},E:{item:'minecraft:ender_pearl'},C:{item:'minecraft:compass'}}));
for(const file of ['BP/manifest.json','RP/manifest.json']){const m=JSON.parse(fs.readFileSync(file,'utf8'));m.header.version=[1,6,0];m.header.min_engine_version=[1,26,62];m.header.description='Manhunt Night v1.6.0 · Bedrock 26.62 · 2~8인 맨헌트';m.modules.forEach(v=>v.version=[1,6,0]);for(const d of m.dependencies??[])if(d.uuid)d.version=[1,6,0];write(file,m);}
console.log('Extracted 32 Mojang compass cells (28 distinct images), copied texture notice, and generated item definitions and manifests.');
