// «Выйти со всех устройств». Bumping the Sign-in Epoch invalidates every cookie
// this member holds — including the one making this request, which is the
// point: the predictable reading of "all devices" is that it includes this one.
// The client is left signed out and bounces to /login.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	await bumpSignInEpoch(user.id)
	await clearUserSession(event)
	return { ok: true }
})
