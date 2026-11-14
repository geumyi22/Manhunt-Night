import fs from 'node:fs';
import path from 'node:path';

const [snapshotDirectory, memoryWindowsFile, outputFile] = process.argv.slice(2);
if (!snapshotDirectory || !memoryWindowsFile || !outputFile) throw new Error('Usage: node write-measurement-summary.mjs SNAPSHOT_DIRECTORY MEMORY_WINDOWS_JSON OUTPUT_JSON');
const summary = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, 'summary.json'), 'utf8'));
const memory = JSON.parse(fs.readFileSync(memoryWindowsFile, 'utf8'));
if (summary.evidenceOrigin !== 'ACTUAL_LOG_OBSERVATION') throw new Error('Actual observations required');
const groups = summary.tps.phaseAndConnectedPlayerGroups.filter(group => group.practice === false && group.rosterSize === 3 && group.players === 3 && group.onlineRoster === 3 && ['grace', 'running'].includes(group.phase));
const seconds = groups.reduce((sum, group) => sum + group.observedSeconds, 0);
const ticks = groups.reduce((sum, group) => sum + group.totalTicks, 0);
const artifact = {
  schema: 'MHQA_THREE_MEASUREMENT_SUMMARY_1', generatedAtUtc: new Date().toISOString(),
  evidenceOrigin: 'ACTUAL_QA_PROBE_AND_HOST_PROCESS_MEASUREMENTS',
  status: summary.captureClosureReported && memory.status === 'CLOSED_DISJOINT_WINDOWS' ? 'CLOSED_MEASUREMENTS' : 'INTERIM_MEASUREMENTS',
  sourceSnapshot: path.basename(snapshotDirectory), sourceLogSha256: summary.sourceLogSha256,
  acceptedPeriodicRows: summary.selection.stateRows, acceptedDropEvents: summary.selection.dropRows,
  sessionCount: summary.sessions.length, malformedOrInvalidRows: summary.selection.malformedOrInvalidRows,
  overallTpsIncludingPauseAndTransitions: summary.tps.overallIncludingPauseAndTransitions,
  activeThreePlayerGameplayTps: {
    selection: 'Both interval endpoint states have the same session, round, grace/running phase, three connected clients, three online enrolled participants, roster size three, and practice=false. Phase/player-count/roster transitions and session gaps are excluded by the source analyzer grouping; configuration changes are not an additional exclusion filter.',
    groups, intervals: groups.reduce((sum, group) => sum + group.samples, 0),
    observedSeconds: seconds, totalTicks: ticks, weightedTps: seconds > 0 ? ticks / seconds : null,
    minimumObservedIntervalTps: groups.length ? Math.min(...groups.map(group => group.intervalTps.min)) : null,
    maximumObservedIntervalTps: groups.length ? Math.max(...groups.map(group => group.intervalTps.max)) : null,
    pooledPercentileCalculated: false
  },
  excludedIntervalCount: summary.tps.excludedIntervals.length,
  memoryWindowsFile: path.basename(memoryWindowsFile),
  memoryWindows: memory.windows.map(window => ({sourceBasename: window.sourceBasename, status: window.status, stopReason: window.stopReason,
    samples: window.samples, firstSampleUtc: window.firstSampleUtc, lastSampleUtc: window.lastSampleUtc,
    exactFirstSampleTimestampUtc: window.exactFirstSampleTimestampUtc, exactLastSampleTimestampUtc: window.exactLastSampleTimestampUtc,
    sampledSpanSecondsFromFullPrecisionTimestamps: window.sampledSpanSecondsFromFullPrecisionTimestamps,
    sampledSpanSeconds: window.sampledSpanSeconds, workingSetMiB: window.workingSetMiB,
    privateBytesMiB: window.privateBytesMiB, timeWeightedCpuPercentMachine: window.timeWeightedCpuPercentMachine})),
  totalMemorySamplesAcrossDisjointWindows: memory.totalSamplesAcrossDisjointWindows, memoryGaps: memory.gaps,
  fps: 'NOT MEASURED', network: 'NOT MEASURED', noStablePerformancePassClaimed: true,
  limits: [
    'TPS is engine tick progression divided by wall-clock time in a QA-instrumented world copy. It is not rendered FPS or peer frame-time measurement.',
    'The overall number includes lobby, pause, ended states, and transitions; active three-player gameplay is reported separately and is a sum across two rounds, not one uninterrupted match.',
    'The temporary settings were reveal two minutes, auto grant eight minutes, and summon cooldown thirty seconds during the trials, restored later to twenty/forty minutes and three hundred seconds. This is distinct from the earlier default-settings LONG trial.',
    'Teleport commands, supplied materials/equipment, effects, and an operator command triggering dragon death are part of the controlled test fixture. This is not an unassisted survival playthrough.',
    'Whole-host process memory and CPU include mixed phases and player counts. There is no peer-device memory measurement and no per-phase resource allocation.',
    'The memory windows contain an explicitly reported gap. No missing samples are interpolated, and no performance improvement comparison is made.',
    'Averages and minima describe only observed intervals. Missing FPS and network measurements remain limitations; no Stable approval is inferred.'
  ]
};
fs.writeFileSync(outputFile, JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({output: path.basename(outputFile), status: artifact.status, acceptedRows: artifact.acceptedPeriodicRows,
  overallTps: artifact.overallTpsIncludingPauseAndTransitions.weightedTps, activeThreePlayerTps: artifact.activeThreePlayerGameplayTps.weightedTps,
  activeSeconds: seconds, totalMemorySamples: artifact.totalMemorySamplesAcrossDisjointWindows}));
