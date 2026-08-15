import { z } from 'zod'

import { numericText, optionalText } from './form-fields'
import { capacity, durationMinutes, priceText, serviceId } from './primitives'
import type { ServiceRecord } from './service'
import type { CreateTimeSlotInput, TimeSlotRecord, UpdateTimeSlotInput } from './time-slot'
import { isAcceptableSlotStart, SLOT_START_IN_PAST_MESSAGE } from './time-slot'
import { instantToWallClockInputs, wallClockToInstant } from './timezone'

/**
 * The cabinet slot form, as the *inputs* hold it — the same split as
 * {@link serviceFormSchema}, for the same reasons (number inputs yield strings,
 * `''` must reach the API as `null`, create/update disagree on optionality).
 *
 * One rule is specific to slots: the wire contract carries a single `startsAt`
 * instant, but no browser control edits an instant. Organizers get a date field
 * and a time field, and the two are recombined against the organizer's
 * timezone — which is why validation here needs that timezone as context and
 * the schema is a factory rather than a constant.
 */

/** `<input type="date">` — the control guarantees the shape; this catches an empty field. */
const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')

/** `<input type="time">`; seconds are accepted because some browsers emit them. */
const timeInput = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Pick a start time')

const timeSlotFormFields = {
  serviceId,
  date: dateInput,
  time: timeInput,
  durationMinutes: numericText(durationMinutes, 'Duration'),
  capacity: numericText(capacity, 'Capacity'),
  price: optionalText(priceText),
}

/**
 * Validate the form and fold `date` + `time` into the `startsAt` instant.
 * `timeZone` is the organizer's — the same value the table renders with — so
 * "07:00" means 07:00 to the organizer regardless of where the browser or the
 * server happens to be.
 *
 * The past-start rule is re-checked here, after the fold, so the message lands
 * on the date field instead of arriving as a toast a round trip later. The API
 * enforces the same rule — this is the convenience copy, not the gate.
 *
 * `originalStartsAt` mirrors `updateTimeSlotInput`'s own escape hatch: an edit
 * that leaves the instant untouched must stay submittable however far in the
 * past it already is, since the alternative is trapping the organizer with a
 * slot they can only view, never save.
 */
export function timeSlotFormSchema(timeZone: string, options: { originalStartsAt?: string } = {}) {
  const { originalStartsAt } = options
  const originalMs = originalStartsAt ? new Date(originalStartsAt).getTime() : undefined

  return z
    .object(timeSlotFormFields)
    .transform(({ date, time, ...rest }) => {
      const [year, month, day] = date.split('-').map(Number)
      const [hour, minute] = time.split(':').map(Number)

      return {
        ...rest,
        startsAt: wallClockToInstant(
          { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
          timeZone,
        ),
      }
    })
    .refine(
      ({ startsAt }) => startsAt.getTime() === originalMs || isAcceptableSlotStart(startsAt),
      { path: ['date'], message: SLOT_START_IN_PAST_MESSAGE },
    )
}

type TimeSlotFormSchema = ReturnType<typeof timeSlotFormSchema>

/** What the inputs hold (all strings). Use for `useForm` values and defaults. */
export type TimeSlotFormValues = z.input<TimeSlotFormSchema>

/** What a valid submit produces: parsed numbers, `''` → `null`, one `startsAt`. */
export type TimeSlotFormOutput = z.output<TimeSlotFormSchema>

/** How far ahead a brand-new slot is proposed, in hours. */
const NEW_SLOT_LEAD_HOURS = 1

/** Days to look ahead when re-dating a time of day that has already passed. */
const REDATE_SEARCH_DAYS = 8

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * Default start for a new slot: the next whole hour, at least an hour out.
 * Anchored to the clock rather than to a fixed "today at 09:00" — that
 * constant is already in the past for most of the working day.
 * All arithmetic is done on the **instant** and only then read in `timeZone`.
 */
function defaultStart(timeZone: string, now: Date): { date: string; time: string } {
  const lead = new Date(now.getTime() + NEW_SLOT_LEAD_HOURS * 60 * MINUTE_MS)
  const minute = Number(instantToWallClockInputs(lead.toISOString(), timeZone).time.split(':')[1])
  const rounded = minute === 0 ? lead : new Date(lead.getTime() + (60 - minute) * MINUTE_MS)

  return instantToWallClockInputs(rounded.toISOString(), timeZone)
}

/**
 * The soonest date on which `time` still lies in the future.
 * Walks forward a day at a time so the kept time of day is preserved.
 */
function nextDateForTime(time: string, timeZone: string, now: Date): string {
  const [hour, minute] = time.split(':').map(Number)

  for (let offset = 0; offset < REDATE_SEARCH_DAYS; offset++) {
    const { date } = instantToWallClockInputs(
      new Date(now.getTime() + offset * DAY_MS).toISOString(),
      timeZone,
    )
    const [year, month, day] = date.split('-').map(Number)

    const instant = wallClockToInstant(
      { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
      timeZone,
    )

    if (isAcceptableSlotStart(instant, now)) return date
  }

  return defaultStart(timeZone, now).date
}

/**
 * Seed the form from an existing slot, or from a service's defaults when
 * creating — `defaultCapacity` / `defaultDurationMinutes` exist precisely to
 * be the template for a new slot (docs/domain.md, Service).
 *
 * Duplicating keeps the source slot's time of day but moves it to the next
 * default date: two slots at the same instant would be a copy nobody wants.
 *
 * Editing never re-dates, even when the stored slot is already in the past:
 * the dialog must show the organizer what is actually saved.
 * `price` stays empty for a new slot: an empty override means "use the service
 * default", so pre-filling it would silently freeze today's price onto the slot.
 */
export function toTimeSlotFormValues(
  timeZone: string,
  options: {
    slot?: TimeSlotRecord
    service?: ServiceRecord
    now?: Date
    intent?: 'edit' | 'duplicate'
  } = {},
): TimeSlotFormValues {
  const { slot, service, now = new Date(), intent = 'edit' } = options

  if (slot) {
    const { date, time } = instantToWallClockInputs(slot.startsAt, timeZone)

    return {
      serviceId: slot.serviceId,
      date: intent === 'duplicate' ? nextDateForTime(time, timeZone, now) : date,
      time,
      durationMinutes: String(slot.durationMinutes),
      capacity: String(slot.capacity),
      price: slot.price ?? '',
    }
  }

  const start = defaultStart(timeZone, now)

  return {
    serviceId: service?.id ?? '',
    date: start.date,
    time: start.time,
    durationMinutes: String(service?.defaultDurationMinutes ?? 60),
    capacity: String(service?.defaultCapacity ?? 10),
    price: '',
  }
}

/**
 * Narrow the form output to the create contract by dropping `null`: create
 * takes an `optional` price, and an absent key is how "not set" is expressed.
 */
export function toCreateTimeSlotInput(values: TimeSlotFormOutput): CreateTimeSlotInput {
  return {
    serviceId: values.serviceId,
    startsAt: values.startsAt,
    durationMinutes: values.durationMinutes,
    capacity: values.capacity,
    ...(values.price !== null && { price: values.price }),
  }
}

/**
 * Narrow the form output to the update contract.
 * `serviceId` is dropped: a slot cannot be moved to another service
 * (see {@link updateTimeSlotInput}), and `price: null` is meaningful here —
 * it clears an override back to the service default.
 */
export function toUpdateTimeSlotInput(values: TimeSlotFormOutput): UpdateTimeSlotInput {
  return {
    startsAt: values.startsAt,
    durationMinutes: values.durationMinutes,
    capacity: values.capacity,
    price: values.price,
  }
}
