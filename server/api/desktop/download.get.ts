// The public Desktop Download (CONTEXT.md): the Release a Member without the
// Desktop Client is offered, as `DesktopDownloadDto`. Reachable before Sign-in
// on purpose — the login and register pages offer it too, and the Release is
// public on GitHub anyway. `204` = nothing to offer, `503` = GitHub unreachable
// and nothing cached, exactly as the update route answers.

export default defineEventHandler(() => useDesktopUpdateFeed().respondDownload())
