'use client'

import Link from 'next/link'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { detectTimezone, useSignupForm } from '@/app/(auth)/signup/_components/use-signup-form'
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
import { TIMEZONES } from '@/lib/constants/timezones'
import { cn } from '@/lib/utils'

const steps = ['Telegram', 'Profile'] as const

function SignupPageInner() {
  const form = useSignupForm()
  // Lazy initialiser: `Intl` is read once on mount, not on every render.
  const [timezone, setTimezone] = useState(() => detectTimezone(TIMEZONES))

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

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
                i <= form.step
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                i <= form.step ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 ? <span className="h-px w-4 bg-border" /> : null}
          </li>
        ))}
      </ol>

      {form.step === 0 && (
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
                    form.signIn.mutateAsync(t).then(() => {
                      form.router.push('/cabinet')
                      form.router.refresh()
                    })
                    return
                  }
                  form.setTicket(t)
                  form.setStep(1)
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

      {form.step === 1 && (
        <form onSubmit={(e) => form.handleCreateAccount(e, timezone)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Display name</FieldLabel>
              <Input
                id="name"
                placeholder="Studio Lumen"
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
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
                  value={form.slug}
                  onChange={(e) => form.setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  required
                />
              </InputGroup>
              <FieldDescription>This is the link you&rsquo;ll share with guests.</FieldDescription>
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
            <Button type="submit" className="w-full" disabled={form.pending}>
              {form.pending ? 'Creating account…' : 'Continue'}
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
