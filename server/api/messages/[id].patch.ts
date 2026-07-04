import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({ content: z.string().trim().min(1).max(4000) })

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, id) })
	if (!message) {
		throw createError({ statusCode: 404, message: 'Сообщение не найдено' })
	}
	if (message.authorId !== user.id) {
		throw createError({ statusCode: 403, message: 'Можно редактировать только свои сообщения' })
	}

	const content = await encodeMessageMentions(body.content)
	await db
		.update(schema.messages)
		.set({ content, editedAt: new Date() })
		.where(eq(schema.messages.id, id))

	const dto = (await messageDto(id))!
	wsBroadcast({ type: 'message.updated', message: dto })
	return dto
})
