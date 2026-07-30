# 0008 — Watch Together syncs local embeds; video never touches the SFU

Date: 2026-07-30
Status: accepted

## Context

Members want to watch a YouTube video or a Twitch stream together inside a Voice Channel,
while talking over it.

A crude version already works today: [ADR 0001](0001-self-hosted-livekit-sfu.md) put a
self-hosted LiveKit SFU in place for Screen Share, and `setScreenShareEnabled(true, { audio: true })`
in [useVoice.ts](../../app/composables/useVoice.ts) already carries tab audio. One member shares a
browser tab and everyone sees the film. That baseline is the thing any new feature has to beat,
and it has three real defects: every viewer is stuck with the sharer's ads, resolution and
subtitle choices; the sharer's uplink carries the whole room; and the re-encode costs quality
twice over.

Because the SFU is already there and already solves "many people see one video", the obvious
move is to push the film through it too. This ADR records why we do not.

## Options considered

1. **Relay the source into LiveKit.** A server-side ingest (`yt-dlp` + `ffmpeg` → LiveKit
   ingress) pulls the stream once and republishes it as an ordinary track. Perfectly
   frame-synced, source-agnostic, no third-party JS in the client. Rejected: it puts a
   continuous transcode plus the full outbound fan-out on a single rented VPS that also runs
   Postgres, Caddy and the SFU; it needs an entirely new service in the deploy stack; and it is
   squarely against YouTube's and Twitch's terms. The cost lands on the machine that can least
   afford it, in exchange for sync precision nobody watching a film will notice.
2. **Keep polishing Screen Share.** No new feature; add a "share tab audio" hint and a
   video-friendly quality preset. Cheapest, but leaves all three defects above untouched.
3. **Sync local embeds.** Every client renders its own YouTube IFrame Player / Twitch Embed;
   the server ships only a shared _playback intent_. Chosen.

## Decision

A **Watch Session** is shared _intent_, not media. The server stores, per Voice Channel, at most
one `{ source, ref, paused, position }` and broadcasts it; each client renders its own embed and
steers it to match. No video or audio bytes cross the VPS.

Consequences of that one choice, in the order they bite:

- **Server cost is zero and constant.** Bandwidth and CPU do not scale with viewers, resolution
  or runtime. This is the entire point.
- **Per-viewer quality, subtitles and volume are free**, because each viewer owns a real player.
- **Sync is approximate, and that is deliberate.** The state is a _Playback Anchor_ — a position
  resolved at the moment of sending, never a ticking counter. Clients compute the expected
  position forward from arrival and hard-seek when they are more than ~2s off. Nobody ever waits
  for the slowest viewer: a buffering client or one sitting through a pre-roll ad simply snaps
  forward when it recovers. Lockstep readiness was rejected — on a five-person friend group it
  means one bad connection freezes the film for everyone.
- **Correcting drift and broadcasting a seek must never be the same code path.** Keeping native
  player controls means a viewer's scrub and a viewer's drift are the _same observation_ — a
  playhead that disagrees with the anchor — so no threshold can tell them apart. The
  discriminator is time, not position: ordinary playback advances by roughly the elapsed wall
  clock, and a seek is a jump that doesn't. Only the jump is broadcast. Get this wrong in the
  obvious direction and one viewer's ad break drags everyone else backwards, which is the exact
  opposite of the guarantee above.
- **The anchor crosses the wire resolved, so client clock skew cannot poison it.** The server
  keeps `anchoredAt` internally on its own clock, but the DTO carries only the position as of
  send time; the client re-anchors on its own `performance.now()`. Comparing a server timestamp
  against a client `Date.now()` would turn an 8-second-wrong device clock into a permanent
  3-second seek loop on one machine and nowhere else — the correction loop becomes a destruction
  loop, and it is miserable to diagnose remotely.
- **DRM sources are permanently out of reach.** Netflix, Kinopoisk and friends cannot be
  embedded, ever. Screen Share stays as the answer for those, for local files, and for anything
  else with a picture. Watch Together is not its replacement.
- **We inherit each provider's failure modes.** An uploader can disable embedding outright;
  Twitch embeds demand a `parent` matching the page host; ads desync one viewer by ~30s. Each
  needs its own Russian-language failure state rather than a blank frame.

## Scope as built (v0.18.0)

YouTube only: ordinary videos, Shorts and live broadcasts. All three resolve to the same
embeddable video id, so the URL parser is the only place the difference shows up. Twitch is
deferred — the sync layer is source-agnostic and the DTO already carries a `source` field, so
adding it does not reshape anything here.

**A Live Broadcast is not synced on a timeline.** Every viewer rides the live edge, so only the
paused flag travels and drift correction is disabled outright — seeking to an anchor position
inside a DVR window would scatter viewers rather than align them.

The catch is detecting it. The server cannot know whether a video id is live without the YouTube
Data API (an API key, a quota, and a second failure mode), so the client reports it instead:
whichever player loads first posts `{ live, title }` back and the server corrects the session.
Two consequences worth knowing before debugging this:

- The signal is `player.getVideoData().isLive`, which is **undocumented** and absent from
  `@types/youtube`. If YouTube ever drops it, live sessions silently degrade to being treated as
  VODs — viewers would fight the DVR window instead of failing loudly. That is the cheap failure
  direction, but it is not an obvious one.
- **"Not live" and "not loaded yet" are the same observation**, so only positives are reported and
  the server latches the flag on. Honouring a negative would flip a live session back to VOD every
  time somebody joined, unfreezing a standing-still anchor and scattering the room.
- A session is born `live: false`, so clients track live-ness as _unknown_ until their own player
  settles it and enforce no position at all until then. Guessing "VOD" during that window seeks a
  live viewer to the start of the DVR buffer — and since drift correction switches off the moment
  the flag lands, they would be stranded there for good.

## The player outlives the page it appears on

Because the iframe cannot be moved or unmounted without restarting the video, the player is **not**
owned by the voice channel page. It is mounted once in the layout, outside `<NuxtPage>`
([WatchPlayerHost.vue](../../app/components/WatchPlayerHost.vue)), and only its CSS position and
size change: docked over a placeholder that `ChannelVoice` registers, or a floating mini player
anywhere else. Opening a text channel therefore leaves playback untouched, which is the whole
point — a member who steps into chat for ten seconds should not drop out of the film and have to be
re-synced.

This is the inverse of how it looks like it should work. The intuitive implementation — render the
stage in the page, and move it into a corner widget when you navigate away — is precisely the one
that cannot work, and neither can `<KeepAlive>`, which detaches the subtree from the document and
destroys the browsing context just as thoroughly.

Consequences worth knowing:

- The mini player has **no close button**. The Audience is the Voice Channel roster, so "stop
  watching, just for me" is not representable: a member who dismissed it would still be in the
  Audience. It appears while a session is running and you are elsewhere, and disappears when the
  watch stops or you leave voice. Clicking it navigates back to the channel.
- Its transparent overlay deliberately swallows clicks on YouTube's own controls. A 320px player
  is too small to aim at them, and the room's controls live in the call view the click returns to.
- Tracking the docked box needs an rAF loop, not a `ResizeObserver`: collapsing the sidebar moves
  the stage without resizing it.

## Related

Companion decision in [ADR 0009](0009-watch-session-in-memory-anyone-controls.md): where the
session lives and who may drive it.
