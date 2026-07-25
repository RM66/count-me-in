'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SearchIcon, CalendarIcon, ArrowRightIcon } from 'lucide-react'
import { MessengerToggle } from '@/components/auth/messenger-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { bookings, getSlot, getBookingService, formatDateTime } from '@/lib/mock-data'

type ViewState = 'idle' | 'searching' | 'results'

export default function FindBookingPage() {
  const [messenger, setMessenger] = useState('telegram')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<ViewState>('idle')

  const found = bookings.filter((b) => b.status === 'confirmed').slice(0, 2)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setState('searching')
    setTimeout(() => setState('results'), 900)
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 md:py-20">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Find your booking
        </h1>
        <p className="mt-2 text-muted-foreground text-pretty">
          Lost your link? Enter the phone number you booked with and we&apos;ll send a fresh manage
          link to your messenger.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch}>
            <FieldGroup>
              <Field>
                <FieldLabel>Messenger</FieldLabel>
                <MessengerToggle value={messenger} onValueChange={setMessenger} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lookup-phone">Phone number</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="lookup-phone"
                    type="tel"
                    placeholder="+381 64 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </InputGroup>
                <FieldDescription>
                  We&apos;ll only show bookings tied to this number.
                </FieldDescription>
              </Field>
              <Button type="submit" disabled={state === 'searching'}>
                {state === 'searching' ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Searching
                  </>
                ) : (
                  <>
                    <SearchIcon data-icon="inline-start" />
                    Find my bookings
                  </>
                )}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {state === 'results' && (
        <div className="mt-8 flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            {found.length} booking{found.length === 1 ? '' : 's'} found
          </p>
          {found.map((b) => {
            const slot = getSlot(b.timeSlotId)
            const service = getBookingService(b)
            if (!slot || !service) return null
            return (
              <Link key={b.id} href={`/b/${b.manageToken}`} className="group block">
                <Card className="transition-colors group-hover:border-primary/40">
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <CalendarIcon className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{service.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {formatDateTime(slot.startsAt)}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {b.seats} seat{b.seats === 1 ? '' : 's'}
                    </Badge>
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {state === 'idle' && (
        <div className="mt-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing to show yet</EmptyTitle>
              <EmptyDescription>
                Enter your phone number above to look up your bookings.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}
