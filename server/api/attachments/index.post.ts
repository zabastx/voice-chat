const MAX_SIZE = 25 * 1024 * 1024

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	if (!s3Configured()) {
		throw createError({ statusCode: 503, message: 'Файловое хранилище не настроено' })
	}

	const contentLength = Number(getHeader(event, 'content-length') ?? 0)
	if (contentLength > MAX_SIZE + 1024 * 1024) {
		throw createError({ statusCode: 413, message: 'Файл слишком большой (максимум 25 МБ)' })
	}

	const parts = await readMultipartFormData(event)
	const file = parts?.find((part) => part.name === 'file' && part.filename)
	if (!file?.filename) {
		throw createError({ statusCode: 400, message: 'В запросе нет файла' })
	}
	if (file.data.length > MAX_SIZE) {
		throw createError({ statusCode: 413, message: 'Файл слишком большой (максимум 25 МБ)' })
	}

	const filename = file.filename.replace(/[/\\]/g, '_').slice(0, 200)
	const attachment = {
		id: newId(),
		uploaderId: user.id,
		filename,
		mime: file.type || 'application/octet-stream',
		size: file.data.length,
		objectKey: ''
	}
	attachment.objectKey = `attachments/${attachment.id}/${filename}`

	await putObject(attachment.objectKey, file.data, attachment.mime)
	await useDb().insert(schema.attachments).values(attachment)

	const dto: AttachmentDto = {
		id: attachment.id,
		filename: attachment.filename,
		mime: attachment.mime,
		size: attachment.size
	}
	return dto
})
