import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	notificationsEnabled: z.boolean()
})

// Toggle Telegram notifications on/off without unlinking the account.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	await useDb()
		.update(schema.members)
		.set({ telegramNotificationsEnabled: body.notificationsEnabled })
		.where(eq(schema.members.id, user.id))
	return { notificationsEnabled: body.notificationsEnabled }
})
