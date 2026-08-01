'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { TelegramLoginButton } from '@/components/telegram-login-button'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, useRegisterOrganizer, useSignInWithTicket } from '@/lib/api'
import { TIMEZONES } from '@/lib/constants/timezones'
import { cn } from '@/lib/utils'

const steps = ['Telegram', 'Profile'] as const

const FALLBACK_TIMEZONE = 'Europe/Belgrade'

/**
 * Pre-select the visitor's own timezone when we offer it.
 *
 * The browser can report a zone that is not in `TIMEZONES` (the list is a
 * curated subset), and an unlisted value would leave the `Select` blank with no
 * hint that anything is wrong — so an unknown zone falls back to a listed one.
 */
function detectTimezone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONES.some((tz) => tz.value === detected) ? detected : FALLBACK_TIMEZONE
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [step, setStep] = useState(0)
  const [ticket, setTicket] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  // Lazy initialiser: `Intl` is read once on mount, not on every render.
  const [timezone, setTimezone] = useState(detectTimezone)

  const registerOrganizer = useRegisterOrganizer()
  const signIn = useSignInWithTicket()

  // If redirected from login with a ticket already (SIGNUP_REQUIRED flow), skip step 0.
  useEffect(() => {
    const t = searchParams.get('ticket')
    if (t) {
      setTicket(t)
      setStep(1)
    }
  }, [searchParams])

  const pending = registerOrganizer.isPending || signIn.isPending
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    try {
      await registerOrganizer.mutateAsync({
        ticket,
        slug,
        name,
        timezone,
      })
      await signIn.mutateAsync(ticket)
      router.push('/cabinet/settings')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Ticket expired mid-registration — restart Telegram auth.
        toast.error(error.message)
        setStep(0)
        setTicket('')
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not create the account')
      }
    }
  }

  return (
    <AuthShell
      title="Create your account"
      description="Set up your organizer profile in two quick steps."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <ol className="mb-6 flex items-center justify-center gap-2">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-xs font-medium',
                i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                i <= step ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 ? <span className="h-px w-4 bg-border" /> : null}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col items-center gap-4">
          {botUsername ? (
            <>
              <TelegramLoginButton
                botUsername={botUsername}
                buttonSize="large"
                mode="signup"
                onTicketIssued={(t, organizerExists) => {
                  if (organizerExists) {
                    toast.info('Account already exists. Signing you in…')
                    signIn.mutateAsync(t).then(() => {
                      router.push('/cabinet')
                      router.refresh()
                    })
                    return
                  }
                  setTicket(t)
                  setStep(1)
                }}
              />
              <p className="text-center text-sm text-muted-foreground">
                Authenticate with Telegram to continue.
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-destructive">
              Telegram login is not configured. Please contact support.
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleCreateAccount}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Display name</FieldLabel>
              <Input
                id="name"
                placeholder="Studio Lumen"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">Public handle</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>countmein.group/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="slug"
                  placeholder="studio-lumen"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  required
                />
              </InputGroup>
              <FieldDescription>This is the link you&apos;ll share with guests.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>All your time slots are shown in this zone.</FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Creating account…' : 'Continue'}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupPageInner />
    </Suspense>
  )
}
