// Reading and answering the native update offer, for the harnesses that drive a real
// executable. The offer is a TaskDialog, so there is no DOM: UI Automation reads what the
// member sees, and the custom buttons are real child windows, which a BM_CLICK presses
// without having to steal foreground focus (GOTCHAS 28). Russian labels travel in the
// environment because Windows PowerShell decodes a UTF-8 command line as ANSI.
import { execFileSync } from 'node:child_process'

export const DIALOG_TITLE = 'Обновление Voice Chat'
export const POSTPONE = 'Отложить'
export const OPEN_RELEASE = 'Открыть выпуск'
export const INSTALL = 'Установить'

const script = [
	'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
	'Add-Type -AssemblyName UIAutomationClient',
	'Add-Type -AssemblyName UIAutomationTypes',
	'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class VcNative { [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam); }\'',
	'$desktop = [System.Windows.Automation.AutomationElement]::RootElement',
	'$title = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $env:VC_DIALOG_TITLE)',
	'$deadline = (Get-Date).AddMilliseconds([int]$env:VC_TIMEOUT_MS)',
	'$dialog = $null',
	'while ($null -eq $dialog -and (Get-Date) -lt $deadline) { $dialog = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $title); if ($null -eq $dialog) { Start-Sleep -Milliseconds 50 } }',
	'if ($null -eq $dialog) { \'{"found":false}\'; exit 0 }',
	'$elements = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
	'$text = ($elements | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text } | ForEach-Object { $_.Current.Name }) -join "`n"',
	'$buttons = @($elements | Where-Object { $_.Current.AutomationId -like "CommandButton_*" } | ForEach-Object { @{ label = $_.Current.Name; window = $_.Current.NativeWindowHandle } })',
	'$clicked = ""',
	// read the dialog out before pressing anything: the click closes it, and a
	// destroyed element answers every UI Automation property with $null
	'if ($env:VC_CLICK) { $target = $buttons | Where-Object { $_.label -eq $env:VC_CLICK } | Select-Object -First 1; if ($null -ne $target) { [void][VcNative]::SendMessageW([IntPtr]$target.window, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $clicked = $target.label } }',
	'@{ found = $true; text = $text; buttons = @($buttons | ForEach-Object { $_.label }); clicked = $clicked } | ConvertTo-Json -Compress',
	'exit 0'
].join('; ')

/**
 * Waits for the update offer, reads it the way a member sees it and — when `click` is
 * given — presses exactly the button carrying that Russian label.
 */
export function readOffer({ click = '', timeout = 15_000 } = {}) {
	const answer = JSON.parse(
		execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
			encoding: 'utf8',
			env: {
				...process.env,
				VC_DIALOG_TITLE: DIALOG_TITLE,
				VC_CLICK: click,
				VC_TIMEOUT_MS: String(timeout)
			}
		}).trim()
	)
	return {
		found: Boolean(answer.found),
		text: (answer.text ?? '').replaceAll('\r\n', '\n'),
		buttons: [answer.buttons ?? []].flat(),
		clicked: answer.clicked ?? ''
	}
}

/** The message the shell formats for a Release, whichever action it is asking for. */
export function offerMessage(version, notes, question) {
	const head = `Доступна новая версия Voice Chat ${version}.`
	return notes.trim() ? `${head}\n\n${notes.trim()}\n\n${question}` : `${head}\n\n${question}`
}

/** Asserts the member saw this Release, this question and exactly these two actions. */
export function expectOffer(offer, { message, accept }) {
	if (!offer.found) throw new Error('The update offer never appeared')
	if (offer.text !== message) {
		throw new Error(`Offer read ${JSON.stringify(offer.text)}, expected ${JSON.stringify(message)}`)
	}
	if (offer.buttons.join(' | ') !== `${accept} | ${POSTPONE}`) {
		throw new Error(`Offer carried ${JSON.stringify(offer.buttons)}`)
	}
}
