import { auth as proxy } from '@/lib/services/auth'

export { proxy }

export const config = {
  matcher: ['/cabinet/:path*', '/login', '/signup'],
}
