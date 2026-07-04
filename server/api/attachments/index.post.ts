const MAX_SIZE = 25 * 1024 * 1024

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	if (!s3Configured()) {
		throw createError({ statusCode: 503, message: 'Файловое хранилище не настроено' })
	}

	requireDeclaredBodySize(event, MAX_SIZE, 'Файл слишком большой (максимум 25 МБ)')

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
		objectKey: '',
		previewKey: null as string | null
	}
	attachment.objectKey = `attachments/${attachment.id}/${filename}`

	await putObject(attachment.objectKey, file.data, attachment.mime)

	// generate a small WebP preview for in-chat display; served via ?preview.
	// Non-images (and failures) leave previewKey null → the original is served.
	const preview = await generateImagePreview(file.data, attachment.mime)
	if (preview) {
		attachment.previewKey = `attachments/${attachment.id}/preview.webp`
		await putObject(attachment.previewKey, preview, 'image/webp')
	}

	await useDb().insert(schema.attachments).values(attachment)

	const dto: AttachmentDto = {
		id: attachment.id,
		filename: attachment.filename,
		mime: attachment.mime,
		size: attachment.size
	}
	return dto
})
