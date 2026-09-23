/**
 * Paths the server answers itself. The PWA's navigation fallback must skip
 * them, or the service worker hands the app shell back for /auth/github and
 * the GitHub redirect never happens (seen in production).
 */
export const SERVER_ROUTES = [/^\/api/, /^\/auth/, /^\/pair/, /^\/ws/, /^\/runner/];

export const isServerRoute = (path: string) => SERVER_ROUTES.some((re) => re.test(path));
