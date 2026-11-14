import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Read-only QA analysis. Inputs are never modified. No game or production imports.
// node work/analyze-v160-three.mjs --log PRIVATE_LOG [--memory CSV] [--closed]
//   [--out NEW_EMPTY_DIRECTORY_UNDER_runtime-v160-three] [--synthetic-fixture]
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const phases = ['lobby', 'countdown', 'grace', 'running', 'paused', 'ended'];
const dimensions = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];
const readSources = ['live_after_production_handler', 'spawn_cache', 'unavailable_after_production_handler'];
function need(value, reason) { if (!value) throw Error(reason); }
function num(value, name, {integer = false, min = 0} = {}) {
  need(Number.isFinite(value) && value >= min && (!integer || Number.isInteger(value)), 'Invalid ' + name);
  return value;
}
const integer = (value, name, min = 0) => num(value, name, {integer: true, min});
function bool(value, name) { need(typeof value === 'boolean', 'Invalid ' + name); return value; }
function choice(value, values, name) { need(values.includes(value), 'Invalid ' + name); return value; }
function utc(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid UTC');
  return new Date(value).toISOString();
}
function position(value) {
  need(value && typeof value === 'object', 'Missing position');
  return Object.fromEntries(['x', 'y', 'z'].map(key => [key, num(value[key], 'coordinate', {min: -Infinity})]));
}
function craft(value) {
  if (value === null) return null;
  need(value && typeof value === 'object', 'Missing craft');
  return {step: integer(value.step, 'craft step'), amount: integer(value.amount, 'craft amount'),
    completion: choice(value.completion, [null, 'crafted', 'auto'], 'completion'),
    pending: choice(value.pending, [null, 'consume', 'grant'], 'pending'),
    announcedCount: integer(value.announcedCount, 'announced count'), deliveredCount: integer(value.deliveredCount, 'delivered count')};
}
function context(raw) {
  return {schema: raw.schema, seq: integer(raw.seq, 'seq', 1), utc: utc(raw.utc),
    round: integer(raw.round, 'round'), phase: choice(raw.phase, phases, 'phase'),
    matchSeconds: integer(raw.matchSeconds, 'match seconds'), rosterSize: integer(raw.rosterSize, 'roster size'),
    players: integer(raw.players, 'players')};
}
function state(raw) {
  need(raw.schema === 'MHQA_THREE_1', 'Unsupported state schema');
  const base = context(raw), c = raw.config;
  need(c && typeof c === 'object', 'Missing config');
  const config = {revealMinutes: num(c.revealMinutes, 'reveal minutes'), autoMinutes: num(c.autoMinutes, 'auto minutes'),
    autoGive: bool(c.autoGive, 'auto give'), autoPause: bool(c.autoPause, 'auto pause'),
    trackerMode: choice(c.trackerMode, ['random', 'compass', 'hud'], 'tracker mode'),
    wildBase: integer(c.wildBase, 'wild base'), wildMax: integer(c.wildMax, 'wild max'),
    summonDistance: num(c.summonDistance, 'summon distance'), summonCooldownSeconds: num(c.summonCooldownSeconds, 'summon cooldown'),
    summonMaxUses: integer(c.summonMaxUses, 'summon maximum uses')};
  need(Array.isArray(raw.members), 'Missing members');
  const members = raw.members.map(member => {
    const memberIndex = integer(member.memberIndex, 'member index');
    need(memberIndex < base.rosterSize, 'Member outside roster');
    need(Array.isArray(member.trackers), 'Missing tracker stacks');
    const trackers = member.trackers.map(item => {
      need(typeof item.id === 'string' && /^mh:tracker_([0-9]|[12][0-9]|3[01])$/.test(item.id), 'Invalid tracker ID');
      return {slot: integer(item.slot, 'slot'), id: item.id, amount: integer(item.amount, 'stack amount', 1)};
    });
    const count = integer(member.count, 'tracker count');
    need(trackers.reduce((sum, item) => sum + item.amount, 0) === count, 'Tracker count mismatch');
    need(new Set(trackers.map(item => item.slot)).size === trackers.length, 'Duplicate inventory slot');
    return {memberIndex, role: choice(member.role, ['hunter', 'runner'], 'role'),
      dimension: choice(member.dimension, dimensions, 'dimension'), location: position(member.location),
      yaw: num(member.yaw, 'yaw', {min: -Infinity}), health: member.health == null ? null : num(member.health, 'health'),
      selectedSlot: integer(member.selectedSlot, 'selected slot'), trackers, count,
      emptySlots: member.emptySlots == null ? null : integer(member.emptySlots, 'empty slots'),
      announced: bool(member.announced, 'announced'), delivered: bool(member.delivered, 'delivered'),
      craftActive: bool(member.craftActive, 'craft active')};
  });
  need(new Set(members.map(member => member.memberIndex)).size === members.length, 'Duplicate member index');
  need(members.length <= base.players, 'More roster members than connected players');
  need(Array.isArray(raw.winCounts), 'Missing wins');
  const summon = raw.summon === null ? null : {
    uses: integer(raw.summon?.uses, 'summon uses'), readyAt: num(raw.summon?.readyAt, 'summon readyAt'),
    serial: integer(raw.summon?.serial, 'summon serial'),
    transactionPhase: choice(raw.summon?.transactionPhase, [null, 'moving', 'committed', 'refund_pending', 'manual_accepted'], 'summon phase'),
    transactionParticipantCount: integer(raw.summon?.transactionParticipantCount, 'summon participants')};
  return {...base, elapsedMs: num(raw.elapsedMs, 'elapsed milliseconds', {min: Number.MIN_VALUE}),
    elapsedTicks: integer(raw.elapsedTicks, 'elapsed ticks', 1), remaining: integer(raw.remaining, 'remaining'),
    practice: bool(raw.practice, 'practice'), members, config, craft: craft(raw.craft), summon,
    runnerRespawns: integer(raw.runnerRespawns, 'runner respawns'), runnerLifeBonus: integer(raw.runnerLifeBonus, 'runner life bonus'),
    runnerRespawning: bool(raw.runnerRespawning, 'runner respawning'), winCounts: raw.winCounts.map(value => integer(value, 'win count')),
    result: choice(raw.result, ['', '러너 승리', '헌터 승리'], 'result')};
}
function drop(raw) {
  need(raw.schema === 'MHQA_THREE_DROP_1', 'Unsupported drop schema');
  const base = context(raw), memberIndex = integer(raw.memberIndex, 'drop member index', -1);
  const role = choice(raw.role, ['runner', 'hunter', 'nonparticipant'], 'drop role');
  need(role === 'nonparticipant' ? memberIndex === -1 : memberIndex >= 0 && memberIndex < base.rosterSize, 'Invalid drop participant');
  const tick = integer(raw.tick, 'tick');
  need(Array.isArray(raw.items), 'Missing dropped items');
  const items = raw.items.map(item => {
    const result = {itemIndex: integer(item.itemIndex, 'item index'), readSource: choice(item.readSource, readSources, 'read source')};
    if (result.readSource === 'unavailable_after_production_handler') return result;
    need(typeof item.id === 'string' && /^(minecraft|mh):[a-z0-9_./-]+$/.test(item.id), 'Invalid item ID');
    const bornTick = item.bornTick == null ? null : integer(item.bornTick, 'born tick');
    if (bornTick !== null) need(bornTick <= tick && tick - bornTick <= 200, 'Invalid spawn cache age');
    if (result.readSource === 'spawn_cache') need(bornTick !== null, 'Cache requires birth tick');
    return {...result, id: item.id, amount: integer(item.amount, 'dropped amount', 1), location: position(item.location),
      dimension: choice(item.dimension, dimensions, 'item dimension'), bornTick};
  });
  need(new Set(items.map(item => item.itemIndex)).size === items.length, 'Duplicate dropped item index');
  return {...base, tick, memberIndex, role, craftActive: bool(raw.craftActive, 'drop craft active'), items,
    craftAfterObserver: craft(raw.craftAfterObserver)};
}
function stats(values) {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b);
  return {min: a[0], median: (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2,
    p95: a[Math.ceil(a.length * .95) - 1], max: a.at(-1)};
}
const ref = row => row ? ({session: row.session, seq: row.seq, utc: row.utc, round: row.round, phase: row.phase,
  matchSeconds: row.matchSeconds, players: row.players, rosterSize: row.rosterSize,
  ...(row.members ? {onlineRoster: row.members.length, practice: row.practice} : {tick: row.tick, memberIndex: row.memberIndex, role: row.role})}) : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const groupKey = row => JSON.stringify({phase: row.phase, players: row.players, onlineRoster: row.members.length,
  rosterSize: row.rosterSize, practice: row.practice, round: row.round});
