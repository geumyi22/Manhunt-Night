import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Public reproduction: defaults to the included sanitized QA JSONL.
// Write into a NEW output directory to preserve captured evidence.
const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const here=path.dirname(fileURLToPath(import.meta.url));
const input=path.resolve(option('--evidence')??here);
const requestedOut=option('--out');
if(!requestedOut)throw Error('Usage: node analyze-v160-metrics.mjs --out NEW_DIRECTORY [--evidence EVIDENCE_DIRECTORY] [--log PRIVATE_LOG_OR_QA_JSONL] [--closed]');
const out=path.resolve(requestedOut);
if(out===input)throw Error('Output must differ from the preserved evidence directory');
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Output directory must be empty; no evidence is overwritten');
fs.mkdirSync(out,{recursive:true});
const logPath=option('--log')??path.join(input,'tps-samples.jsonl');
const lines=fs.readFileSync(logPath,'utf8').split(/\r?\n/);
const rows=[],skipped=[];let ignoredV151Rows=0,lastSchema=null;
for(const [i,line] of lines.entries()){
  const marker=line.indexOf('[MHQA_PERF] ');const payload=marker>=0?line.slice(marker+'[MHQA_PERF] '.length).trim():line.trim().startsWith('{')?line.trim():null;if(payload===null)continue;
  try{
    const r=JSON.parse(payload);
    if(!Object.hasOwn(r,'rosterSize')){ignoredV151Rows++;lastSchema='v151';continue;}
    lastSchema='v160';
    for(const key of ['seq','elapsedMs','elapsedTicks','tps','matchSeconds','rosterSize','onlineRoster','hunters','players'])if(!Number.isFinite(r[key]))throw Error('Invalid numeric '+key);
    if(r.elapsedMs<=0||r.elapsedTicks<=0||!Number.isFinite(Date.parse(r.utc))||typeof r.practice!=='boolean')throw Error('Invalid time/practice fields');
    if(Math.abs(r.tps-r.elapsedTicks*1000/r.elapsedMs)>1e-6)throw Error('TPS/delta mismatch');
    if(!Array.isArray(r.winCounts)||!r.winCounts.every(Number.isFinite))throw Error('Unexpected winCounts schema; do not publish possible identifiers');
    rows.push(r);
  }catch(error){if(lastSchema==='v160')skipped.push({sourceLine:i+1,reason:error.message,endOfFileFragment:i===lines.length-1});}
}
fs.writeFileSync(path.join(out,'tps-samples.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
function stats(values){if(!values.length)return null;const a=values.toSorted((x,y)=>x-y);return {min:a[0],median:(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2,p95:a[Math.max(0,Math.ceil(a.length*0.95)-1)],max:a.at(-1)};}
function phaseGroup(r){return ['grace','running'].includes(r.phase)?'grace_or_running':r.phase;}
function key(r){return JSON.stringify({players:r.players,phaseCategory:phaseGroup(r),practice:r.practice,rosterSize:r.rosterSize,onlineRoster:r.onlineRoster,hunters:r.hunters});}
const groups=new Map(),excludedStarts=[],excludedTransitions=[],stateChanges=[];
for(let i=0;i<rows.length;i++){
  const r=rows[i],p=rows[i-1];
  if(!p||r.seq<=p.seq){excludedStarts.push({seq:r.seq,utc:r.utc});continue;}
  const changes=['phase','players','practice','rosterSize','onlineRoster','hunters'].filter(f=>r[f]!==p[f]);
  if(changes.length)stateChanges.push({utc:r.utc,seq:r.seq,previousSeq:p.seq,changes:Object.fromEntries(changes.map(f=>[f,{before:p[f],after:r[f]}])),previousMatchSeconds:p.matchSeconds,matchSeconds:r.matchSeconds,winCounts:r.winCounts});
  if(key(r)!==key(p)||r.seq!==p.seq+1){excludedTransitions.push({seq:r.seq,utc:r.utc});continue;}
  const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
}
const tpsGroups=[...groups].map(([k,a])=>({...JSON.parse(k),samples:a.length,firstSequence:a[0].seq,lastSequence:a.at(-1).seq,firstIntervalStartUtc:new Date(Date.parse(a[0].utc)-a[0].elapsedMs).toISOString(),lastObservationUtc:a.at(-1).utc,observedSeconds:a.reduce((s,r)=>s+r.elapsedMs,0)/1000,weightedTps:a.reduce((s,r)=>s+r.elapsedTicks,0)*1000/a.reduce((s,r)=>s+r.elapsedMs,0),intervalTps:stats(a.map(r=>r.tps))}));

const csvPath=path.join(input,'official-two-player-memory.csv'),memory=[];
if(fs.existsSync(csvPath)){
  const lines=fs.readFileSync(csvPath,'utf8').trim().split(/\r?\n/),headers=lines.shift().split(',');
  const a=lines.filter(Boolean).map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],i===0?v:v===''?null:Number(v)])));
  if(a.length){
    const first=a[0],last=a.at(-1),start=Date.parse(first.timestamp_utc),end=Date.parse(last.timestamp_utc),inside=rows.filter(r=>Date.parse(r.utc)>=start&&Date.parse(r.utc)<=end),before=rows.findLast(r=>Date.parse(r.utc)<start),observed=inside;
    const jsonPath=path.join(input,'official-two-player-memory.json'),source=fs.existsSync(jsonPath)?JSON.parse(fs.readFileSync(jsonPath,'utf8')):null;
    memory.push({sourceCsv:'official-two-player-memory.csv',completed:source!==null,samples:a.length,firstSampleUtc:first.timestamp_utc,lastSampleUtc:last.timestamp_utc,sampledSpanSeconds:(end-start)/1000,samplerElapsedSeconds:source?.elapsed_seconds??null,observedPlayerCounts:[...new Set(observed.map(r=>r.players))].sort(),observedPhases:[...new Set(observed.map(r=>r.phase))].sort(),observedPracticeValues:[...new Set(observed.map(r=>r.practice))],observedRosterSizes:[...new Set(observed.map(r=>r.rosterSize))].sort(),observedOnlineRoster:[...new Set(observed.map(r=>r.onlineRoster))].sort(),tpsObservationsInsideWindow:inside.length,nearestPriorObservationOutsideWindow:before?{seq:before.seq,utc:before.utc,phase:before.phase,rosterSize:before.rosterSize}:null,workingSetMiB:stats(a.map(r=>r.working_set_bytes/1048576)),privateBytesMiB:stats(a.map(r=>r.private_bytes/1048576)),cpuPercentMachine:stats(a.filter(r=>r.cpu_percent_machine!==null).map(r=>r.cpu_percent_machine)),timeWeightedCpuPercentMachine:100*(last.cpu_total_s-first.cpu_total_s)/(last.elapsed_s-first.elapsed_s)/(source?.logical_processors??20),attribution:'Capture-window summary, not per-phase or per-client attribution. Connected player count, online roster and phase may change during reconnect. Target is the host process only.'});
  }
}
function intervalSummary(a){return a.length?{samples:a.length,observedSeconds:a.reduce((s,r)=>s+r.elapsedMs,0)/1000,weightedTps:a.reduce((s,r)=>s+r.elapsedTicks,0)*1000/a.reduce((s,r)=>s+r.elapsedMs,0),intervalTps:stats(a.map(r=>r.tps))}:null;}
const rosterIntervals=rows.filter((r,i)=>i>0&&!r.practice&&!rows[i-1].practice&&r.rosterSize===2&&rows[i-1].rosterSize===2&&r.seq===rows[i-1].seq+1);
const throughFirstEnded=rows.filter((r,i)=>i>0&&!r.practice&&!rows[i-1].practice&&r.rosterSize===2&&rows[i-1].rosterSize===2&&rows[i-1].phase!=='ended'&&r.seq===rows[i-1].seq+1);
const slowest=rows.filter((r,i)=>i>0&&r.seq>rows[i-1].seq).toSorted((a,b)=>a.tps-b.tps).slice(0,5);
const official=rows.filter(r=>!r.practice&&r.rosterSize===2&&r.onlineRoster===2&&r.hunters===1&&['grace','running'].includes(r.phase));
const paused=rows.filter(r=>r.phase==='paused');
const loadLines=lines.filter(l=>/\[Manhunt 1\.6\.0\]/.test(l));
const summary={version:'1.6.0',sessionClosureReported:process.argv.includes('--closed'),analysisStatus:process.argv.includes('--closed')?'Post-exit snapshot; Content Log tail can remain truncated':'Interim snapshot; game session may still be running',generatedAtUtc:new Date().toISOString(),sourceLogBasename:path.basename(logPath),selection:'Only [MHQA_PERF] JSON with rosterSize field; v1.5.1 rows in shared log excluded',ignoredV151Rows,snapshotStatus:memory.length&&memory.every(w=>w.completed)?'memory capture complete; Content Log may remain buffered':'partial capture snapshot',tps:{parsedSamples:rows.length,skippedRows:skipped,startupSamplesExcluded:excludedStarts,transitionIntervalsExcluded:excludedTransitions,firstParsedUtc:rows[0]?.utc??null,lastParsedUtc:rows.at(-1)?.utc??null,formula:'sum(elapsedTicks) / (sum(elapsedMs) / 1000)',groups:tpsGroups,officialRosterIntervalsIncludingPauseAndReconnect:intervalSummary(rosterIntervals),officialMatchIntervalsThroughFirstEndedSample:intervalSummary(throughFirstEnded),inclusiveScope:'All-roster intervals include post-match ended samples. Through-first-ended summary includes pause/reconnect and the first observed ended interval, excludes later ended intervals.',slowestObservedIntervals:slowest,transitionCaveat:'State-grouped TPS excludes transitions. Also report the inclusive roster interval summary and low-rate reconnect interval; do not describe the entire run as a steady 20 TPS. Cause of stalls not established.'},officialTwoPlayerMatchObservation:{observed:official.length>0,samples:official.length,firstUtc:official[0]?.utc??null,lastUtc:official.at(-1)?.utc??null,requiredFields:{practice:false,rosterSize:2,onlineRoster:2,hunters:1},scope:'Observed engine roster/phase; not proof of every hunter gameplay feature.'},stateChanges,pausedObservations:paused.map(r=>({seq:r.seq,utc:r.utc,matchSeconds:r.matchSeconds,players:r.players,onlineRoster:r.onlineRoster,rosterSize:r.rosterSize})),memoryWindows:memory,winCountsObserved:rows.filter((r,i)=>i===0||JSON.stringify(r.winCounts)!==JSON.stringify(rows[i-1].winCounts)).map(r=>({seq:r.seq,utc:r.utc,phase:r.phase,winCounts:r.winCounts})),manhuntLoadRecords:loadLines,fps:'NOT MEASURED for v1.6.0',network:'NOT MEASURED',limitations:['Host process/engine metrics only; client B rendering and behavior reports must be recorded separately.','No v1.5.1 values are used to validate v1.6.0.','Tick/wall-clock ratio is not FPS; Date.now can be affected by clock changes.','Transition intervals excluded from grouped TPS; discontinuous valid intervals may be aggregated.','Raw sample snapshots can end before wall time due to buffered Content Log.','No performance improvement or scalability comparison is inferred.']};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
