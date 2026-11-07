import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,validateStart,tracking,targetFor,outcome,clock,trackerUnlocked,TRACKER_UNLOCK_SECONDS,teammateReadout} from '../BP/scripts/core.js';
test('match sizes and roles are enforced',()=>{
 assert.equal(validateStart(['R','H1','H2'],'R'),'');assert.equal(validateStart(['R','H1','H2','H3'],'R'),'');
 for(const [n,r,p] of [[['R','H'],'R',false],[['R','H','X','Y','Z'],'R',false],[['R','H','X'],'missing',false],[['R','R','X'],'R',false],[['R','H'],'R',true]])assert.notEqual(validateStart(n,r,p),'');
 assert.equal(validateStart(['R'],'R',true),'');
});
test('compass faces the correct direction for all eight bearings and player rotation',()=>{
 const from={x:0,y:64,z:0};
 for(let i=0;i<8;i++){const yaw=i*45;const target={x:-Math.sin(yaw*Math.PI/180)*100,y:70,z:Math.cos(yaw*Math.PI/180)*100};assert.equal(tracking(from,0,target).frame,i);assert.equal(tracking(from,yaw,target).frame,0);assert.equal(tracking(from,yaw+360,target).frame,0);assert.equal(tracking(from,yaw,target).distance,100);}
 assert.equal(tracking(from,0,{x:30,y:54,z:40}).distance,50);assert.equal(tracking(from,0,{x:30,y:54,z:40}).dy,-10);
});
test('cross-dimension tracking uses departures without mixing coordinate scales',()=>{
 const runner={dimension:'end',location:{x:50,y:80,z:20}},routes={overworld:{x:800,y:64,z:160},nether:{x:100,y:70,z:20}};
 assert.deepEqual(targetFor('overworld',runner,routes),{x:800,y:64,z:160,live:false});
 assert.deepEqual(targetFor('end',runner,routes),{x:50,y:80,z:20,live:true});assert.equal(targetFor('unknown',runner,routes),null);
});
test('runner death wins simultaneous-event tie; dragon requires a surviving runner',()=>{
 assert.equal(outcome(true,true,true),'hunters');assert.equal(outcome(false,true,true),'runner');assert.equal(outcome(false,true,false),null);assert.equal(outcome(false,false,true),null);
});
test('new states are independent and default rules are stable',()=>{const a=newState(),b=newState();a.config.grace=0;assert.equal(b.config.grace,60);assert.equal(b.config.friendlyFire,false);assert.equal(b.dragonDefeated,false);assert.equal(clock(3661),'61:01');});

test('tracker unlock is exactly fifteen active minutes',()=>{
 assert.equal(TRACKER_UNLOCK_SECONDS,900);
 for(const sec of [0,1,60,899])assert.equal(trackerUnlocked(sec),false);
 for(const sec of [900,901,3600])assert.equal(trackerUnlocked(sec),true);
});

test('hunter teammate readout directional, offline and cross-dimensional without runner leak',()=>{
 const make=(name,x,z,d='minecraft:overworld')=>({name,location:{x,y:64,z},dimension:{id:d},getRotation:()=>({y:0})});
 const a=make('A',0,0),b=make('B',20,0),c=make('C',0,2,'minecraft:nether'),r=make('Runner',-8,0);
 const txt=teammateReadout(a,[a,b,c,r],['Runner','A','B','C'],'Runner',x=>x==='minecraft:nether'?'네더':x);
 assert.match(txt,/B ←20m/);assert.match(txt,/C 네더/);assert.doesNotMatch(txt,/Runner/);
 assert.match(teammateReadout(a,[a,r],['Runner','A','B'],'Runner',x=>x),/B 연결 끊김/);
 assert.equal(teammateReadout(r,[a,b,c,r],['Runner','A','B','C'],'Runner',x=>x),'');
});
