const publicPaths = ['/login', '/register']

export default defineNuxtRouteMiddleware((to) => {
	const { loggedIn } = useUserSession()
	if (!loggedIn.value && !publicPaths.includes(to.path)) {
		return navigateTo('/login')
	}
	if (loggedIn.value && publicPaths.includes(to.path)) {
		return navigateTo('/')
	}
})
