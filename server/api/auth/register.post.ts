import { count, eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
	invite: z.string().optional()
})

export default defineEventHandler(async (event) => {
	requireRateLimit(event, 'register', 10, 15 * 60 * 1000)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	// hash before opening the transaction — scrypt is async, the sqlite
	// transaction callback is synchronous
	const passwordHash = await hashPassword(body.password)

	// one synchronous transaction so two concurrent registrations can't consume
	// the same invite twice or both become the first (admin) account
	const member = db.transaction((tx) => {
		const [row] = tx.select({ n: count() }).from(schema.members).all()
		const isFirst = (row?.n ?? 0) === 0

		if (!isFirst) {
			if (!body.invite) {
				throw createError({ statusCode: 400, message: 'Для регистрации нужно приглашение' })
			}
			const invite = tx
				.select()
				.from(schema.invites)
				.where(eq(schema.invites.token, body.invite))
				.get()
			if (!invite || invite.usedAt) {
				throw createError({
					statusCode: 400,
					message: 'Приглашение недействительно или уже использовано'
				})
			}
		}

		const existing = tx
			.select({ id: schema.members.id })
			.from(schema.members)
			.where(eq(schema.members.username, body.username))
			.get()
		if (existing) {
			throw createError({ statusCode: 409, message: 'Это имя уже занято' })
		}

		const created = {
			id: newId(),
			username: body.username,
			passwordHash,
			isAdmin: isFirst
		}
		tx.insert(schema.members).values(created).run()

		if (isFirst) {
			tx.insert(schema.channels)
				.values([
					{ id: newId(), name: 'general', kind: 'text' as const, position: 0 },
					{ id: newId(), name: 'lounge', kind: 'voice' as const, position: 1 }
				])
				.run()
		} else if (body.invite) {
			tx.update(schema.invites)
				.set({ usedBy: created.id, usedAt: new Date() })
				.where(eq(schema.invites.token, body.invite))
				.run()
		}

		return created
	})

	await setUserSession(event, {
		user: { id: member.id, username: member.username, isAdmin: member.isAdmin }
	})
	return { id: member.id, username: member.username, isAdmin: member.isAdmin }
})
