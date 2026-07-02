# 0001 — Self-hosted LiveKit as the media server

Date: 2026-07-02
Status: accepted

## Context

The app needs voice channels for 2–5 concurrent participants **and screen sharing** (streaming a game/screen to the rest of the call). It deploys via docker compose to a single rented VPS with a domain.

With plain WebRTC peer-to-peer mesh, every publisher uploads its media separately to every other peer. For audio at this scale that is fine, but a screen share at ~4 Mbps with 3–4 viewers requires 12–16 Mbps of sustained upstream from a residential connection — unrealistic. Screen sharing therefore forces a media relay (SFU) that receives each track once and fans it out.

## Options considered

1. **Plain WebRTC mesh** — zero server infrastructure, but screen share upload cost lands on the streamer's home connection. Rejected: breaks the headline feature.
2. **mediasoup** — a Node.js SFU _library_; we would write and operate our own SFU server (transports, producers, consumers, reconnection). Maximum control, substantial WebRTC expertise and code to own. Rejected: effort disproportionate for a 5-person deployment.
3. **LiveKit OSS, self-hosted** — a complete SFU server (single Go binary, official docker image) with built-in TURN, plus mature client/server SDKs: `livekit-client` handles devices, tracks, screen capture, reconnection; `livekit-server-sdk` mints JWT access tokens. Chosen.

## Decision

Run the open-source LiveKit server as a container in the docker compose stack. The Nuxt server is the sole token authority: it mints short-lived LiveKit access tokens for authenticated Members, with the LiveKit room named after the Voice Channel. LiveKit webhooks feed Voice State back to the app for the sidebar roster.

## Consequences

- The browser media path (join/leave, mute, screen share, speaking indicators) is written against the LiveKit SDK — replacing the media server later means rewriting that layer.
- The VPS must expose LiveKit's RTC ports (UDP range, TURN fallback) alongside HTTPS; deployment docs carry firewall requirements.
- Voice quality/scale ceiling is far above our needs; no architectural pressure at 2–5 users.
- API key/secret shared between the app and LiveKit becomes deployment-critical config.
