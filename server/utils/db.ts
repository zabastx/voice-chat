import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

import * as schema from '../db/schema'

export type Db = BunSQLiteDatabase<typeof schema>

let db: Db | undefined

// Production runs on Bun (nitro bun preset) and uses the zero-dependency bun:sqlite
// driver. The dev server runs on Node (the Nuxt dev proxy can't forward WebSocket
// upgrades under Bun), so it falls back to better-sqlite3. Both drizzle flavours
// share the same sync API.
export async function initDb(): Promise<Db> {
	if (db) return db
	const config = useRuntimeConfig()
	const path = resolve(config.dbPath)
	mkdirSync(dirname(path), { recursive: true })
	const migrationsFolder = resolve(config.migrationsDir)

	if ('Bun' in globalThis) {
		const [{ Database }, { drizzle }, { migrate }] = await Promise.all([
			import('bun:sqlite'),
			import('drizzle-orm/bun-sqlite'),
			import('drizzle-orm/bun-sqlite/migrator')
		])
		const sqlite = new Database(path)
		sqlite.exec('PRAGMA journal_mode = WAL;')
		sqlite.exec('PRAGMA foreign_keys = ON;')
		const bunDb = drizzle(sqlite, { schema })
		migrate(bunDb, { migrationsFolder })
		db = bunDb
	} else {
		const [{ default: Database }, { drizzle }, { migrate }] = await Promise.all([
			import('better-sqlite3'),
			import('drizzle-orm/better-sqlite3'),
			import('drizzle-orm/better-sqlite3/migrator')
		])
		const sqlite = new Database(path)
		sqlite.pragma('journal_mode = WAL')
		sqlite.pragma('foreign_keys = ON')
		const nodeDb = drizzle(sqlite, { schema })
		migrate(nodeDb, { migrationsFolder })
		db = nodeDb as unknown as Db
	}
	return db
}

export function useDb(): Db {
	if (!db) {
		throw new Error('Database not initialised — the db nitro plugin must run first')
	}
	return db
}

export { schema }
