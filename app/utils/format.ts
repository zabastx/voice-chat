const LOCALE = 'ru-RU'

export function formatTime(iso: string) {
	return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(iso: string) {
	return new Date(iso).toLocaleDateString(LOCALE, {
		weekday: 'short',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	})
}

export function sameDay(aIso: string, bIso: string) {
	const a = new Date(aIso)
	const b = new Date(bIso)
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	)
}

export function formatTimestamp(iso: string) {
	return sameDay(iso, new Date().toISOString())
		? `Сегодня в ${formatTime(iso)}`
		: `${new Date(iso).toLocaleDateString(LOCALE)} ${formatTime(iso)}`
}

// date only, e.g. '2026-07-04' → "4 июля 2026 г."
export function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(LOCALE, {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	})
}

// duration as m:ss — e.g. 67 → "1:07"
export function formatDuration(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const mins = Math.floor(total / 60)
	const secs = total % 60
	return `${mins}:${secs.toString().padStart(2, '0')}`
}