const bracket = (before, after) => ({before: ref(before), after: ref(after),
  wallClockBracketSeconds: before ? (Date.parse(after.utc) - Date.parse(before.utc)) / 1000 : null,
  consecutiveSamples: !!before && before.session === after.session && after.seq === before.seq + 1,
  preciseEventInstantKnown: false});
function intervalSummary(intervals) {
  if (!intervals.length) return null;
  const elapsedMs = intervals.reduce((sum, row) => sum + row.elapsedMs, 0), ticks = intervals.reduce((sum, row) => sum + row.elapsedTicks, 0);
  return {samples: intervals.length, observedSeconds: elapsedMs / 1000, totalTicks: ticks,
    weightedTps: ticks * 1000 / elapsedMs, intervalTps: stats(intervals.map(row => row.tps)),
    transitionIntervalsIncluded: intervals.filter(row => row.transition).length};
}

export function analyzeContent(content, {synthetic = false, closed = false} = {}) {
  const evidenceOrigin = synthetic ? 'SYNTHETIC_PARSER_FIXTURE_NOT_GAMEPLAY' : 'ACTUAL_LOG_OBSERVATION';
  const lines = content.split(/\r?\n/), rows = [], drops = [], errors = [], issues = [], resets = [];
  let session = 0, lastState = null, lastDrop = null, markerLines = 0, ignoredSchemas = 0;
  for (const [index, line] of lines.entries()) {
    const match = /\[(MHQA_THREE_DROP|MHQA_THREE)\]\s*/.exec(line);
    if (!match) continue;
    markerLines++;
    const kind = match[1] === 'MHQA_THREE' ? 'state' : 'drop';
    let raw;
    try { raw = JSON.parse(line.slice(match.index + match[0].length)); }
    catch { issues.push({sourceLine: index + 1, marker: match[1], kind: 'MALFORMED_JSON', endOfFileFragment: index === lines.length - 1 && !content.endsWith('\n')}); continue; }
    const schema = kind === 'state' ? 'MHQA_THREE_1' : 'MHQA_THREE_DROP_1';
    if (raw?.schema === (kind === 'state' ? 'MHQA_THREE_ERROR_1' : 'MHQA_THREE_DROP_ERROR_1')) {
      try { errors.push({evidenceOrigin, sourceLine: index + 1, sessionAtObservation: session || null, schema: raw.schema,
        utc: utc(raw.utc), tick: integer(raw.tick, 'error tick'), reason: choice(raw.reason, ['observer_read_unavailable'], 'error reason')}); }
      catch { issues.push({sourceLine: index + 1, kind: 'INVALID_OBSERVER_ERROR'}); }
      continue;
    }
    if (raw?.schema !== schema) { ignoredSchemas++; continue; }
    try {
      const value = kind === 'state' ? state(raw) : drop(raw), previous = kind === 'state' ? lastState : lastDrop;
      const reset = previous && (value.seq <= previous.seq || kind === 'drop' && value.tick < previous.tick);
      if (!session || reset) {
        session++;
        resets.push({session, sourceLine: index + 1, firstUtc: value.utc, firstStream: kind,
          reason: reset ? 'Independent stream sequence reset/duplicate or drop tick rollback; conservatively split session' : 'First accepted observation'});
        lastState = null; lastDrop = null;
      }
      const row = {evidenceOrigin, session, sourceLine: index + 1, ...value};
      if (kind === 'state') { rows.push(row); lastState = row; }
      else {
        row.precedingStateContext = lastState ? ref(lastState) : null;
        row.stateContextAgeSeconds = lastState ? (Date.parse(row.utc) - Date.parse(lastState.utc)) / 1000 : null;
        drops.push(row); lastDrop = row;
      }
    } catch (error) { issues.push({sourceLine: index + 1, kind: 'INVALID_SCHEMA', reason: error.message}); }
  }
  const intervals = [], excludedIntervals = [], phaseGroups = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], before = rows[index - 1];
    let reason = null;
    if (!before || before.session !== row.session) reason = 'First state sample of session';
    else if (row.seq !== before.seq + 1) reason = 'State sequence gap';
    else if (Date.parse(row.utc) <= Date.parse(before.utc) || Math.abs(Date.parse(row.utc) - Date.parse(before.utc) - row.elapsedMs) > 10) reason = 'UTC/elapsed interval mismatch';
    if (reason) { excludedIntervals.push({sample: ref(row), reason}); continue; }
    const interval = {session: row.session, round: row.round, seq: row.seq, elapsedMs: row.elapsedMs, elapsedTicks: row.elapsedTicks,
      tps: row.elapsedTicks * 1000 / row.elapsedMs, transition: groupKey(row) !== groupKey(before), before: ref(before), after: ref(row)};
    intervals.push(interval);
    if (!interval.transition) {
      const key = JSON.stringify({session: row.session, ...JSON.parse(groupKey(row))});
      if (!phaseGroups.has(key)) phaseGroups.set(key, []);
      phaseGroups.get(key).push(interval);
    }
  }
  const trackerObservations = [];
  for (const row of rows) {
    const runner = row.members.find(member => member.role === 'runner');
    for (const hunter of row.members.filter(member => member.role === 'hunter')) {
      let unavailableReason = null;
      if (!runner) unavailableReason = 'Runner absent from current observation';
      else if (hunter.dimension !== runner.dimension) unavailableReason = 'Cross-dimension route target is not captured';
      else if (hunter.location.x === runner.location.x && hunter.location.z === runner.location.z) unavailableReason = 'Coincident horizontal positions; directional comparison is undefined';
      else if (!['grace', 'running'].includes(row.phase)) unavailableReason = 'Not in active phase';
      else if (!(hunter.health > 0 && runner.health > 0) || row.runnerRespawning) unavailableReason = 'Dead/respawning/unknown-health participant';
      else if (!row.craft?.completion || row.craft.pending !== null || row.config.trackerMode === 'hud') unavailableReason = 'Tracker readiness/display conditions not established';
      const dx = runner ? runner.location.x - hunter.location.x : 0, dz = runner ? runner.location.z - hunter.location.z : 0;
      const relative = runner ? ((Math.atan2(-dx, dz) * 180 / Math.PI - hunter.yaw) % 360 + 360) % 360 : null;
      const expectedFrame = unavailableReason ? null : Math.round(relative / 11.25) % 32;
      const observedFrames = hunter.trackers.map(item => ({slot: item.slot, frame: Number(item.id.slice('mh:tracker_'.length)), amount: item.amount}));
      trackerObservations.push({evidenceOrigin, ...ref(row), memberIndex: hunter.memberIndex, dimension: hunter.dimension, hunterYaw: hunter.yaw,
        hunterLocation: hunter.location, runnerLocation: runner?.location ?? null, expectedFrame, unavailableReason,
        observedFrames, count: hunter.count, allObservedStacksMatchAtSnapshot: expectedFrame !== null && observedFrames.length > 0 ? observedFrames.every(item => item.frame === expectedFrame) : null,
        selectedSlot: hunter.selectedSlot, announced: hunter.announced, delivered: hunter.delivered, craftActive: hunter.craftActive});
    }
  }
  const simultaneousGroups = new Map();
  for (const event of drops) {
    const key = `${event.session}/${event.round}/${event.tick}`;
    if (!simultaneousGroups.has(key)) simultaneousGroups.set(key, []);
    simultaneousGroups.get(key).push(event);
  }
  const sameTickDistinctHunterGroups = [...simultaneousGroups.values()].filter(events => new Set(events.filter(event => event.role === 'hunter').map(event => event.memberIndex)).size >= 2).map(events => ({
    evidenceOrigin, session: events[0].session, round: events[0].round, tick: events[0].tick,
    distinctHunterMembers: [...new Set(events.filter(event => event.role === 'hunter').map(event => event.memberIndex))],
    events: events.map(event => ({...ref(event), items: event.items, craftActiveAfterProductionHandler: event.craftActive, craftAfterObserver: event.craftAfterObserver})),
    eventTimingEvidence: synthetic ? 'Synthetic parser fixture only; no gameplay timing claim.' : 'Actual entityItemDrop callbacks report the identical engine tick; no timing is inferred from periodic state samples.',
    consumptionSuccessProvenByTheseEventsAlone: false,
    allEventsHaveRecentOfficialThreeMemberStateContext: events.every(event => event.precedingStateContext?.round === event.round && event.precedingStateContext?.rosterSize === 3 && event.precedingStateContext?.practice === false && event.rosterSize === 3 && event.stateContextAgeSeconds >= 0 && event.stateContextAgeSeconds <= 10)
  }));
  const matches = [];
  for (const key of new Set(rows.filter(row => row.rosterSize > 0).map(row => `${row.session}/${row.round}`))) {
    const matchRows = rows.filter(row => `${row.session}/${row.round}` === key), first = matchRows[0], last = matchRows.at(-1);
    const craftTransitions = [], summonTransitions = [], phaseTransitions = [], inventoryTransitions = [];
    for (let index = 1; index < matchRows.length; index++) {
      const row = matchRows[index], before = matchRows[index - 1];
      if (!same(row.craft, before.craft)) craftTransitions.push({...bracket(before, row), beforeCraft: before.craft, afterCraft: row.craft});
      if (!same(row.summon, before.summon)) summonTransitions.push({...bracket(before, row), beforeSummon: before.summon, afterSummon: row.summon,
        observedUsesIncrease: !!row.summon && !!before.summon && row.summon.uses > before.summon.uses,
        participantPositionsBefore: before.members.map(member => ({memberIndex: member.memberIndex, role: member.role, dimension: member.dimension, location: member.location})),
        participantPositionsAfter: row.members.map(member => ({memberIndex: member.memberIndex, role: member.role, dimension: member.dimension, location: member.location})),
        activationAndTeleportSuccessClaimed: false});
      if (groupKey(row) !== groupKey(before)) phaseTransitions.push(bracket(before, row));
      for (const member of row.members) {
        const old = before.members.find(candidate => candidate.memberIndex === member.memberIndex);
        if (old && (member.count !== old.count || member.delivered !== old.delivered || member.announced !== old.announced)) inventoryTransitions.push({...bracket(before, row), memberIndex: member.memberIndex, role: member.role,
          beforeInventory: {count: old.count, delivered: old.delivered, announced: old.announced}, afterInventory: {count: member.count, delivered: member.delivered, announced: member.announced}});
      }
    }
    const enrollment = matchRows.filter(row => !row.practice && row.rosterSize === 3 && row.members.length === 3 && row.members.filter(member => member.role === 'hunter').length === 2 && row.members.filter(member => member.role === 'runner').length === 1);
    const hunterSummaries = [...new Set(matchRows.flatMap(row => row.members.filter(member => member.role === 'hunter').map(member => member.memberIndex)))].map(memberIndex => {
      const observations = trackerObservations.filter(item => item.session === first.session && item.round === first.round && item.memberIndex === memberIndex);
      return {memberIndex, samples: observations.length, trackerCount: stats(observations.map(item => item.count)),
        distinctExpectedFrames: [...new Set(observations.filter(item => item.expectedFrame !== null).map(item => item.expectedFrame))],
        distinctObservedFrames: [...new Set(observations.flatMap(item => item.observedFrames.map(stack => stack.frame)))],
        comparableSnapshots: observations.filter(item => item.allObservedStacksMatchAtSnapshot !== null).length,
        matchingSnapshots: observations.filter(item => item.allObservedStacksMatchAtSnapshot === true).length,
        differingSnapshots: observations.filter(item => item.allObservedStacksMatchAtSnapshot === false).length,
        interpretation: 'Snapshot correspondence only. Two-tick display updates, movement, feature flags not captured, and rendering are not proved by this comparison.'};
    });
    const distinctCorrectFrames = matchRows.filter(row => {
      const hunters = trackerObservations.filter(item => item.session === row.session && item.seq === row.seq && item.allObservedStacksMatchAtSnapshot === true);
      return hunters.length >= 2 && new Set(hunters.map(item => item.expectedFrame)).size >= 2;
    });
    const matchIntervals = intervals.filter(item => item.session === first.session && item.round === first.round && item.before.round === first.round);
    matches.push({session: first.session, round: first.round, first: ref(first), last: ref(last),
      observedPracticeValues: [...new Set(matchRows.map(row => row.practice))], observedRosterSizes: [...new Set(matchRows.map(row => row.rosterSize))],
      observedConnectedPlayers: [...new Set(matchRows.map(row => row.players))], observedOnlineRoster: [...new Set(matchRows.map(row => row.members.length))],
      threeMemberOfficialRosterWithTwoHuntersObserved: enrollment.length > 0,
      firstThreeOnlineOfficialRoster: ref(enrollment[0]), firstThreeOnlineOfficialRunning: ref(enrollment.find(row => row.phase === 'running')),
      connectedThreeButRosterTwoSamples: matchRows.filter(row => row.players === 3 && row.rosterSize === 2).length,
      phaseTransitions, craftTransitions, summonTransitions, inventoryTransitions, hunterSummaries,
      distinctPerHunterExpectedAndMatchingFramesAtSameSnapshot: distinctCorrectFrames.map(ref),
      observedSummonTransactionPhases: [...new Set(matchRows.map(row => row.summon?.transactionPhase ?? null))],
      observedMatchEnd: ref(matchRows.find(row => row.phase === 'ended')),
      tpsIncludingPauseAndConnectionTransitions: intervalSummary(matchIntervals)});
  }
  const summary = {
    schema: 'MHQA_THREE_ANALYSIS_1', version: '1.6.0', evidenceOrigin, generatedAtUtc: new Date().toISOString(),
    captureClosureReported: closed, snapshotStatus: synthetic ? 'SYNTHETIC_PARSER_VALIDATION_ONLY' : closed ? 'POST_CAPTURE_SNAPSHOT; buffered tail remains possible' : 'INTERIM_SNAPSHOT',
    sourceLogSha256: sha(content), sourceBytes: Buffer.byteLength(content),
    selection: {markers: ['[MHQA_THREE]', '[MHQA_THREE_DROP]'], markerLines, stateRows: rows.length, dropRows: drops.length,
      observerErrors: errors.length, ignoredSchemas, malformedOrInvalidRows: issues},
    sessions: resets.map(reset => ({...reset, stateSamples: rows.filter(row => row.session === reset.session).length, dropEvents: drops.filter(row => row.session === reset.session).length,
      lastState: ref(rows.filter(row => row.session === reset.session).at(-1))})), matches,
    dropEvidence: {events: drops.length, itemReadSources: Object.fromEntries(readSources.map(source => [source, drops.reduce((sum, row) => sum + row.items.filter(item => item.readSource === source).length, 0)])),
      sameTickDistinctHunterGroups, sameTickDistinctHunterEventGroupCount: sameTickDistinctHunterGroups.length,
      eventRowKind: 'entityItemDrop callback observations; never inferred from periodic state changes',
      actualCallbackEvidencePresent: !synthetic && drops.length > 0, dropEventsAloneProveConsumedAmounts: false},
    tps: {formula: 'sum(elapsedTicks) * 1000 / sum(elapsedMs)', overallIncludingPauseAndTransitions: intervalSummary(intervals),
      phaseAndConnectedPlayerGroups: [...phaseGroups].map(([key, values]) => ({...JSON.parse(key), ...intervalSummary(values)})),
      transitionIntervals: intervals.filter(item => item.transition), excludedIntervals,
      slowestIntervals: [...intervals].sort((a, b) => a.tps - b.tps).slice(0, 10)},
    memory: {status: 'NOT_SUPPLIED'}, fps: 'NOT MEASURED', network: 'NOT MEASURED',
    limitations: [
      'Only explicit numeric/boolean/enumerated QA fields are copied. Player names, arbitrary strings, absolute log paths, IPs and unrelated raw log text are excluded.',
      'Periodic states are observed every 100 engine ticks, nominally five seconds. State-change brackets do not establish exact event timing.',
      'State and drop sequence counters are independent. A reset in either stream conservatively starts a new session and resets both counters. A drop before the first post-reload state may have ambiguous linkage; context linkage is not independently proven.',
      'Three connected clients do not establish a three-member match. Official roster, online roster, practice flag and two-hunter/one-runner roles are reported separately.',
      'Same-tick claims require actual drop event rows from distinct hunters in the same session and round. Periodic state changes are never converted into synthetic drop events.',
      'The drop observer is registered after production handlers. live_after_production_handler is a post-handler entity read; spawn_cache describes spawn-time fields; unavailable has an undetermined cause.',
      'craftActive and craftAfterObserver are post-handler state. Successful final crafting may clear craftActive. An unavailable dropped entity is not proof of item loss or successful consumption.',
      'No entity identity/token is retained; dropped item deduplication and precise consumed amounts cannot be established from the observer alone.',
      'Tracker frame math is compared only for observed same-dimension active living participants with ready inventory state. Cross-dimension routes are not captured. Snapshot mismatches alone are not classified as defects.',
      'Per-hunter item IDs do not prove visual rendering. Full feature flags, input timing and camera views are outside this observer.',
      'Summon state increments and location changes are observations, not independent proof of the initiating action or full teleport success.',
      'Overall TPS includes pause and transition intervals; grouped TPS excludes transitions. Startup/gap/mismatched intervals are excluded with reasons. Tick rate is not FPS.',
      'A missing event in a buffered or partial log does not prove it never happened. Analysis completion is not Stable QA completion.'
    ]
  };
  return {rows, drops, errors, trackerObservations, summary};
}

