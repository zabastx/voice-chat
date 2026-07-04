import type { H3Event } from 'h3'

// readMultipartFormData buffers the whole body in RAM before any size check
// can run, so the Content-Length header is the only pre-read guard. A chunked
// request has no Content-Length and would bypass the cap entirely — reject it
// (browsers always declare a length for FormData uploads).
export function requireDeclaredBodySize(event: H3Event, maxBytes: number, tooBigMessage: string) {
	const header = getHeader(event, 'content-length')
	const contentLength = Number(header)
	if (!header || !Number.isFinite(contentLength)) {
		throw createError({ statusCode: 411, message: 'Не указан размер файла' })
	}
	if (contentLength > maxBytes + 1024 * 1024) {
		throw createError({ statusCode: 413, message: tooBigMessage })
	}
}
