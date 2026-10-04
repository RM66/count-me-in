'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { useController } from 'react-hook-form'
import { toast } from 'sonner'

import { errorMessage } from '@/api-client'
import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { useSignupForm } from '@/app/(auth)/signup/_components/use-signup-form'
import { TelegramLoginButton } from '@/components/telegram-login-button'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { timezoneLabel, TIMEZONES } from '@/constants/timezones'
import { cn } from '@/lib/utils'

function SignupPageInner() {
  const t = useTranslations('Auth.signup')
  const locale = useLocale()
  const form = useSignupForm()

  // Field state lives in the RHF instance (signupFormSchema); controllers are
  // for the controls that transform on input (slug) or are not plain inputs
  // (timezone Select).
  const slugField = useController({ control: form.form.control, name: 'slug' })
  const timezoneField = useController({ control: form.form.control, name: 'timezone' })
  const { errors } = form.form.formState

  // A detected zone missing from the curated list is still pre-selected —
  // offer it alongside so the Select is never blank (detectTimezone). `''`
  // (before the mount effect fills the browser zone) is not a SelectItem —
  // Radix forbids an empty option value.
  const timezone = timezoneField.field.value
  const timezoneOptions =
    timezone && !TIMEZONES.includes(timezone) ? [timezone, ...TIMEZONES] : TIMEZONES

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
                    form.signIn
                      .mutateAsync(ticketValue)
                      .then(() => {
                        form.router.push('/cabinet')
                        form.router.refresh()
                      })
                      .catch((error: unknown) =>
                        toast.error(errorMessage(error, t('signInFailed'))),
                      )
                    return
                  }
                  form.setTicket(ticketValue)
                  form.setStep(1)
                }}
                onError={() => toast.error(t('signInFailed'))}
              />
              <p className="text-center text-sm text-muted-foreground">{t('authenticate')}</p>
            </>
          ) : (
            <p className="text-center text-sm text-destructive">{t('notConfigured')}</p>
          )}
        </div>
      )}

      {form.step === 1 && (
        <form onSubmit={form.submit} noValidate>
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="name">{t('displayName')}</FieldLabel>
              <Input
                id="name"
                placeholder={t('namePlaceholder')}
                {...form.form.register('name')}
                aria-invalid={errors.name ? true : undefined}
              />
              <FieldError errors={errors.name ? [errors.name] : undefined} />
            </Field>
            <Field data-invalid={errors.slug ? true : undefined}>
              <FieldLabel htmlFor="slug">{t('publicHandle')}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{SITE_DOMAIN}/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="slug"
                  placeholder={t('slugPlaceholder')}
                  {...slugField.field}
                  onChange={(e) =>
                    slugField.field.onChange(e.target.value.toLowerCase().replace(/\s+/g, '-'))
                  }
                  aria-invalid={errors.slug ? true : undefined}
                />
              </InputGroup>
              <FieldDescription>{t('slugHint')}</FieldDescription>
              <FieldError errors={errors.slug ? [errors.slug] : undefined} />
            </Field>
            <Field>
              <FieldLabel htmlFor="timezone">{t('timezone')}</FieldLabel>
              <Select
                value={timezoneField.field.value}
                onValueChange={timezoneField.field.onChange}
              >
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue placeholder={t('selectTimezone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {timezoneOptions.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {timezoneLabel(tz, locale)}
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
