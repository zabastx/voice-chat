import * as z from 'zod'

const bodySchema = z.object({
	notificationsEnabled: z.boolean()
})

// Toggle Telegram notifications on/off without unlinking the account.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	await setNotificationsEnabled(user.id, 'telegram', body.notificationsEnabled)
	return { notificationsEnabled: body.notificationsEnabled }
})
