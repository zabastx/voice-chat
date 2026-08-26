// The caller's own link status for one messenger. The external id and the link
// token are secrets — never returned here, never in a member DTO, never in the
// session cookie (adr/0006, adr/0011).
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const transport = requireTransport(event)
	const info = transportInfo(transport)
	const link = await getLink(user.id, transport)
	return {
		transport,
		label: info.label,
		configured: info.configured,
		linked: !!link?.externalId,
		// no row yet = never linked, and the default is on
		notificationsEnabled: link?.notificationsEnabled ?? true
	}
})
