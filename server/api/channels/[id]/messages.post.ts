import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	content: z.string().max(4000),
	attachmentIds: z.array(z.string()).max(10).default([]),
	replyToId: z.string().optional()
})

export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	// gates DM channels to their participants; returns the channel row
	const { channel, user } = await requireChannelMember(event, channelId)
	// messages are for text channels and DMs; voice channels carry no chat
	if (channel.kind === 'voice') {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	const body = await readValidatedBody(event, bodySchema.parse)
	const trimmed = body.content.trim()
	if (!trimmed && body.attachmentIds.length === 0) {
		throw createError({ statusCode: 400, message: 'Пустое сообщение' })
	}

	const db = useDb()

	const content = await encodeMessageMentions(trimmed)

	// only accept a reply pointer to an existing message in this channel;
	// anything stale is silently dropped rather than failing the send
	let replyToId: string | null = null
	if (body.replyToId) {
		const parent = await db.query.messages.findFirst({
			where: eq(schema.messages.id, body.replyToId)
		})
		if (parent && parent.channelId === channelId) replyToId = parent.id
	}

	return await createChannelMessage({
		channel,
		authorId: user.id,
		content,
		replyToId,
		attachmentIds: body.attachmentIds
	})
})
