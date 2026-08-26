import { resolve } from 'node:path'

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import * as schema from '../db/schema'

export type Db = PostgresJsDatabase<typeof schema>

let db: Db | undefined
let client: postgres.Sql | undefined

// Single postgres.js code path for both runtimes (Node in dev, Bun in prod) —
// unlike the SQLite era there is no per-runtime driver fork. Message full-text
// search lives in a STORED generated tsvector column (see schema.ts), so no
// boot-time index setup is needed either.
export async function initDb(): Promise<Db> {
	if (db) return db
	const config = useRuntimeConfig()
	client = postgres(config.databaseUrl, {
		// nitro runs a single instance; a small pool is plenty for a friend group
		max: 10,
		onnotice: () => {}
	})
	const pgDb = drizzle(client, { schema })
	await migrate(pgDb, { migrationsFolder: resolve(config.migrationsDir) })
	db = pgDb
	return db
}

// A session-scoped advisory lock, used to elect the single instance that may
// run the VK long poll. Two app instances polling the same community both get
// every event and both act on it — which, for a single-use link token, means one
// consumes it and the other tells the member their link expired. Observed on
// 2026-08-26 with two dev servers up (GOTCHAS 22).
//
// Postgres advisory locks are held for the life of the connection, so this
// reserves one rather than borrowing from the pool. Releasing it is the
// connection closing: process exit, or the explicit release on nitro shutdown.
export async function tryAdvisoryLock(
	key: number
): Promise<{ release: () => Promise<void> } | null> {
	if (!client) throw new Error('Database not initialised')
	const conn = await client.reserve()
	const [row] = await conn`SELECT pg_try_advisory_lock(${key}) AS locked`
	if (!row?.locked) {
		conn.release()
		return null
	}
	return {
		release: async () => {
			try {
				await conn`SELECT pg_advisory_unlock(${key})`
			} finally {
				conn.release()
			}
		}
	}
}

export function useDb(): Db {
	if (!db) {
		throw new Error('Database not initialised — the db nitro plugin must run first')
	}
	return db
}

export { schema }
