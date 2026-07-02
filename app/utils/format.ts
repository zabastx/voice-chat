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
