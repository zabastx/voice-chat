import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({ memberId: z.string() })

// Get-or-create a 1:1 DM with `memberId`. Idempotent: returns the existing
// conversation if one exists, otherwise creates the channel + participant rows
// and notifies both members so their sidebar list updates live.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const { memberId } = await readValidatedBody(event, bodySchema.parse)
	if (memberId === user.id) {
		throw createError({ statusCode: 400, message: 'Нельзя написать самому себе' })
	}

	const db = useDb()
	const other = await db.query.members.findFirst({ where: eq(schema.members.id, memberId) })
	if (!other) {
		throw createError({ statusCode: 404, message: 'Пользователь не найден' })
	}

	const existing = await findDmChannelBetween(user.id, memberId)
	if (existing) {
		return (await dmConversationDto(existing, user.id))!
	}

	const channelId = newId()
	await db.insert(schema.channels).values({ id: channelId, name: '', kind: 'dm' })
	await db.insert(schema.channelParticipants).values([
		{ channelId, memberId: user.id },
		{ channelId, memberId }
	])

	// each participant sees the OTHER person as the conversation's face, so build
	// a per-viewer DTO and deliver it only to that member's sockets
	const forCreator = (await dmConversationDto(channelId, user.id))!
	const forOther = await dmConversationDto(channelId, memberId)
	wsSendToMembers([user.id], { type: 'dm.created', conversation: forCreator })
	if (forOther) wsSendToMembers([memberId], { type: 'dm.created', conversation: forOther })

	return forCreator
})
