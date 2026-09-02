import type { Role } from './dto'

// Shape of the sealed session cookie. `user` is what the browser reads via
// useUserSession(); the rest is bookkeeping the server needs to decide whether
// a Sign-in is still valid and whether it is due to be rolled forward.
declare module '#auth-utils' {
	interface User {
		id: string
		username: string
		role: Role
	}

	// All three are OPTIONAL on purpose: a cookie sealed before docs/adr/0012
	// carries none of them, and rejecting those cookies is the whole point of the
	// epoch check. Declaring them required would make `undefined` unrepresentable
	// in the one case the code exists to handle.
	interface UserSession {
		// the member's Sign-in Epoch at the moment this cookie was sealed; the
		// session-member middleware rejects the cookie once the DB moves past it
		signInEpoch?: number
		// «запомнить меня» was ticked — the cookie was written with an expiry and
		// is eligible to roll forward. An unremembered Sign-in is a browser-session
		// cookie and must never be renewed into a persistent one.
		remembered?: boolean
		// when this cookie was sealed, in epoch ms. h3 keeps its own `createdAt` on
		// the session but does not expose it through getUserSession() — and pins it
		// to the first cookie the browser ever got — so age is tracked here instead.
		issuedAt?: number
	}
}

export {}
