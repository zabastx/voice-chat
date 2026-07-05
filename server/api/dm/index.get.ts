import { eq } from 'drizzle-orm'

// The caller's direct-message conversations. Every row in channel_participants
// belongs to a kind='dm' channel, so a member's participations ARE their DMs.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const db = useDb()

	const rows = await db
		.select({ channelId: schema.channelParticipants.channelId })
		.from(schema.channelParticipants)
		.where(eq(schema.channelParticipants.memberId, user.id))

	const conversations = await Promise.all(
		rows.map((row) => dmConversationDto(row.channelId, user.id))
	)

	return (
		conversations
			.filter((c): c is DmConversationDto => c !== null)
			// most recent activity first; conversations with no messages sort last
			.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
	)
})
