// The Desktop Download (CONTEXT.md): the Release a Member without the Desktop
// Client is offered — always the one the Desktop Update feed would offer. Kept
// out of dto.ts because the feed, and so its tests, import it outside Nuxt.
export interface DesktopDownloadDto {
	version: string
	setupUrl: string
	portableUrl: string
	releaseUrl: string
}
