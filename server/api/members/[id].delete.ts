import { and, eq, inArray } from 'drizzle-orm'

function attachmentKeys(rows: { objectKey: string; previewKey: string | null }[]) {
	return rows.flatMap((a) => (a.previewKey ? [a.objectKey, a.previewKey] : [a.objectKey]))
}

export default defineEventHandler(async (event) => {
	const admin = await requireRole(event, 'admin')
	const id = getRouterParam(event, 'id')!
	if (id === admin.id) {
		throw createError({ statusCode: 400, message: 'Нельзя удалить самого себя' })
	}
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	// A DM channel row has no member FK, so deleting a participant leaves the
	// channel behind with one member — invisible (dmConversationDto returns null
	// without an "other" participant) but accumulating forever. Take the
	// conversations with them.
	const dmChannelIds = (
		await db
			.select({ id: schema.channelParticipants.channelId })
			.from(schema.channelParticipants)
			.innerJoin(schema.channels, eq(schema.channelParticipants.channelId, schema.channels.id))
			.where(and(eq(schema.channelParticipants.memberId, id), eq(schema.channels.kind, 'dm')))
	).map((row) => row.id)

	// cascades wipe this member's attachment rows (via uploader_id and via their
	// deleted messages) — collect object keys first so the files leave the bucket too
	const uploads = await db
		.select({ objectKey: schema.attachments.objectKey, previewKey: schema.attachments.previewKey })
		.from(schema.attachments)
		.where(eq(schema.attachments.uploaderId, id))

	// dropping the DM channels also cascades away the OTHER participant's messages
	// and their attachment rows, which uploader_id above does not cover — those
	// objects would be stranded in the bucket
	const dmUploads = dmChannelIds.length
		? await db
				.select({
					objectKey: schema.attachments.objectKey,
					previewKey: schema.attachments.previewKey
				})
				.from(schema.attachments)
				.innerJoin(schema.messages, eq(schema.attachments.messageId, schema.messages.id))
				.where(inArray(schema.messages.channelId, dmChannelIds))
		: []

	await db.transaction(async (tx) => {
		await tx.delete(schema.members).where(eq(schema.members.id, id))
		if (dmChannelIds.length) {
			await tx.delete(schema.channels).where(inArray(schema.channels.id, dmChannelIds))
		}
	})

	// drop their sockets before announcing it, so the removed member never gets
	// their own deletion event — every remaining client prunes them from the
	// member directory and from any DM list without a reload. No `channel.deleted`
	// for the DMs: it is a broadcast, and private conversation ids have no business
	// reaching clients that were never in them.
	wsDisconnectMember(id)
	wsBroadcast({ type: 'member.deleted', memberId: id })

	// an attachment the deleted member posted inside one of these DMs is in both
	// lists — dedupe so it is not deleted twice
	const keys = new Set([...attachmentKeys(uploads), ...attachmentKeys(dmUploads)])
	if (member.avatarId) keys.add(avatarObjectKey(member.id, member.avatarId))
	await deleteAttachmentObjects([...keys])
	return { ok: true }
})
