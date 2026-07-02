import { count } from 'drizzle-orm'

export default defineEventHandler(async () => {
	const [row] = await useDb().select({ n: count() }).from(schema.members)
	return { needsSetup: (row?.n ?? 0) === 0 }
})
