# 0002 — Privileged endpoints authorize against the DB, not the session cookie

Date: 2026-07-04
Status: accepted

## Context

Sessions are stateless sealed cookies (nuxt-auth-utils); the user object — including the
role — is baked in at login and cannot be revoked or rewritten server-side without a request
from that user. With the Moderator role, roles now change at runtime: the Admin promotes and
demotes Members while their sessions are live.

If guards trusted the cookie, a demoted Moderator would keep moderator powers until their
cookie expired or they logged in again — an unbounded window. Promotion would likewise not
take effect until re-login.

## Options considered

1. **Trust the cookie, require re-login on role change** — zero extra reads, but demotion is
   not enforceable and the UX of "you were promoted, please log out" is poor. Rejected.
2. **Server-side session store** — makes sessions revocable/rewritable but replaces the whole
   nuxt-auth-utils cookie model with new state and infrastructure. Disproportionate.
3. **Re-check the role from the DB inside privileged guards** — the cookie proves identity,
   the `members.role` column is the authority. One extra SQLite point query per privileged
   request. Chosen.

## Decision

`requireRole(event, min)` in `server/utils/auth.ts` reads the member row on every privileged
request and compares ranks (`member < moderator < admin`). The role inside the session cookie
is used only for UI gating on the client; `POST /api/auth/refresh` re-seals it when the client
notices its own role changed (via the `member.updated` WS event) so the UI stays honest.

## Consequences

- Demotion takes effect on the demoted user's next privileged request; promotion works
  without re-login.
- Every privileged endpoint pays one extra SQLite point query — negligible at this scale
  (the session-revalidation middleware already does a per-request member lookup).
- A deleted member's still-valid cookie is rejected on privileged routes even without the
  middleware (defense in depth).
- The cookie's `role` field can be stale; nothing on the server may ever authorize against
  it. New privileged endpoints must use `requireRole`, not the session user.
