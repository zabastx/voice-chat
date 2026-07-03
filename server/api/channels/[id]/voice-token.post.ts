import { eq } from 'drizzle-orm'
import { AccessToken } from 'livekit-server-sdk'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!

	const channel = await useDb().query.channels.findFirst({
		where: eq(schema.channels.id, channelId)
	})
	if (!channel || channel.kind !== 'voice') {
		throw createError({ statusCode: 404, message: 'Голосовой канал не найден' })
	}

	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, user.id)
	})

	const config = useRuntimeConfig()
	const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
		identity: user.id,
		name: member?.displayName ?? user.username,
		ttl: '2h'
	})
	token.addGrant({
		roomJoin: true,
		room: channelId,
		canPublish: true,
		canSubscribe: true
	})

	return { token: await token.toJwt(), url: config.public.livekitUrl }
})