export function memorySnapshot(csvPath, rows) {
  const bytes = fs.readFileSync(csvPath), csv = bytes.toString('utf8');
  if (!csv.trim()) return {sourceSha256: sha(bytes), status: 'RUNNING_OR_EMPTY_FILE', samples: 0, invalidRows: [], attribution: 'No complete memory samples are present; no metric inferred.'};
  const lines = csv.trimEnd().split(/\r?\n/);
  const fields = ['timestamp_utc', 'elapsed_s', 'working_set_bytes', 'private_bytes', 'cpu_total_s', 'cpu_percent_one_core', 'cpu_percent_machine', 'interval_s'];
  const header = lines.shift()?.replace(/^\ufeff/, '');
  if (header !== fields.join(',') && lines.length === 0 && !csv.endsWith('\n') && fields.join(',').startsWith(header)) {
    return {sourceSha256: sha(bytes), status: 'RUNNING_OR_INCOMPLETE_HEADER', samples: 0,
      invalidRows: [{sourceLine: 1, reason: 'Incomplete expected CSV header'}], attribution: 'No complete memory samples are present; no metric inferred.'};
  }
  need(same(header?.split(','), fields), 'Unsupported memory CSV header');
  const samples = [], invalidRows = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const values = line.split(','); need(values.length === fields.length, 'Incomplete memory row');
      const sample = Object.fromEntries(fields.map((field, i) => [field, i === 0 ? utc(values[i]) : values[i] === '' ? null : num(Number(values[i]), 'memory value')]));
      need(fields.filter(field => !field.startsWith('cpu_percent') && field !== 'timestamp_utc').every(field => sample[field] !== null), 'Missing memory value');
      samples.push(sample);
    } catch { invalidRows.push({sourceLine: index + 2, reason: 'Malformed/incomplete memory row'}); }
  }
  const first = samples[0], last = samples.at(-1), weighted = samples.filter(row => row.cpu_percent_machine !== null && row.interval_s > 0);
  const duration = weighted.reduce((sum, row) => sum + row.interval_s, 0);
  const jsonPath = csvPath.replace(/\.csv$/i, '.json'); let stopped = false, stopReason = null;
  if (jsonPath !== csvPath && fs.existsSync(jsonPath)) {
    try { const original = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); stopped = true;
      stopReason = ['duration_reached', 'stop_requested', 'process_exited'].includes(original.stop_reason) ? original.stop_reason : 'Other or unavailable reason; private raw text omitted';
    } catch { invalidRows.push({reason: 'Sampler JSON incomplete'}); }
  }
  const overlapping = first ? rows.filter(row => Date.parse(row.utc) >= Date.parse(first.timestamp_utc) && Date.parse(row.utc) <= Date.parse(last.timestamp_utc)) : [];
  return {sourceSha256: sha(bytes), status: stopped ? 'SAMPLER_STOPPED' : 'RUNNING_OR_SUMMARY_NOT_YET_WRITTEN', stopReason,
    samples: samples.length, invalidRows, firstSampleUtc: first?.timestamp_utc ?? null, lastSampleUtc: last?.timestamp_utc ?? null,
    sampledSpanSeconds: first ? (Date.parse(last.timestamp_utc) - Date.parse(first.timestamp_utc)) / 1000 : 0,
    workingSetMiB: stats(samples.map(row => row.working_set_bytes / 1048576)), privateBytesMiB: stats(samples.map(row => row.private_bytes / 1048576)),
    cpuPercentMachine: stats(weighted.map(row => row.cpu_percent_machine)), timeWeightedCpuPercentMachine: duration ? weighted.reduce((sum, row) => sum + row.cpu_percent_machine * row.interval_s, 0) / duration : null,
    observedPhaseAndPlayerGroups: [...new Set(overlapping.map(groupKey))].map(JSON.parse),
    attribution: 'Whole host process, mixed sampled phases/player counts. No per-phase allocation, peer-client memory, FPS or network inference.'};
}

