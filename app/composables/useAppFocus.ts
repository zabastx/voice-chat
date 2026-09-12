// Whether the member is actually looking at Voice Chat right now. Sounds, mark-read and
// desktop notifications all turn on this one question, and in a Desktop Client the page
// cannot answer it: a window hidden to the tray still reports `document.hasFocus() ===
// true` and `visibilityState === 'visible'` to its own WebView2 page (GOTCHAS 30). So the
// browser answers for itself and the shell answers for the Desktop Client, behind one ref.
export function useAppFocus() {
	const focused = useState('app-focus', () => true)
	const started = useState('app-focus-started', () => false)

	if (import.meta.client && !started.value) {
		started.value = true
		const desktop = useNativeDesktop()
		if (desktop.supports('window-focus')) {
			focused.value = desktop.isForeground()
			// Never unsubscribed on purpose: this outlives every component, and the shell
			// drops its watchers with the document anyway.
			desktop.onForegroundChange((foreground) => {
				focused.value = foreground
			})
		} else {
			focused.value = document.hasFocus()
			window.addEventListener('focus', () => {
				focused.value = true
			})
			window.addEventListener('blur', () => {
				focused.value = false
			})
		}
	}

	return focused
}
