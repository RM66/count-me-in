import { describe, expect, it } from 'vitest'

import type { ServiceRecord } from './service'
import { SLOT_START_IN_PAST_MESSAGE, type TimeSlotRecord } from './time-slot'
import {
  timeSlotFormSchema,
  toCreateTimeSlotInput,
  toTimeSlotFormValues,
  toUpdateTimeSlotInput,
} from './time-slot-form'

// the slot form is the seam between date/time string inputs and the
// wire instant. Load-bearing rules: date+time fold against the
// organizer's timezone (not the browser's), the past-start message lands
// on the date field (not a round-trip toast), an untouched past instant
// stays submittable via originalStartsAt, and price '' collapses to null.

const TZ = 'Europe/Belgrade'

const validValues = {
  serviceId: 'svc-abc123xyz',
  date: '2030-07-25',
  time: '07:00',
  durationMinutes: '60',
  capacity: '10',
  price: '',
}

describe('timeSlotFormSchema', () => {
  it('folds date+time into the startsAt instant in the organizer timezone', () => {
    const parsed = timeSlotFormSchema(TZ).parse(validValues)
    // 2030-07-25 07:00 Belgrade (CEST, +02:00) → 05:00Z.
    expect(parsed.startsAt.toISOString()).toBe('2030-07-25T05:00:00.000Z')
    expect(parsed.durationMinutes).toBe(60)
    expect(parsed.capacity).toBe(10)
  })

  it('accepts seconds in the time field (some browsers emit them)', () => {
    const parsed = timeSlotFormSchema(TZ).parse({ ...validValues, time: '07:00:00' })
    expect(parsed.startsAt.toISOString()).toBe('2030-07-25T05:00:00.000Z')
  })

  it("collapses '' price to null (use the service default)", () => {
    const parsed = timeSlotFormSchema(TZ).parse(validValues)
    expect(parsed.price).toBeNull()
  })

  it('keeps a set price override', () => {
    const parsed = timeSlotFormSchema(TZ).parse({ ...validValues, price: '15 EUR' })
    expect(parsed.price).toBe('15 EUR')
  })

  it('rejects a past start on the date field', () => {
    const result = timeSlotFormSchema(TZ).safeParse({
      ...validValues,
      date: '2020-01-01',
      time: '07:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const dateIssue = result.error.issues.find((i) => i.path.join('.') === 'date')
      expect(dateIssue?.message).toBe(SLOT_START_IN_PAST_MESSAGE)
    }
  })

  it('keeps an untouched past instant submittable via originalStartsAt', () => {
    // 2020-01-01 07:00 Belgrade (CET, +01:00) → 06:00Z: the escape hatch
    // compares instants, so originalStartsAt must be the stored instant.
    const past = '2020-01-01T06:00:00.000Z'
    const parsed = timeSlotFormSchema(TZ, { originalStartsAt: past }).parse({
      ...validValues,
      date: '2020-01-01',
      time: '07:00',
    })
    expect(parsed.startsAt.toISOString()).toBe(past)
  })

  it('rejects malformed date and time fields', () => {
    expect(timeSlotFormSchema(TZ).safeParse({ ...validValues, date: '' }).success).toBe(false)
    expect(timeSlotFormSchema(TZ).safeParse({ ...validValues, time: 'morning' }).success).toBe(
      false,
    )
  })

  it('rejects non-numeric capacity and duration mid-edit strings', () => {
    expect(timeSlotFormSchema(TZ).safeParse({ ...validValues, capacity: '1e' }).success).toBe(false)
    expect(timeSlotFormSchema(TZ).safeParse({ ...validValues, durationMinutes: '' }).success).toBe(
      false,
    )
  })
})

describe('toTimeSlotFormValues', () => {
  it('seeds a new slot from the service defaults, price empty', () => {
    const service = {
      id: 'svc-abc123xyz',
      defaultCapacity: 8,
      defaultDurationMinutes: 45,
    } as unknown as ServiceRecord
    const values = toTimeSlotFormValues(TZ, {
      service,
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(values.serviceId).toBe('svc-abc123xyz')
    expect(values.durationMinutes).toBe('45')
    expect(values.capacity).toBe('8')
    // Empty override = "use the service default", never pre-filled.
    expect(values.price).toBe('')
  })

  it('editing shows the stored wall clock, even in the past', () => {
    const slot = {
      serviceId: 'svc-abc123xyz',
      // 2020-01-01 07:00 Belgrade → 06:00Z (CET, +01:00).
      startsAt: '2020-01-01T06:00:00.000Z',
      durationMinutes: 60,
      capacity: 10,
      price: '15 EUR',
    } as unknown as TimeSlotRecord
    const values = toTimeSlotFormValues(TZ, { slot })
    expect(values.date).toBe('2020-01-01')
    expect(values.time).toBe('07:00')
    expect(values.price).toBe('15 EUR')
  })

  it('duplicating keeps the time of day but moves the date forward', () => {
    const slot = {
      serviceId: 'svc-abc123xyz',
      startsAt: '2020-01-01T06:00:00.000Z',
      durationMinutes: 60,
      capacity: 10,
      price: null,
    } as unknown as TimeSlotRecord
    const values = toTimeSlotFormValues(TZ, {
      slot,
      intent: 'duplicate',
      now: new Date('2030-05-01T00:00:00.000Z'),
    })
    expect(values.time).toBe('07:00')
    expect(values.date).not.toBe('2020-01-01')
  })
})

describe('toCreateTimeSlotInput / toUpdateTimeSlotInput', () => {
  it('create drops a null price (absent key = not set)', () => {
    const parsed = timeSlotFormSchema(TZ).parse(validValues)
    const input = toCreateTimeSlotInput(parsed)
    expect(input).not.toHaveProperty('price')
    expect(input.startsAt.toISOString()).toBe('2030-07-25T05:00:00.000Z')
  })

  it('create keeps a set price override', () => {
    const parsed = timeSlotFormSchema(TZ).parse({ ...validValues, price: '15 EUR' })
    expect(toCreateTimeSlotInput(parsed).price).toBe('15 EUR')
  })

  it('update drops serviceId and keeps price null (clear the override)', () => {
    const parsed = timeSlotFormSchema(TZ).parse(validValues)
    const input = toUpdateTimeSlotInput(parsed)
    expect(input).not.toHaveProperty('serviceId')
    expect(input.price).toBeNull()
  })
})