function main() {
  const args = process.argv.slice(2), value = name => {
    const index = args.indexOf(name); if (index < 0) return undefined;
    need(args[index + 1] && !args[index + 1].startsWith('--'), 'Missing argument for ' + name); return args[index + 1];
  };
  const log = value('--log'); need(log, 'Required: --log PRIVATE_CONTENT_LOG');
  const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, 'runtime-v160-three');
  const synthetic = args.includes('--synthetic-fixture');
  const out = path.resolve(value('--out') ?? path.join(root, (synthetic ? 'synthetic-analysis-' : 'analysis-') + new Date().toISOString().replace(/[:.]/g, '-')));
  const relative = path.relative(root, out);
  need(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Output must be a new subdirectory under runtime-v160-three');
  need(!fs.existsSync(out) || fs.readdirSync(out).length === 0, 'Output must be empty; previous evidence is preserved');
  const memory = value('--memory');
  need(![log, memory].filter(Boolean).map(file => path.resolve(file)).some(file => file === out || file.startsWith(out + path.sep)), 'Output must not contain an input file');
  const result = analyzeContent(fs.readFileSync(log, 'utf8'), {synthetic, closed: args.includes('--closed')});
  if (memory) result.summary.memory = memorySnapshot(memory, result.rows);
  fs.mkdirSync(out, {recursive: true});
  const files = [['samples.jsonl', result.rows], ['drop-events.jsonl', result.drops], ['observer-errors.jsonl', result.errors], ['tracker-observations.jsonl', result.trackerObservations]];
  for (const [file, rows] of files) fs.writeFileSync(path.join(out, file), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result.summary, null, 2) + '\n');
  const names = [...files.map(([file]) => file), 'summary.json'];
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), names.map(file => `${sha(fs.readFileSync(path.join(out, file)))}  ${file}`).join('\n') + '\n');
  console.log(JSON.stringify({outputDirectory: path.relative(here, out).replaceAll('\\', '/'), evidenceOrigin: result.summary.evidenceOrigin,
    stateRows: result.rows.length, dropEvents: result.drops.length, issues: result.summary.selection.malformedOrInvalidRows.length,
    sessions: result.summary.sessions.length, threeMemberOfficialRosterObserved: result.summary.matches.some(match => match.threeMemberOfficialRosterWithTwoHuntersObserved),
    sameTickDistinctHunterEventGroups: result.summary.dropEvidence.sameTickDistinctHunterEventGroupCount, memoryStatus: result.summary.memory.status}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
