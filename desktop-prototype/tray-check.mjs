// Small native-window reproduction, independent of auth and media.
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'

const exe = join(import.meta.dirname, 'src-tauri/target/release/voice-chat-desktop-prototype.exe')
const pause = () => new Promise((resolve) => setTimeout(resolve, 2000))
const running = execFileSync(
	'powershell.exe',
	[
		'-NoProfile',
		'-Command',
		"@(Get-Process -Name 'voice-chat-desktop-prototype' -ErrorAction SilentlyContinue).Count"
	],
	{ encoding: 'utf8' }
).trim()
if (running !== '0') throw new Error('Close the existing desktop prototype before this check')
const child = spawn(exe, ['--tray'], { windowsHide: true, stdio: 'ignore' })
function state() {
	return JSON.parse(
		execFileSync(
			'powershell.exe',
			[
				'-NoProfile',
				'-Command',
				`Get-Process -Id ${child.pid} | Select-Object Id,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress`
			],
			{ encoding: 'utf8' }
		).trim()
	)
}
function check(label, hidden) {
	const current = state()
	if (current.MainWindowTitle.endsWith('-siw') !== hidden) {
		throw new Error(`${label}: unexpected native window ${JSON.stringify(current)}`)
	}
	console.log(`PASS ${label}: ${current.MainWindowTitle}`)
}
try {
	await pause()
	check('initial --tray', true)
	execFileSync(exe, [])
	await pause()
	check('show', false)
	execFileSync(exe, ['--tray'])
	await pause()
	check('hide', true)
} finally {
	child.kill()
}
