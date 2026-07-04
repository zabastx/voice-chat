import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

import * as schema from '../db/schema'

export type Db = BunSQLiteDatabase<typeof schema>

let db: Db | undefined

// Full-text search over messages. The FTS5 virtual table + sync triggers aren't
// part of the Drizzle schema, so they're created idempotently at boot (after
// migrations) rather than via the journal-driven migrator. A standalone (not
// external-content) FTS5 table keyed by the messages implicit rowid; the initial
// INSERT backfills any rows missing from the index (first boot, or after a wipe).
const FTS_SETUP_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
	content,
	message_id UNINDEXED,
	channel_id UNINDEXED,
	tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO messages_fts(rowid, content, message_id, channel_id)
	SELECT m.rowid, m.content, m.id, m.channel_id FROM messages m
	WHERE m.rowid NOT IN (SELECT rowid FROM messages_fts);
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, content, message_id, channel_id)
	VALUES (new.rowid, new.content, new.id, new.channel_id);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
	DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
	UPDATE messages_fts SET content = new.content WHERE rowid = old.rowid;
END;
`

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
		sqlite.exec(FTS_SETUP_SQL)
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
		sqlite.exec(FTS_SETUP_SQL)
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
