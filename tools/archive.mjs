import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const table=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function validName(name){return typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').some(x=>x==='..'||x==='.');}
export function collectFiles(dir,prefix=''){
 const entries=[];for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(['node_modules','.git','dist','build','coverage'].includes(e.name))continue;
  const full=path.join(dir,e.name),name=prefix+e.name;
  if(e.isSymbolicLink())throw Error('Symbolic links are not packaged: '+name);
  if(e.isDirectory())entries.push(...collectFiles(full,name+'/'));else if(e.isFile())entries.push({name,data:fs.readFileSync(full)});
 }return entries;
}
export function writeZip(entries){
 const locals=[],central=[],names=new Set();let offset=0;
 for(const entry of [...entries].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  assert(validName(entry.name)&&!names.has(entry.name),'Unsafe or duplicate archive name: '+entry.name);names.add(entry.name);
  const n=Buffer.from(entry.name),data=Buffer.from(entry.data),packed=zlib.deflateRawSync(data,{level:9}),checksum=crc32(data);
  assert(n.length<=65535&&packed.length<=0xffffffff&&data.length<=0xffffffff,'ZIP64 is not supported');
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(checksum,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);locals.push(h,n,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(checksum,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+packed.length;
 }
 assert(entries.length<=65535&&offset<=0xffffffff,'ZIP64 is not supported');
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
export function readZip(bytes,{maxBytes=1024*1024*1024}={}){
 const buf=Buffer.from(bytes);let eocd=-1;
 for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50&&i+22+buf.readUInt16LE(i+20)===buf.length){eocd=i;break;}
 assert(eocd>=0,'ZIP end directory missing');assert.equal(buf.readUInt16LE(eocd+4),0,'Split ZIP unsupported');assert.equal(buf.readUInt16LE(eocd+6),0);
 const count=buf.readUInt16LE(eocd+10);assert.equal(count,buf.readUInt16LE(eocd+8));assert(count<65535,'ZIP64 unsupported');
 let p=buf.readUInt32LE(eocd+16),total=0;const end=p+buf.readUInt32LE(eocd+12),entries=new Map();assert(end<=eocd);
 for(let i=0;i<count;i++){
  assert.equal(buf.readUInt32LE(p),0x02014b50);const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),checksum=buf.readUInt32LE(p+16),packedSize=buf.readUInt32LE(p+20),size=buf.readUInt32LE(p+24),n=buf.readUInt16LE(p+28),extra=buf.readUInt16LE(p+30),comment=buf.readUInt16LE(p+32),offset=buf.readUInt32LE(p+42);
  const name=buf.toString('utf8',p+46,p+46+n);assert(validName(name)&&!entries.has(name),'Unsafe or duplicate ZIP name: '+name);assert(!(flags&1),'Encrypted ZIP unsupported');assert([0,8].includes(method),'ZIP compression unsupported');assert(size<0xffffffff&&packedSize<0xffffffff&&offset<0xffffffff,'ZIP64 unsupported');
  assert.equal(buf.readUInt32LE(offset),0x04034b50);const localNameLength=buf.readUInt16LE(offset+26),localExtra=buf.readUInt16LE(offset+28),start=offset+30+localNameLength+localExtra;assert.equal(buf.toString('utf8',offset+30,offset+30+localNameLength),name);assert(start+packedSize<=buf.readUInt32LE(eocd+16));
  total+=size;assert(total<=maxBytes,'Archive exceeds uncompressed limit');
  const packed=buf.subarray(start,start+packedSize),data=method===8?zlib.inflateRawSync(packed,{maxOutputLength:Math.max(1,size)}):packed;assert.equal(data.length,size);assert.equal(crc32(data),checksum,'CRC mismatch: '+name);
  if(!name.endsWith('/'))entries.set(name,data);p+=46+n+extra+comment;
 }assert.equal(p,end,'ZIP central directory size mismatch');return entries;
}
