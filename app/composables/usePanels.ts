// shared UI state for the dashboard side panels (channels on the left,
// members on the right). The built-in UDashboardSidebarToggle/Collapse
// buttons act on ALL sidebars in the group at once, so with two sidebars
// each panel must be driven individually through these refs instead.
export function usePanels() {
	// mobile slideover open flags
	const channelsOpen = useState('panels-channels-open', () => false)
	const membersOpen = useState('panels-members-open', () => false)
	// desktop visibility; cookies (not localStorage) so SSR renders the same state
	const channelsHidden = useCookie<boolean>('channels-hidden', {
		default: () => false,
		maxAge: 60 * 60 * 24 * 365
	})
	const membersHidden = useCookie<boolean>('members-hidden', {
		default: () => false,
		maxAge: 60 * 60 * 24 * 365
	})
	return { channelsOpen, membersOpen, channelsHidden, membersHidden }
}
