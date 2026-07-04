# 0003 — Per-speaker volume/mute is client-side only, persisted per-device

Date: 2026-07-04
Status: accepted

## Context

Members want Discord-style control over how loud each other person is in a Voice
Channel — including silencing one annoying/loud speaker — reachable by right-clicking a
participant (in both the sidebar roster and the call-view tiles).

Two broad shapes exist: enforce the change on the server/SFU (a real force-mute that affects
what everyone hears, or that the speaker is told about), or apply it only in the listener's
own browser (a playback preference). Discord's right-click "User Volume" and "local mute" are
the latter.

## Options considered

1. **Server/admin force-mute** — the SFU stops relaying the speaker's audio, or the speaker is
   notified. Powerful, but it's a moderation feature (who may silence whom?), needs backend +
   WS plumbing, and is not what "let me turn down this one friend" asks for. Out of scope.
2. **Client-side, session-only** — adjust playback locally, reset every join. No stale state,
   but you re-mute the loud friend every call. Rejected as annoying.
3. **Client-side, persisted per-device** — adjust playback locally and remember it. Matches
   Discord; the loud friend stays turned down across rejoins and reloads. Chosen.

## Decision

Local Volume and Local Mute are purely client-side playback preferences. They call
`RemoteParticipant.setVolume(v)` on the local LiveKit room (0.0–2.0; effective value is
`muted ? 0 : volume`) and are **never** sent to the server or other Members.

State persists in `usePreferences` (localStorage) as a sparse map keyed by the speaker's
Member id: `{ [memberId]: { volume, muted } }`. No entry is written until the listener actually
moves the slider or toggles mute; absence means the 100% default.

LiveKit's per-participant volume lives on the `Room` instance and is lost on leave, so on each
join `useVoice` re-applies the stored map as remote audio tracks subscribe — otherwise
persistence would silently not take effect on rejoin.

The control surface is a right-click `UContextMenu` on other **connected** participants only
(the listener must be in that Voice Channel to have the audio locally; never on the listener's
own row, and not on Screen-Share tiles for v1). The menu holds a live `Громкость` slider
(`content-top` slot) plus a `Заглушить` / `Включить звук` toggle. A `i-lucide-volume-x`
indicator marks a locally-muted speaker, distinct from the existing `i-lucide-mic-off`
(Self-Mute).

## Consequences

- No backend, WS, or DB work; nothing to authorize. A listener can only change their own ears.
- Preferences are per-device (localStorage), so the same user on another browser starts fresh —
  acceptable, consistent with the existing device-scoped prefs (mic/speaker/camera ids).
- A persisted Local Mute can outlive the listener's memory of setting it; the on-tile/on-row
  `volume-x` indicator is the required antidote to "why can't I hear them?".
- Screen-Share audio stays at full volume for now; a second per-source control can be added
  later if it proves necessary.
- Boost above 100% is real gain and can clip a hot mic; accepted as the price of rescuing a
  too-quiet speaker (Discord makes the same trade).
