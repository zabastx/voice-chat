import type { H3Event } from 'h3'

// Minimal fixed-window in-memory limiter for the credential endpoints: login
// hashes scrypt per attempt, so unthrottled it is both brute-forceable and a
// CPU amplifier. Single process + a handful of users — no store needed.
const buckets = new Map<string, { count: number; resetAt: number }>()

export function requireRateLimit(event: H3Event, name: string, limit: number, windowMs: number) {
	const now = Date.now()
	if (buckets.size > 10_000) {
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= now) buckets.delete(key)
		}
	}
	// Caddy terminates TLS and sets X-Forwarded-For; direct hits fall back to the socket address
	const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
	const key = `${name}:${ip}`
	let bucket = buckets.get(key)
	if (!bucket || bucket.resetAt <= now) {
		bucket = { count: 0, resetAt: now + windowMs }
		buckets.set(key, bucket)
	}
	bucket.count++
	if (bucket.count > limit) {
		throw createError({ statusCode: 429, message: 'Слишком много попыток. Попробуйте позже' })
	}
}
