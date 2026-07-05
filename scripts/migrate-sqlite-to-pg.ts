// One-shot SQLite -> Postgres data migration (the 0.12.0 cutover, see docs/DEPLOY.md).
//
//   bun scripts/migrate-sqlite-to-pg.ts [path/to/app.sqlite]
//
// Reads the legacy SQLite database (default /data/app.sqlite — the app-data
// volume in prod, pass .data/app.sqlite locally), applies the Postgres schema
// migrations, then copies every table in one transaction. Refuses to run
// against a non-empty target so it can't double-import. Timestamps stored as
// integer milliseconds in SQLite become real timestamptz values; the messages
// tsvector search column is generated, so it populates itself.
//
// Bun-only (bun:sqlite) — in prod run it inside the app image:
//   docker compose run --rm app bun scripts/migrate-sqlite-to-pg.ts

import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import * as schema from '../server/db/schema'

const sqlitePath = process.argv[2] ?? '/data/app.sqlite'
const databaseUrl =
	process.env.NUXT_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/voicechat'
const migrationsDir = resolve(process.env.NUXT_MIGRATIONS_DIR ?? 'server/db/migrations')

type Row = Record<string, unknown>

const date = (v: unknown): Date => new Date(Number(v))
const dateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(Number(v)))
const str = (v: unknown): string => String(v)
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v))

// postgres.js caps a statement at 65534 parameters; stay far below it
async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
	for (let i = 0; i < rows.length; i += 500) {
		await insert(rows.slice(i, i + 500))
	}
}

const sqlite = new Database(sqlitePath, { readonly: true })
const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = drizzle(client, { schema })

console.log(`SQLite source: ${sqlitePath}`)
console.log(`Postgres target: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)

await migrate(db, { migrationsFolder: migrationsDir })

const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.members)
if (n > 0) {
	console.error(`Target already has ${n} members — refusing to import twice.`)
	process.exit(1)
}

const read = (table: string): Row[] => sqlite.query(`SELECT * FROM ${table}`).all() as Row[]

// The `members` role column has changed shape across releases: early DBs only had
// `is_admin` (integer), v0.10.0 added `role` and set it from is_admin, then dropped
// is_admin. A source that predates v0.10.0 has no `role` column, so reading r.role
// blindly yields undefined → the admin (and everyone) lands as a non-admin role.
// Map explicitly from whichever column the source actually has, and reject any role
// that isn't one of the three known values.
const memberColumns = new Set(
	(sqlite.query(`PRAGMA table_info('members')`).all() as { name: string }[]).map((c) => c.name)
)
const VALID_ROLES = new Set(['admin', 'moderator', 'member'])
function memberRole(r: Row): 'admin' | 'moderator' | 'member' {
	if (memberColumns.has('role') && typeof r.role === 'string' && VALID_ROLES.has(r.role)) {
		return r.role as 'admin' | 'moderator' | 'member'
	}
	if (memberColumns.has('is_admin')) {
		return Number(r.is_admin) === 1 ? 'admin' : 'member'
	}
	console.warn(
		`  ! member ${String(r.username)}: no usable role in source → defaulting to 'member'`
	)
	return 'member'
}

const members = read('members')
const channels = read('channels')
const messages = read('messages')
const attachments = read('attachments')
const reactions = read('reactions')
const invites = read('invites')
const memberChannelState = read('member_channel_state')

await db.transaction(async (tx) => {
	await insertChunked(members, (rows) =>
		tx.insert(schema.members).values(
			rows.map((r) => ({
				id: str(r.id),
				username: str(r.username),
				passwordHash: str(r.password_hash),
				displayName: strOrNull(r.display_name),
				avatarId: strOrNull(r.avatar_id),
				role: memberRole(r),
				createdAt: date(r.created_at)
			}))
		)
	)
	await insertChunked(channels, (rows) =>
		tx.insert(schema.channels).values(
			rows.map((r) => ({
				id: str(r.id),
				name: str(r.name),
				kind: str(r.kind) as 'text' | 'voice',
				position: Number(r.position),
				createdAt: date(r.created_at)
			}))
		)
	)
	await insertChunked(messages, (rows) =>
		tx.insert(schema.messages).values(
			rows.map((r) => ({
				id: str(r.id),
				channelId: str(r.channel_id),
				authorId: str(r.author_id),
				content: str(r.content),
				replyToId: strOrNull(r.reply_to_id),
				createdAt: date(r.created_at),
				editedAt: dateOrNull(r.edited_at)
			}))
		)
	)
	await insertChunked(attachments, (rows) =>
		tx.insert(schema.attachments).values(
			rows.map((r) => ({
				id: str(r.id),
				messageId: strOrNull(r.message_id),
				uploaderId: str(r.uploader_id),
				filename: str(r.filename),
				mime: str(r.mime),
				size: Number(r.size),
				objectKey: str(r.object_key),
				previewKey: strOrNull(r.preview_key),
				createdAt: date(r.created_at)
			}))
		)
	)
	await insertChunked(reactions, (rows) =>
		tx.insert(schema.reactions).values(
			rows.map((r) => ({
				messageId: str(r.message_id),
				memberId: str(r.member_id),
				emoji: str(r.emoji),
				createdAt: date(r.created_at)
			}))
		)
	)
	await insertChunked(invites, (rows) =>
		tx.insert(schema.invites).values(
			rows.map((r) => ({
				token: str(r.token),
				createdBy: str(r.created_by),
				createdAt: date(r.created_at),
				usedBy: strOrNull(r.used_by),
				usedAt: dateOrNull(r.used_at)
			}))
		)
	)
	await insertChunked(memberChannelState, (rows) =>
		tx.insert(schema.memberChannelState).values(
			rows.map((r) => ({
				memberId: str(r.member_id),
				channelId: str(r.channel_id),
				lastReadAt: date(r.last_read_at)
			}))
		)
	)
})

const roleCounts = members.reduce<Record<string, number>>((acc, r) => {
	const role = memberRole(r)
	acc[role] = (acc[role] ?? 0) + 1
	return acc
}, {})

console.log('Imported:')
console.log(`  members:              ${members.length} (roles: ${JSON.stringify(roleCounts)})`)
console.log(`  channels:             ${channels.length}`)
console.log(`  messages:             ${messages.length}`)
console.log(`  attachments:          ${attachments.length}`)
console.log(`  reactions:            ${reactions.length}`)
console.log(`  invites:              ${invites.length}`)
console.log(`  member_channel_state: ${memberChannelState.length}`)

sqlite.close()
await client.end()
