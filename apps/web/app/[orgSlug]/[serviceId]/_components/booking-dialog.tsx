'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp'
import { AddToCalendar } from '@/components/guest/add-to-calendar'
import { SeatsBadge } from '@/app/[orgSlug]/[serviceId]/_components/seats-badge'
import {
  type Service,
  type TimeSlot,
  formatDate,
  formatTime,
  seatsLeft,
  slotEnd,
  slotPrice,
} from '@/lib/mock-data'
import { ArrowLeft, CheckCircle2, PartyPopper } from 'lucide-react'
import { cn } from '@/lib/utils'

type Step = 'slot' | 'options' | 'details' | 'verify' | 'success'

export function BookingDialog({
  service,
  slots,
  preselectedSlotId,
  trigger,
}: {
  service: Service
  slots: TimeSlot[]
  preselectedSlotId?: string
  trigger: React.ReactNode
}) {
  const hasOptions = !!service.options?.length
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('slot')
  const [slotId, setSlotId] = useState<string | undefined>(preselectedSlotId)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')

  const slot = slots.find((s) => s.id === slotId)

  function reset() {
    setStep('slot')
    setSlotId(preselectedSlotId)
    setSelectedOptions([])
    setName('')
    setPhone('')
    setCode('')
  }

  function goFromSlot() {
    setStep(hasOptions ? 'options' : 'details')
  }

  function toggleOption(value: string) {
    if (service.optionsSelectMode === 'single') {
      setSelectedOptions([value])
    } else {
      setSelectedOptions((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      )
    }
  }

  const stepTitles: Record<Step, string> = {
    slot: 'Pick a time',
    options: 'Choose options',
    details: 'Your details',
    verify: 'Verify your phone',
    success: 'You’re booked!',
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setTimeout(reset, 200)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>{service.title}</DialogDescription>
        </DialogHeader>

        {step === 'slot' && (
          <div className="flex flex-col gap-4">
            <RadioGroup value={slotId} onValueChange={setSlotId} className="gap-2">
              {slots.map((s) => {
                const full = seatsLeft(s) === 0
                return (
                  <label
                    key={s.id}
                    htmlFor={`slot-${s.id}`}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
                      slotId === s.id && 'border-primary bg-accent',
                      full && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <RadioGroupItem id={`slot-${s.id}`} value={s.id} disabled={full} />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {formatDate(s.startsAt)} · {formatTime(s.startsAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">{slotPrice(s)}</span>
                      </div>
                    </div>
                    <SeatsBadge slot={s} />
                  </label>
                )
              })}
            </RadioGroup>
            <Button disabled={!slotId} onClick={goFromSlot}>
              Continue
            </Button>
          </div>
        )}

        {step === 'options' && (
          <div className="flex flex-col gap-4">
            {service.optionsSelectMode === 'single' ? (
              <RadioGroup
                value={selectedOptions[0]}
                onValueChange={(v) => setSelectedOptions([v])}
                className="gap-2"
              >
                {service.options?.map((opt) => (
                  <label
                    key={opt}
                    htmlFor={`opt-${opt}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                      selectedOptions[0] === opt && 'border-primary bg-accent',
                    )}
                  >
                    <RadioGroupItem id={`opt-${opt}`} value={opt} />
                    <span className="text-sm font-medium">{opt}</span>
                  </label>
                ))}
              </RadioGroup>
            ) : (
              <FieldSet>
                <FieldLegend className="sr-only">Options</FieldLegend>
                <div className="flex flex-col gap-2">
                  {service.options?.map((opt) => (
                    <label
                      key={opt}
                      htmlFor={`opt-${opt}`}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                        selectedOptions.includes(opt) && 'border-primary bg-accent',
                      )}
                    >
                      <Checkbox
                        id={`opt-${opt}`}
                        checked={selectedOptions.includes(opt)}
                        onCheckedChange={() => toggleOption(opt)}
                      />
                      <span className="text-sm font-medium">{opt}</span>
                    </label>
                  ))}
                </div>
              </FieldSet>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('slot')}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={service.optionsSelectMode === 'single' && !selectedOptions.length}
                onClick={() => setStep('details')}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('verify')
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="guest-name">Full name</FieldLabel>
                <Input
                  id="guest-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mila Petrović"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="guest-phone">Phone</FieldLabel>
                <Input
                  id="guest-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+381 64 111 2233"
                  required
                />
                <FieldDescription>
                  We’ll send a code to confirm — no account needed.
                </FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(hasOptions ? 'options' : 'slot')}
                >
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button type="submit" className="flex-1">
                  Send code
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}

        {step === 'verify' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('success')
            }}
          >
            <FieldGroup>
              <Field className="items-center">
                <FieldDescription className="text-center">
                  Enter the 6-digit code sent to {phone || 'your messenger'}.
                </FieldDescription>
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
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep('details')}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={code.length < 6}>
                  Confirm booking
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}

        {step === 'success' && slot && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <PartyPopper className="size-6" />
              </span>
              <p className="text-sm text-muted-foreground text-pretty">
                Your seat is confirmed. We’ve sent the details to your messenger.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <dl className="flex flex-col gap-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Service</dt>
                  <dd className="text-right font-medium">{service.title}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="text-right font-medium">
                    {formatDate(slot.startsAt)} · {formatTime(slot.startsAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="text-right font-medium">{name || 'Guest'}</dd>
                </div>
                {selectedOptions.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Options</dt>
                    <dd className="text-right font-medium">{selectedOptions.join(', ')}</dd>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="size-4" />
                  <span className="font-medium">Confirmed</span>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-2">
              <AddToCalendar
                title={service.title}
                startsAt={slot.startsAt}
                endsAt={slotEnd(slot)}
                variant="default"
              />
              <Button variant="outline" asChild>
                <Link href="/b/demo-manage-token">Manage this booking</Link>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
