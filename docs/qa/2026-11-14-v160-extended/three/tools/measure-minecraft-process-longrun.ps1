param(
    [Parameter(Mandatory=$true)][int]$TargetPid,
    [Parameter(Mandatory=$true)][string]$OutputPrefix,
    [ValidateRange(2,14400)][int]$DurationSeconds = 2700,
    [ValidateRange(100,10000)][int]$IntervalMs = 2000,
    [string]$Scenario = 'Unspecified actual-client long-run scenario',
    [string]$StopFile
)
$ErrorActionPreference = 'Stop'
if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { throw 'Stop signal already exists; use a new StopFile path.' }
$prefix = [System.IO.Path]::GetFullPath($OutputPrefix)
$csvPath = $prefix + '.csv'
$summaryPath = $prefix + '.json'
if ((Test-Path -LiteralPath $csvPath) -or (Test-Path -LiteralPath $summaryPath)) { throw 'Output already exists; choose a new prefix to preserve evidence.' }
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($prefix)) | Out-Null
$targetProcess = Get-Process -Id $TargetPid
$processName = $targetProcess.ProcessName
$processStartedUtc = $targetProcess.StartTime.ToUniversalTime().ToString('o')
$logicalProcessors = [Environment]::ProcessorCount
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$rows = [System.Collections.Generic.List[object]]::new()
$writer = [System.IO.StreamWriter]::new($csvPath, $false, [System.Text.UTF8Encoding]::new($false))
$writer.WriteLine('timestamp_utc,elapsed_s,working_set_bytes,private_bytes,cpu_total_s,cpu_percent_one_core,cpu_percent_machine,interval_s')
$previousCpu = $null
$previousElapsed = $null
$stopReason = 'duration_reached'
try {
    while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
        if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { $stopReason = 'stop_requested'; break }
        try {
            $targetProcess.Refresh()
            if ($targetProcess.HasExited) { $stopReason = 'process_exited'; break }
            $elapsed = $clock.Elapsed.TotalSeconds
            $cpu = $targetProcess.TotalProcessorTime.TotalSeconds
            $interval = if ($null -eq $previousElapsed) { 0.0 } else { $elapsed - $previousElapsed }
            $cpuOneCore = if ($interval -gt 0) { 100.0 * ($cpu - $previousCpu) / $interval } else { $null }
            $cpuMachine = if ($null -ne $cpuOneCore) { $cpuOneCore / $logicalProcessors } else { $null }
            $row = [pscustomobject]@{
                timestamp_utc = [DateTimeOffset]::UtcNow.ToString('o')
                elapsed_s = $elapsed
                working_set_bytes = $targetProcess.WorkingSet64
                private_bytes = $targetProcess.PrivateMemorySize64
                cpu_total_s = $cpu
                cpu_percent_one_core = $cpuOneCore
                cpu_percent_machine = $cpuMachine
                interval_s = $interval
            }
            $rows.Add($row)
            $values = @($row.timestamp_utc, $row.elapsed_s, $row.working_set_bytes, $row.private_bytes, $row.cpu_total_s, $row.cpu_percent_one_core, $row.cpu_percent_machine, $row.interval_s)
            $writer.WriteLine(($values | ForEach-Object { if ($null -eq $_) { '' } elseif ($_ -is [IFormattable]) { $_.ToString($null,[Globalization.CultureInfo]::InvariantCulture) } else { [string]$_ } }) -join ',')
            $writer.Flush()
            $previousCpu = $cpu
            $previousElapsed = $elapsed
        } catch { $stopReason = 'sampling_error: ' + $_.Exception.Message; break }
        Start-Sleep -Milliseconds $IntervalMs
    }
} finally { $writer.Dispose(); $clock.Stop() }
function SummarizeValues($values) {
    $sorted = @($values | Sort-Object)
    if ($sorted.Count -eq 0) { return $null }
    return [ordered]@{ min=$sorted[0]; median=$sorted[[Math]::Floor(($sorted.Count-1)/2)]; p95=$sorted[[Math]::Max(0,[Math]::Ceiling($sorted.Count*0.95)-1)]; max=$sorted[-1] }
}
$summary = [ordered]@{
    scenario = $Scenario
    process_name = $processName
    process_id = $TargetPid
    process_started_utc = $processStartedUtc
    sample_count = $rows.Count
    elapsed_seconds = $clock.Elapsed.TotalSeconds
    requested_duration_seconds = $DurationSeconds
    requested_interval_ms = $IntervalMs
    stop_signal_supported = [bool]$StopFile
    logical_processors = $logicalProcessors
    stop_reason = $stopReason
    working_set_bytes = SummarizeValues @($rows | ForEach-Object working_set_bytes)
    private_bytes = SummarizeValues @($rows | ForEach-Object private_bytes)
    cpu_percent_machine = SummarizeValues @($rows | Where-Object { $null -ne $_.cpu_percent_machine } | ForEach-Object cpu_percent_machine)
    cpu_percent_one_core = SummarizeValues @($rows | Where-Object { $null -ne $_.cpu_percent_one_core } | ForEach-Object cpu_percent_one_core)
    fps = 'NOT MEASURED by this sampler'
    tps = 'NOT MEASURED by this sampler'
    network = 'NOT MEASURED; process IO is not treated as network traffic'
    limitations = 'Process-only memory and CPU. GPU memory, system RAM, FPS/TPS and gameplay quality are not inferred. Record foreground/background state, scenario, clients, settings and instrumentation separately.'
}
[System.IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 6) + "`n", [System.Text.UTF8Encoding]::new($false))
$summary | ConvertTo-Json -Depth 6
