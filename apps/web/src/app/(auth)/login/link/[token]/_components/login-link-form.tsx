'use client'

import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * Auto-submitting form for the one-time login link.
 *
 * The whole reason this is a form and not a redirect: the token must be spent
 * by a **`POST`**. Link previewers (Telegram's own crawler among them) and
 * corporate scanners issue `GET`s for any URL they see, and a single-use token
 * consumed on `GET` would be gone before the organizer taps it.
 *
 * The visible button is the no-JS fallback — with scripting disabled the
 * organizer completes the same `POST` by hand rather than being stranded.
 */
export function LoginLinkForm({ action }: { action: () => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.requestSubmit()
  }, [])

  return (
    <form ref={formRef} action={action} className="flex flex-col items-center gap-4">
      <Spinner className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-center text-sm text-muted-foreground">
        One moment while we open your cabinet.
      </p>
      <noscript>
        <Button type="submit">Continue to your cabinet</Button>
      </noscript>
    </form>
  )
}
