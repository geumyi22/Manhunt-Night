import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export function readNBT(buf, start=8) {
 let o=start;
 const num=(n,m)=>{const v=buf[m](o);o+=n;return v;};
 const str=()=>{const n=num(2,'readUInt16LE');const s=buf.toString('utf8',o,o+n);o+=n;return s;};
 function value(t){switch(t){
 case 1:return num(1,'readInt8');case 2:return num(2,'readInt16LE');case 3:return num(4,'readInt32LE');case 4:return num(8,'readBigInt64LE');case 5:return num(4,'readFloatLE');case 6:return num(8,'readDoubleLE');
 case 7:{const n=num(4,'readInt32LE');const v=buf.subarray(o,o+n);o+=n;return v;}
 case 8:return str();case 9:{const type=num(1,'readUInt8'),n=num(4,'readInt32LE');return {type,items:Array.from({length:n},()=>value(type))};}
 case 10:{const v={};for(;;){const type=num(1,'readUInt8');if(!type)break;const name=str();v[name]={type,value:value(type)};}return v;}
 case 11:{const n=num(4,'readInt32LE');return Array.from({length:n},()=>num(4,'readInt32LE'));}
 case 12:{const n=num(4,'readInt32LE');return Array.from({length:n},()=>num(8,'readBigInt64LE'));}
 default:throw Error('NBT type '+t);
 }}
 const type=num(1,'readUInt8'),name=str();const root={type,name,value:value(type)};if(o!==buf.length)throw Error('Trailing NBT');return root;
}
export function writeNBT(root,storageVersion=10){
 const chunks=[];const num=(n,m,v)=>{const b=Buffer.alloc(n);b[m](v);chunks.push(b);};
 const str=s=>{const b=Buffer.from(s);num(2,'writeUInt16LE',b.length);chunks.push(b);};
 function value(t,v){switch(t){
 case 1:num(1,'writeInt8',v);break;case 2:num(2,'writeInt16LE',v);break;case 3:num(4,'writeInt32LE',v);break;case 4:num(8,'writeBigInt64LE',BigInt(v));break;case 5:num(4,'writeFloatLE',v);break;case 6:num(8,'writeDoubleLE',v);break;
 case 7:num(4,'writeInt32LE',v.length);chunks.push(Buffer.from(v));break;case 8:str(v);break;
 case 9:num(1,'writeUInt8',v.type);num(4,'writeInt32LE',v.items.length);v.items.forEach(x=>value(v.type,x));break;
 case 10:for(const [k,x] of Object.entries(v)){num(1,'writeUInt8',x.type);str(k);value(x.type,x.value);}num(1,'writeUInt8',0);break;
 case 11:case 12:num(4,'writeInt32LE',v.length);v.forEach(x=>num(t===11?4:8,t===11?'writeInt32LE':'writeBigInt64LE',x));break;
 default:throw Error('NBT type '+t);
 }}
 num(1,'writeUInt8',root.type);str(root.name);value(root.type,root.value);const data=Buffer.concat(chunks),head=Buffer.alloc(8);head.writeInt32LE(storageVersion);head.writeInt32LE(data.length,4);return Buffer.concat([head,data]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2])console.log(JSON.stringify(readNBT(fs.readFileSync(process.argv[2])),(_,v)=>typeof v==='bigint'?String(v):v,2));
