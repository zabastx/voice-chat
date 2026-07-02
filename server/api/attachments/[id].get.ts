import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const attachment = await useDb().query.attachments.findFirst({
		where: eq(schema.attachments.id, id)
	})
	if (!attachment) {
		throw createError({ statusCode: 404, message: 'Файл не найден' })
	}
	return sendRedirect(event, await presignGetUrl(attachment.objectKey), 302)
})
