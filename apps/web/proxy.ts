export { auth as proxy } from '@/lib/services/auth'

export const config = {
  matcher: ['/cabinet/:path*'],
}
