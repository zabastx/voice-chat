import * as z from 'zod'

export const usernameSchema = z
	.string()
	.trim()
	.regex(/^[\p{L}\p{N}_-]{2,24}$/u, 'Имя: 2–24 символа — буквы, цифры, _ или -')

export const passwordSchema = z.string().min(8, 'Пароль должен быть не короче 8 символов')

export const channelNameSchema = z
	.string()
	.trim()
	.min(1, 'Введите название')
	.max(32, 'Не длиннее 32 символов')
	.transform((name) => name.toLowerCase().replace(/\s+/g, '-'))
