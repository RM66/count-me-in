'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
import { SITE_DOMAIN } from '@/constants/site'
import { TIMEZONES } from '@/constants/timezones'
import { cn } from '@/lib/utils'

function SignupPageInner() {
  const t = useTranslations('Auth.signup')
  const form = useSignupForm()
  // Lazy initialiser: `Intl` is read once on mount, not on every render.
  const [timezone, setTimezone] = useState(() => detectTimezone(TIMEZONES))

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  const steps = [t('stepTelegram'), t('stepProfile')]

  return (
    <AuthShell
      title={t('title')}
      description={t('description')}
      footer={
        <>
          {t('alreadyHave')}{' '}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            {t('logIn')}
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
                onTicketIssued={(ticketValue, organizerExists) => {
                  if (organizerExists) {
                    toast.info(t('accountExists'))
                    form.signIn.mutateAsync(ticketValue).then(() => {
                      form.router.push('/cabinet')
                      form.router.refresh()
                    })
                    return
                  }
                  form.setTicket(ticketValue)
                  form.setStep(1)
                }}
              />
              <p className="text-center text-sm text-muted-foreground">{t('authenticate')}</p>
            </>
          ) : (
            <p className="text-center text-sm text-destructive">{t('notConfigured')}</p>
          )}
        </div>
      )}

      {form.step === 1 && (
        <form onSubmit={(e) => form.handleCreateAccount(e, timezone)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">{t('displayName')}</FieldLabel>
              <Input
                id="name"
                placeholder={t('namePlaceholder')}
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">{t('publicHandle')}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{SITE_DOMAIN}/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="slug"
                  placeholder={t('slugPlaceholder')}
                  value={form.slug}
                  onChange={(e) => form.setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  required
                />
              </InputGroup>
              <FieldDescription>{t('slugHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="timezone">{t('timezone')}</FieldLabel>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue placeholder={t('selectTimezone')} />
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
              <FieldDescription>{t('timezoneHint')}</FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={form.pending}>
              {form.pending ? t('creating') : t('continue')}
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
