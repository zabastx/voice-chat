import { count, eq, sql } from 'drizzle-orm'
import * as z from 'zod'

// app-wide advisory-lock key for the registration critical section
const REGISTER_LOCK_KEY = 730_001

const bodySchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
	invite: z.string().optional()
})

export default defineEventHandler(async (event) => {
	requireRateLimit(event, 'register', 10, 15 * 60 * 1000)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	// hash before opening the transaction — keeps the registration lock short
	const passwordHash = await hashPassword(body.password)

	// registrations are serialised with a transaction-scoped advisory lock so two
	// concurrent ones can't consume the same invite twice or both become the
	// first (admin) account
	const member = await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTER_LOCK_KEY})`)
		const [row] = await tx.select({ n: count() }).from(schema.members)
		const isFirst = (row?.n ?? 0) === 0

		if (!isFirst) {
			if (!body.invite) {
				throw createError({ statusCode: 400, message: 'Для регистрации нужно приглашение' })
			}
			const [invite] = await tx
				.select()
				.from(schema.invites)
				.where(eq(schema.invites.token, body.invite))
			if (!invite || invite.usedAt) {
				throw createError({
					statusCode: 400,
					message: 'Приглашение недействительно или уже использовано'
				})
			}
		}

		const [existing] = await tx
			.select({ id: schema.members.id })
			.from(schema.members)
			.where(eq(schema.members.username, body.username))
		if (existing) {
			throw createError({ statusCode: 409, message: 'Это имя уже занято' })
		}

		const created = {
			id: newId(),
			username: body.username,
			passwordHash,
			role: isFirst ? ('admin' as const) : ('member' as const)
		}
		await tx.insert(schema.members).values(created)

		if (isFirst) {
			await tx.insert(schema.channels).values([
				{ id: newId(), name: 'general', kind: 'text' as const, position: 0 },
				{ id: newId(), name: 'lounge', kind: 'voice' as const, position: 1 }
			])
		} else if (body.invite) {
			await tx
				.update(schema.invites)
				.set({ usedBy: created.id, usedAt: new Date() })
				.where(eq(schema.invites.token, body.invite))
		}

		return created
	})

	await setUserSession(event, {
		user: { id: member.id, username: member.username, role: member.role }
	})
	return { id: member.id, username: member.username, role: member.role }
})
