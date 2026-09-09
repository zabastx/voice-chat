# Sample the complete Tauri/WebView2 process tree, in the same units as scripts/bench.
param(
    [int]$Root = 0,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Label = 'manual'
)
$ErrorActionPreference = 'Stop'
if (-not $Root) {
    $clients = @(Get-Process -Name 'voice-chat-desktop-prototype' -ErrorAction SilentlyContinue)
    if ($clients.Count -ne 1) { throw 'Expected one running desktop prototype; pass -Root PID explicitly.' }
    $Root = $clients[0].Id
}

$samples = @()
foreach ($iteration in 1..3) {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($Root)
    $seen = @{}
    $rows = @()
    while ($queue.Count) {
        $processId = $queue.Dequeue()
        if ($seen.ContainsKey($processId)) { continue }
        $seen[$processId] = $true
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            $rows += [pscustomobject]@{
                pid = $processId
                name = $process.ProcessName
                privateBytes = [int64]$process.PrivateMemorySize64
                workingSetBytes = [int64]$process.WorkingSet64
            }
        }
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $processId }) {
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    if (-not ($rows | Where-Object { $_.pid -eq $Root })) { throw 'Client exited during measurement.' }
    if (-not ($rows | Where-Object { $_.name -eq 'msedgewebview2' })) { throw 'No WebView2 descendants found; refusing an incomplete measurement.' }
    $samples += [pscustomobject]@{
        privateBytes = [int64](($rows | Measure-Object privateBytes -Sum).Sum)
        workingSetBytes = [int64](($rows | Measure-Object workingSetBytes -Sum).Sum)
        processes = $rows
    }
    if ($iteration -lt 3) { Start-Sleep -Milliseconds 700 }
}
$privateMedian = @($samples.privateBytes | Sort-Object)[1]
$workingMedian = @($samples.workingSetBytes | Sort-Object)[1]
$report = [pscustomobject]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    label = $Label
    rootPid = $Root
    privateMiB = [math]::Round($privateMedian / 1MB, 1)
    workingSetMiB = [math]::Round($workingMedian / 1MB, 1)
    samples = $samples
}
$outputDir = Join-Path $PSScriptRoot '../.data/desktop-memory'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $outputDir "$Label.json")
$report | Select-Object label, rootPid, privateMiB, workingSetMiB | Format-Table -AutoSize
