// User-facing changelog ("Что нового"). This file IS the changelog record.
// Per release: bump `version` in package.json AND prepend an entry here (same commit).
// The current version comes from package.json (runtimeConfig.public.appVersion), NOT this file.
export interface ChangelogEntry {
	version: string // matches package.json at release time, e.g. '0.2.0'
	date: string // ISO 'YYYY-MM-DD'
	title?: string // optional short heading (Russian)
	changes: string[] // Russian bullet points
}

// newest first
export const changelog: ChangelogEntry[] = [
	{
		version: '0.2.0',
		date: '2026-07-04',
		title: 'Голосовые сообщения и вложения',
		changes: [
			'Записывайте и отправляйте голосовые сообщения прямо в чате',
			'Предпросмотр картинок и файлов перед отправкой',
			'Настройки профиля, устройств и уведомлений в одном окне'
		]
	},
	{
		version: '0.1.0',
		date: '2026-06-30',
		title: 'Первый релиз',
		changes: [
			'Текстовые и голосовые каналы с демонстрацией экрана',
			'История сообщений, редактирование и удаление, вложения',
			'Приглашения по одноразовым ссылкам',
			'Установка как приложение (PWA) и звуковые уведомления'
		]
	}
]
