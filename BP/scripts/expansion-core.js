export const RECEIVER='mh:receiver';
export const FORTRESSES=[{x:-288,z:-256},{x:144,z:-448},{x:352,z:96}];
export function newExtra(){return {runnerNether:false,fortressEntered:false,hintSent:false,hintReason:'',endReward:false,receiverReady:0,safe:{}};}
export function inBounds(p,dimension){const half=dimension==='minecraft:nether'?625:5000;return p.x>=-half&&p.x<half&&p.z>=-half&&p.z<half;}
export function closestFortress(p,dimension){const scale=dimension==='minecraft:overworld'?8:1;return FORTRESSES.reduce((a,b)=>Math.hypot(a.x-p.x/scale,a.z-p.z/scale)<Math.hypot(b.x-p.x/scale,b.z-p.z/scale)?a:b);}
export function hintReason(extra,seconds){if(extra.hintSent)return '';if(extra.hintReason)return extra.hintReason;return seconds>=2400&&!extra.fortressEntered?'40분 동안 요새에 도착하지 못했습니다.':'';}
