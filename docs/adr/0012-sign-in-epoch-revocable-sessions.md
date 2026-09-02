# 0012 — A per-Member Sign-in Epoch makes sealed sessions revocable

Date: 2026-09-02
Status: accepted — implemented 2026-09-02 (v0.23.0)

## Context

Until now no Sign-in survived closing the browser. Nothing set `session.maxAge`, so h3 issued a
plain session cookie; Chrome's "continue where you left off" masked this often enough that it read
as flaky rather than as a missing feature. The ask was «запомнить меня» — stay signed in
indefinitely.

Two facts shape what "indefinitely" can mean.

First, it is not reachable by an expiry date: Chrome and Safari clamp a cookie's `Max-Age` to 400
days. Indefinite has to mean _renew-on-use_ — an active Sign-in is re-issued so its window rolls
forward, and only a genuine absence ends it.

Second, and the reason this is an ADR: a long-lived sealed cookie is a long-lived _unrecallable_
credential. [adr/0002](0002-db-checked-role-guards.md) is built on exactly that limitation — it
re-reads the role from the DB on every privileged request precisely because the cookie cannot be
rewritten or taken back. Stretching the cookie's life from "until you close the browser" to 400 days
stretches that hole to the same length. A lost phone, a shared laptop, or a member leaving the group
would each have had no remedy short of rotating `NUXT_SESSION_PASSWORD`, which signs out everybody.
Changing a password — the instinctive response to "someone knows my password" — would not have ended
a single session opened with the old one.

So persistence had to arrive together with revocation, not before it.

## Options considered

1. **Long cookie, no revocation.** ~20 lines: set `maxAge` and write the checkbox. Leaves every
   remedy above unavailable for up to 400 days and makes `me/password.post.ts` a placebo. Rejected —
   the property being added is precisely what makes its absence dangerous.
2. **A `sessions` table, one row per device.** Fully revocable, and it enables a device list
   ("Chrome on Windows, last seen 2 days ago") and per-device sign-out. But it is new state on the
   request path, needs sweeping, and buys per-device granularity that a five-person private server
   has no use for. Rejected as disproportionate — the same reasoning that rejected option 2 in
   adr/0002.
3. **A single integer per member — the Sign-in Epoch.** The cookie records the epoch it was sealed
   under; the request path compares it against the member's current value. Bumping it ends every
   Sign-in that member holds, at once, and nobody else's. No new table, no sweeping, no per-request
   cost. Chosen.

Option 3's decisive advantage here is that it is _free_: `server/middleware/session-member.ts`
already read the member row on every authed `/api/**` request (to reject deleted members), so the
check is one more column on a query that was happening anyway. Option 2's cost is a new table;
option 3's is a comparison.

## Decision

`members.sign_in_epoch` (integer, default 0). The session cookie carries `signInEpoch`, `remembered`
and `issuedAt`; `session-member.ts` rejects any cookie whose epoch differs from the member's row
with a 401, and re-issues a `remembered` Sign-in once it passes 7 days old.

The rolling expiry is written by `issueSignIn` as an explicit `cookie.expires`, and
`runtimeConfig.session.maxAge` is a long seal backstop rather than the window itself. This is not
decoration: h3 pins `session.createdAt` to the first cookie a browser ever received and restores it
on every re-seal, so a window derived from it never actually rolls (GOTCHAS #24). All three session
fields are optional in the type, because a pre-0012 cookie carries none of them and rejecting those
is the point.

The epoch is bumped by: the member's own password change, an admin password reset, and «выйти со
всех устройств» (both the member's own, in Настройки → Профиль, and the admin cutoff in
ManageModal). Deleting a member needs no bump — the row goes, and the middleware's existing
member-missing branch covers it. Every bump also calls `wsDisconnectMember`, because a WebSocket is
authed once at connect and a revoked device that keeps _receiving_ messages defeats the point.

**Role changes deliberately do not bump it.** adr/0002 already makes them take effect on the next
request without touching the cookie, and logging a demoted moderator out mid-conversation is a
louder signal than the change warrants.

`remembered: false` is the opt-out: the cookie is written without an expiry attribute
(`maxAge: 0`) and dies with the browser, exactly as every Sign-in did before this change. Renewal
skips those, or it would quietly grant the persistence the member declined.

## Consequences

- Revocation is immediate and total per member; it is not per-device. "Sign out my old phone but
  keep this laptop" is not expressible — that is option 2, and it remains available later without
  changing the cookie shape.
- Every cookie sealed before this change is rejected once, because it carries no epoch at all.
  Grandfathering them would have left a permanently unrevocable population, which is the exact thing
  this ADR exists to remove. The cost is one extra sign-in, and it is small precisely because
  sessions did not survive a browser restart before.
- This partly overturns adr/0002's premise. Cookies are now revocable _in bulk_, so a future guard
  could in principle trust the cookie's role between epoch bumps. It still must not: the epoch moves
  only on the events listed above, and a role change is not one of them. adr/0002's rule stands
  unchanged.
- `/api/auth/*` is skipped by the middleware, so `refresh.post.ts` carries its own copy of the epoch
  check. Without it, that route would re-seal a revoked cookie under the current epoch and hand a
  signed-out device its access back. Any future route added under `/api/auth/` that re-seals a
  session must do the same.
- "Indefinitely" is 400 days of inactivity, not forever, and no code change can raise that.
