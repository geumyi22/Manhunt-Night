import fs from 'node:fs';
import zlib from 'node:zlib';
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const table=Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=b=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function png(pixels,size){const chunk=(name,data)=>{const n=Buffer.from(name),h=Buffer.alloc(4),c=Buffer.alloc(4);h.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([h,n,data,c]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(size);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;const rows=[];for(let y=0;y<size;y++)rows.push(Buffer.from([0]),pixels.subarray(y*size*4,(y+1)*size*4));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
const atlas=JSON.parse(fs.readFileSync('RP/textures/item_texture.json','utf8'));
// Original procedural pixel art: grey compass casing, dark dial, red/white needle.
// No Mojang bitmap is copied or redistributed.
for(let frame=0;frame<32;frame++){
 const size=16,pix=Buffer.alloc(size*size*4),a=frame*Math.PI*2/32;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const dx=x-7.5,dy=y-7.5,r=Math.hypot(dx,dy);if(r>7.1)continue;
  let color=r>6?[55,55,55]:r>5.1?(x+y<15?[219,219,219]:[132,132,132]):[41,39,40];
  const forward=dx*Math.sin(a)-dy*Math.cos(a),side=dx*Math.cos(a)+dy*Math.sin(a);
  if(Math.abs(forward)<5.1&&Math.abs(side)<1.25-Math.abs(forward)*0.18)color=forward>=0?[215,31,43]:[209,209,209];
  if(r<0.85)color=[135,135,135];pix.set([...color,255],(y*size+x)*4);
 }
 const name=`tracker_${frame}`;fs.writeFileSync(`RP/textures/items/${name}.png`,png(pix,size));
 atlas.texture_data['mh_'+name]={textures:'textures/items/'+name};
 write(`BP/items/${name}.json`,{format_version:'1.21.80','minecraft:item':{description:{identifier:'mh:'+name,menu_category:{category:'items'}},components:{'minecraft:display_name':{value:'§a§l러너 추적기§r'},'minecraft:icon':{textures:{default:'mh_'+name}},'minecraft:max_stack_size':1,'minecraft:allow_off_hand':false}}});
}
for(const [id,label,texture,component]of [['revive_totem','§a러너 부활 토템','totem','mh:revive_use'],['summon_scroll','§f헌터 소집서','paper','mh:summon_use']]){
 atlas.texture_data['mh_'+id]={textures:'textures/items/'+texture};
 write(`BP/items/${id}.json`,{format_version:'1.21.90','minecraft:item':{description:{identifier:'mh:'+id,menu_category:{category:'equipment'}},components:{'minecraft:display_name':{value:label},'minecraft:icon':{textures:{default:'mh_'+id}},'minecraft:max_stack_size':1,'minecraft:interact_button':'사용','minecraft:use_modifiers':{use_duration:0.1,movement_modifier:1},[component]:{}}}});
}
write('RP/textures/item_texture.json',atlas);
const recipe=(id,pattern,key)=>({format_version:'1.20.10','minecraft:recipe_shaped':{description:{identifier:'mh:'+id},tags:['crafting_table'],unlock:{context:'AlwaysUnlocked'},assume_symmetry:false,pattern,key,result:{item:'mh:'+id,count:1}}});
write('BP/recipes/revive_totem.json',recipe('revive_totem',['NNN','NTN','NNN'],{N:{item:'minecraft:netherite_ingot'},T:{item:'minecraft:totem_of_undying'}}));
write('BP/recipes/summon_scroll.json',recipe('summon_scroll',['PEP','ECE','PEP'],{P:{item:'minecraft:paper'},E:{item:'minecraft:ender_pearl'},C:{item:'minecraft:compass'}}));
for(const file of ['BP/manifest.json','RP/manifest.json']){const m=JSON.parse(fs.readFileSync(file,'utf8'));m.header.version=[1,5,0];m.header.min_engine_version=[1,26,62];m.header.description='Manhunt Night v1.5.0 · Bedrock 26.62 · 통합 맨헌트';m.modules.forEach(v=>v.version=[1,5,0]);for(const d of m.dependencies??[])if(d.uuid)d.version=[1,5,0];write(file,m);}
console.log('Generated 32 original compass frames, two vanilla texture references, fixed recipes and v1.5 manifests.');
