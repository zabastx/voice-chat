// Downscaled WebP previews for in-chat image display. sharp is a native module,
// dynamically imported so it never leaks into the client/SSR bundle and only
// loads on the server (Node in dev, Bun in prod — both run the same libvips).

// longest edge of the preview, in px. ~2x the current in-chat display height
// (max-h-72 ≈ 288px) so it stays crisp on retina.
const PREVIEW_MAX_EDGE = 640
const PREVIEW_QUALITY = 75

// Only still raster formats get a preview. gif would lose its animation and svg
// is already tiny/vector — both fall back to serving the original.
function isPreviewable(mime: string) {
	const base = mime.split(';')[0]?.trim()
	return base?.startsWith('image/') && base !== 'image/gif' && base !== 'image/svg+xml'
}

// Returns a WebP preview, or null when no preview should be stored (unsupported
// type, sharp failure, or the preview came out no smaller than the original).
// Never throws — a broken image must not fail the upload.
export async function generateImagePreview(
	bytes: Uint8Array,
	mime: string
): Promise<Uint8Array | null> {
	if (!isPreviewable(mime)) return null
	try {
		const { default: sharp } = await import('sharp')
		const webp = await sharp(bytes)
			.rotate() // bake in EXIF orientation so previews aren't sideways
			.resize({
				width: PREVIEW_MAX_EDGE,
				height: PREVIEW_MAX_EDGE,
				fit: 'inside',
				withoutEnlargement: true
			})
			.webp({ quality: PREVIEW_QUALITY })
			.toBuffer()
		// pointless to store a "preview" that's larger than the source
		if (webp.byteLength >= bytes.byteLength) return null
		return webp
	} catch (err) {
		console.error('image preview generation failed', err)
		return null
	}
}
