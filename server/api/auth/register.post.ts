import { count, eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
	invite: z.string().optional()
})

export default defineEventHandler(async (event) => {
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	const [row] = await db.select({ n: count() }).from(schema.members)
	const isFirst = (row?.n ?? 0) === 0

	let inviteToken: string | undefined
	if (!isFirst) {
		if (!body.invite) {
			throw createError({ statusCode: 400, message: 'Для регистрации нужно приглашение' })
		}
		const invite = await db.query.invites.findFirst({
			where: eq(schema.invites.token, body.invite)
		})
		if (!invite || invite.usedAt) {
			throw createError({
				statusCode: 400,
				message: 'Приглашение недействительно или уже использовано'
			})
		}
		inviteToken = invite.token
	}

	const existing = await db.query.members.findFirst({
		where: eq(schema.members.username, body.username)
	})
	if (existing) {
		throw createError({ statusCode: 409, message: 'Это имя уже занято' })
	}

	const member = {
		id: newId(),
		username: body.username,
		passwordHash: await hashPassword(body.password),
		isAdmin: isFirst
	}
	await db.insert(schema.members).values(member)

	if (isFirst) {
		await db.insert(schema.channels).values([
			{ id: newId(), name: 'general', kind: 'text' as const, position: 0 },
			{ id: newId(), name: 'lounge', kind: 'voice' as const, position: 1 }
		])
	}

	if (inviteToken) {
		await db
			.update(schema.invites)
			.set({ usedBy: member.id, usedAt: new Date() })
			.where(eq(schema.invites.token, inviteToken))
	}

	await setUserSession(event, {
		user: { id: member.id, username: member.username, isAdmin: member.isAdmin }
	})
	return { id: member.id, username: member.username, isAdmin: member.isAdmin }
})
