import { eq } from 'drizzle-orm'

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	if (!s3Configured()) {
		throw createError({ statusCode: 503, message: 'Файловое хранилище не настроено' })
	}

	requireDeclaredBodySize(event, MAX_SIZE, 'Файл слишком большой (максимум 5 МБ)')

	const parts = await readMultipartFormData(event)
	const file = parts?.find((part) => part.name === 'file' && part.filename)
	if (!file?.filename) {
		throw createError({ statusCode: 400, message: 'В запросе нет файла' })
	}
	if (file.data.length > MAX_SIZE) {
		throw createError({ statusCode: 413, message: 'Файл слишком большой (максимум 5 МБ)' })
	}
	if (!file.type || !ALLOWED_MIME.has(file.type)) {
		throw createError({ statusCode: 400, message: 'Можно загрузить только изображение' })
	}

	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, user.id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}

	const avatarId = newId()
	await putObject(avatarObjectKey(user.id, avatarId), file.data, file.type)

	const [updated] = await db
		.update(schema.members)
		.set({ avatarId })
		.where(eq(schema.members.id, user.id))
		.returning()

	if (member.avatarId) {
		await deleteAttachmentObjects([avatarObjectKey(user.id, member.avatarId)])
	}

	const dto = memberDto(updated!)
	wsBroadcast({ type: 'member.updated', member: dto })
	return dto
})
