import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface User {
    /** Organizer public slug (`countmein.group/{slug}`). */
    slug?: string
  }

  interface Session {
    user: DefaultSession['user'] & {
      /** Organizer id (= Auth.js user id, ADR-005). */
      id: string
      slug?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    slug?: string
  }
}
