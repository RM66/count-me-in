'use client'

import type { Messenger } from '@repo/api-contracts'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { MessengerToggle } from '@/components/messenger-toggle'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ApiError,
  useRegisterOrganizer,
  useRequestOtp,
  useSignInWithTicket,
  useVerifyOtp,
} from '@/lib/api'
import { cn } from '@/utils'

const steps = ['Phone', 'Verify', 'Profile'] as const

const timezones = [
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Kyiv',
  'America/New_York',
  'America/Los_Angeles',
]

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [phone, setPhone] = useState('')
  const [messenger, setMessenger] = useState('telegram')
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [timezone, setTimezone] = useState('Europe/Belgrade')

  const requestOtp = useRequestOtp()
  const verifyOtp = useVerifyOtp()
  const registerOrganizer = useRegisterOrganizer()
  const signIn = useSignInWithTicket()

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    try {
      await requestOtp.mutateAsync({ phone, messenger: messenger as Messenger })
      setStep(1)
      toast.success('Verification code sent to your messenger')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the code')
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    try {
      const result = await verifyOtp.mutateAsync({ phone, code })
      if (result.organizerExists) {
        await signIn.mutateAsync(result.ticket)
        toast.success('You already have an account — welcome back!')
        router.push('/cabinet')
        router.refresh()
        return
      }
      setTicket(result.ticket)
      setStep(2)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not verify the code')
      setCode('')
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    try {
      await registerOrganizer.mutateAsync({
        ticket,
        slug,
        name,
        timezone,
        messenger: messenger as Messenger,
      })
      await signIn.mutateAsync(ticket)
      router.push('/onboarding')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Ticket expired mid-registration — restart phone verification.
        toast.error(error.message)
        setStep(0)
        setCode('')
        setTicket('')
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not create the account')
      }
    }
  }

  const pending =
    requestOtp.isPending || verifyOtp.isPending || registerOrganizer.isPending || signIn.isPending

  return (
    <AuthShell
      title="Create your account"
      description="Set up your organizer profile in three quick steps."
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
        <form onSubmit={handleSendCode}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="phone">Phone number</FieldLabel>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="+381 64 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Messenger for codes & notifications</FieldLabel>
              <MessengerToggle value={messenger} onValueChange={setMessenger} />
              <FieldDescription>
                We’ll use this channel to verify you and send booking alerts.
              </FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Sending…' : 'Send code'}
            </Button>
          </FieldGroup>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={handleVerify}>
          <FieldGroup>
            <Field className="items-center">
              <FieldLabel className="self-start">Verification code</FieldLabel>
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              <FieldDescription>Enter the 6-digit code from your messenger.</FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={code.length < 6 || pending}>
              {pending ? 'Verifying…' : 'Verify'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep(0)
                setCode('')
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              Back
            </Button>
          </FieldGroup>
        </form>
      )}

      {step === 2 && (
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
              <FieldDescription>This is the link you’ll share with guests.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
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
