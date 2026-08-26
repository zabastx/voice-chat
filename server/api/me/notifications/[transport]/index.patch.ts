import * as z from 'zod'

const bodySchema = z.object({
	notificationsEnabled: z.boolean()
})

// Toggle notifications for one messenger without unlinking, so the preference
// survives a re-link.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const transport = requireTransport(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	await setNotificationsEnabled(user.id, transport, body.notificationsEnabled)
	return { notificationsEnabled: body.notificationsEnabled }
})
