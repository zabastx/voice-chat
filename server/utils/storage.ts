import { AwsClient } from 'aws4fetch'

// S3-compatible object storage for attachments (path-style URLs, works with any
// provider that hands out endpoint + bucket + key/secret). aws4fetch signs plain
// fetch requests, so the same code runs on the Node dev server and Bun in prod.

let client: AwsClient | undefined

function s3Config() {
	const config = useRuntimeConfig()
	return {
		endpoint: config.s3Endpoint.replace(/\/+$/, ''),
		bucket: config.s3Bucket,
		region: config.s3Region || 'us-east-1',
		accessKeyId: config.s3AccessKeyId,
		secretAccessKey: config.s3SecretAccessKey
	}
}

export function s3Configured() {
	const config = s3Config()
	return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey)
}

function s3Client() {
	if (!client) {
		const config = s3Config()
		client = new AwsClient({
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			region: config.region,
			service: 's3'
		})
	}
	return client
}

function objectUrl(objectKey: string) {
	const config = s3Config()
	const encoded = objectKey.split('/').map(encodeURIComponent).join('/')
	return `${config.endpoint}/${config.bucket}/${encoded}`
}

export async function putObject(objectKey: string, body: Uint8Array, contentType: string) {
	// copy into a plain ArrayBuffer-backed view: Buffer slices into shared pools,
	// and fetch typings reject Uint8Array<ArrayBufferLike> as BodyInit
	const bytes = new Uint8Array(body.byteLength)
	bytes.set(body)
	const res = await s3Client().fetch(objectUrl(objectKey), {
		method: 'PUT',
		body: bytes,
		headers: { 'content-type': contentType }
	})
	if (!res.ok) {
		throw createError({
			statusCode: 502,
			message: `Не удалось загрузить файл в хранилище (${res.status})`
		})
	}
}

export async function getObject(objectKey: string) {
	// Server-to-S3 signed GET (auth in headers, not query). Used to proxy bytes
	// through the app for clients that read the body in JS and would otherwise
	// hit a cross-origin CORS wall on the presigned URL.
	return s3Client().fetch(objectUrl(objectKey), { method: 'GET' })
}

export async function presignGetUrl(objectKey: string, expiresSeconds = 300) {
	const url = new URL(objectUrl(objectKey))
	url.searchParams.set('X-Amz-Expires', String(expiresSeconds))
	const signed = await s3Client().sign(new Request(url, { method: 'GET' }), {
		aws: { signQuery: true }
	})
	return signed.url
}

export async function deleteAttachmentObjects(objectKeys: string[]) {
	if (!s3Configured() || objectKeys.length === 0) return
	await Promise.allSettled(
		objectKeys.map((key) => s3Client().fetch(objectUrl(key), { method: 'DELETE' }))
	)
}
