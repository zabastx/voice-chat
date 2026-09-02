# Per-process memory for one Chrome process tree, as JSON on stdout.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File proc-memory.ps1 -Root <browser pid>
#
# Walks chrome.exe descendants of -Root and tags each with its Chromium process
# type (browser / renderer / gpu-process / utility / …), taken from --type= on
# its command line. Two numbers per process:
#   ws   WorkingSet64        resident bytes, shared pages included
#   priv PrivateMemorySize64 private commit — the closest thing to "this process
#                            costs the machine this much", and the one to compare.
param([Parameter(Mandatory = $true)][int]$Root)

$ErrorActionPreference = 'Stop'

# Win32_Process for the tree shape (Get-Process has no parent pid), Get-Process
# for the memory counters (Win32_Process's page counts are ambiguously scaled).
$all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
	Select-Object ProcessId, ParentProcessId, CommandLine

$byParent = @{}
foreach ($p in $all) {
	$parent = [int]$p.ParentProcessId
	if (-not $byParent.ContainsKey($parent)) { $byParent[$parent] = @() }
	$byParent[$parent] += $p
}
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }

$out = @()
$seen = @{}
$queue = New-Object System.Collections.Queue
$queue.Enqueue($Root)

while ($queue.Count -gt 0) {
	$id = [int]$queue.Dequeue()
	if ($seen.ContainsKey($id)) { continue }
	$seen[$id] = $true

	$proc = $byId[$id]
	if ($null -ne $proc) {
		$type = 'browser'
		if ($proc.CommandLine -match '--type=([a-z-]+)') { $type = $Matches[1] }
		# the process can exit between the two queries — a vanished child is not an error
		$live = Get-Process -Id $id -ErrorAction SilentlyContinue
		if ($null -ne $live) {
			$out += [pscustomobject]@{
				pid  = $id
				type = $type
				ws   = [int64]$live.WorkingSet64
				priv = [int64]$live.PrivateMemorySize64
			}
		}
	}

	if ($byParent.ContainsKey($id)) {
		foreach ($child in $byParent[$id]) { $queue.Enqueue([int]$child.ProcessId) }
	}
}

# @() so a single-process tree still serializes as an array
ConvertTo-Json -Compress -Depth 3 -InputObject @($out)
