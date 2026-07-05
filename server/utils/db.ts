import { resolve } from 'node:path'

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import * as schema from '../db/schema'

export type Db = PostgresJsDatabase<typeof schema>

let db: Db | undefined

// Single postgres.js code path for both runtimes (Node in dev, Bun in prod) —
// unlike the SQLite era there is no per-runtime driver fork. Message full-text
// search lives in a STORED generated tsvector column (see schema.ts), so no
// boot-time index setup is needed either.
export async function initDb(): Promise<Db> {
	if (db) return db
	const config = useRuntimeConfig()
	const client = postgres(config.databaseUrl, {
		// nitro runs a single instance; a small pool is plenty for a friend group
		max: 10,
		onnotice: () => {}
	})
	const pgDb = drizzle(client, { schema })
	await migrate(pgDb, { migrationsFolder: resolve(config.migrationsDir) })
	db = pgDb
	return db
}

export function useDb(): Db {
	if (!db) {
		throw new Error('Database not initialised — the db nitro plugin must run first')
	}
	return db
}

export { schema }
