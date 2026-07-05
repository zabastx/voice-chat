import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	dialect: 'postgresql',
	schema: './server/db/schema.ts',
	out: './server/db/migrations',
	dbCredentials: {
		// same default as runtimeConfig.databaseUrl in nuxt.config.ts
		url: process.env.NUXT_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/voicechat'
	}
})
