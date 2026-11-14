import fs from 'node:fs';
import path from 'node:path';
import {memorySnapshot} from '../analyze-v160-three.mjs';

const [snapshotDirectory, outputFile, ...csvFiles] = process.argv.slice(2);
if (!snapshotDirectory || !outputFile || !csvFiles.length) throw new Error('Usage: node write-memory-windows.mjs SNAPSHOT_DIRECTORY OUTPUT_JSON CSV_FILE [CSV_FILE...]');
const summary = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, 'summary.json'), 'utf8'));
if (summary.evidenceOrigin !== 'ACTUAL_LOG_OBSERVATION') throw new Error('Actual observations required');
const rows = fs.readFileSync(path.join(snapshotDirectory, 'samples.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const timestamp100ns = timestamp => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (!match) throw new Error('Unsupported precise timestamp format');
  const millisecondsAtWholeSecond = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(millisecondsAtWholeSecond)) throw new Error('Invalid timestamp');
  return BigInt(millisecondsAtWholeSecond) * 10000n + BigInt((match[2] ?? '').padEnd(7, '0'));
};
const windows = csvFiles.map(csv => {
  const sampled = memorySnapshot(csv, rows);
  const completeRows = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/).slice(1)
    .map(line => line.split(',')).filter(values => values.length === 8 && Number.isFinite(Date.parse(values[0])));
  const exactFirst = completeRows[0]?.[0] ?? null, exactLast = completeRows.at(-1)?.[0] ?? null;
  return {sourceBasename: path.basename(csv), ...sampled,
    exactFirstSampleTimestampUtc: exactFirst, exactLastSampleTimestampUtc: exactLast,
    sampledSpanSecondsFromFullPrecisionTimestamps: exactFirst ? Number(timestamp100ns(exactLast) - timestamp100ns(exactFirst)) / 10000000 : 0};
});
const gaps = [];
for (let i = 1; i < windows.length; i++) {
  const before = windows[i - 1], after = windows[i];
  if (!before.lastSampleUtc || !after.firstSampleUtc) continue;
  const delta = (Date.parse(after.firstSampleUtc) - Date.parse(before.lastSampleUtc)) / 1000;
  if (delta < 0) throw new Error('Overlapping or out-of-order windows cannot be added as disjoint samples');
  gaps.push({beforeWindow: before.sourceBasename, afterWindow: after.sourceBasename,
    fromUtc: before.lastSampleUtc, toUtc: after.firstSampleUtc,
    gapSecondsAtMillisecondPrecision: delta,
    exactFromUtc: before.exactLastSampleTimestampUtc, exactToUtc: after.exactFirstSampleTimestampUtc,
    gapSecondsFromFullPrecisionTimestamps: Number(timestamp100ns(after.exactFirstSampleTimestampUtc) - timestamp100ns(before.exactLastSampleTimestampUtc)) / 10000000,
    gapInterpolated: false});
}
const output = {
  schema: 'MHQA_THREE_MEMORY_WINDOWS_1', generatedAtUtc: new Date().toISOString(),
  evidenceOrigin: 'ACTUAL_HOST_PROCESS_SAMPLER', captureClosureReported: summary.captureClosureReported,
  status: summary.captureClosureReported && windows.every(window => window.status === 'SAMPLER_STOPPED') ? 'CLOSED_DISJOINT_WINDOWS' : 'INTERIM_DISJOINT_WINDOWS',
  sourceLogSnapshot: path.basename(snapshotDirectory), windows, gaps,
  totalSamplesAcrossDisjointWindows: windows.reduce((sum, window) => sum + window.samples, 0),
  sumOfSampledWindowSpansSeconds: windows.reduce((sum, window) => sum + window.sampledSpanSeconds, 0),
  sumOfFullPrecisionSampledWindowSpansSeconds: windows.reduce((sum, window) => sum + window.sampledSpanSecondsFromFullPrecisionTimestamps, 0),
  fps: 'NOT MEASURED', network: 'NOT MEASURED',
  limitations: [
    'Each CSV is preserved as a separate sampling window. The gap between windows is not interpolated, and these files do not establish uninterrupted memory monitoring.',
    'Sample spans use the actual first and last sample timestamps. The sampler lifecycle duration and requested duration are different quantities.',
    'Memory and CPU belong to the whole host process. Lobby, pauses, gameplay, world reload, player-count changes, other loaded content, and background activity may share a window.',
    'No per-client or per-phase memory allocation is inferred from overlapping probe observations.',
    'Window percentiles are not averaged into a combined percentile. A performance improvement or Stable performance pass is not inferred.',
    'Numeric CSV files omit PID, account names, IP addresses, and absolute paths. Private sampler JSON metadata is not copied wholesale.'
  ]
};
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({output: path.basename(outputFile), status: output.status, windows: windows.map(window => ({file: window.sourceBasename, status: window.status, samples: window.samples})), gaps, totalSamples: output.totalSamplesAcrossDisjointWindows}));
