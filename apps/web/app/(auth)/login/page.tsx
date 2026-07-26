'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')

  return (
    <AuthShell
      title={step === 'phone' ? 'Welcome back' : 'Enter your code'}
      description={
        step === 'phone'
          ? 'Log in with your phone. We’ll send a code to your messenger.'
          : `We sent a 6-digit code to your messenger for ${phone || 'your number'}.`
      }
      footer={
        <>
          New to CountMeIn?{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setStep('code')
            toast.success('Verification code sent to your messenger')
          }}
        >
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
              <FieldDescription>Include your country code.</FieldDescription>
            </Field>
            <Button type="submit" className="w-full">
              Send code
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            router.push('/cabinet')
          }}
        >
          <FieldGroup>
            <Field className="items-center">
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
              <FieldDescription>Enter any 6 digits for this demo.</FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={code.length < 6}>
              Verify & log in
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep('phone')}
            >
              <ArrowLeft data-icon="inline-start" />
              Use a different number
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  )
}
