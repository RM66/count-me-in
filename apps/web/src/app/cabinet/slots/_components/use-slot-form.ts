'use client'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type {
  ServiceRecord,
  TimeSlotFormOutput,
  TimeSlotFormValues,
  TimeSlotRecord,
} from '@repo/api-contracts'
import {
  timeSlotFormSchema,
  toCreateTimeSlotInput,
  toTimeSlotFormValues,
  toUpdateTimeSlotInput,
} from '@repo/api-contracts'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { useCreateSlot, useUpdateSlot } from '@/api-client'

/**
 * Field components take `control` rather than the whole form instance, so each
 * subscribes only to the field it renders.
 */
export type SlotFormControl = Control<TimeSlotFormValues, unknown, TimeSlotFormOutput>

/** Fields backed by a plain text/number input — excludes the two `<Select>`-shaped ones. */
export type SlotTextFieldName = Exclude<keyof TimeSlotFormValues, 'serviceId'>

type SlotFormOptions = {
  /** Services the organizer owns — the picker's options and the source of defaults. */
  services: ServiceRecord[]
  /** Preselect this service when creating. Defaults to the first one. */
  defaultServiceId?: string
  /** Organizer timezone: the wall-clock fields are interpreted in it. */
  timezone: string
  /**
   * Seed values. With `mode: 'edit'` this is the slot being changed; with
   * `mode: 'create'` it is a slot being duplicated.
   */
  slot?: TimeSlotRecord
  mode: 'create' | 'edit'
  /** A create seeded from an existing slot is a duplicate, and gets re-dated. */
  isDuplicate?: boolean
  /** Called after a successful write, before the router refresh. */
  onSuccess?: () => void
}

/**
 * Wires the cabinet slot form to the API. Validation and the wall-clock →
 * instant fold live in `timeSlotFormSchema`, payload shaping in
 * `toCreate/UpdateTimeSlotInput`; this hook only owns submission and the
 * post-write refresh.
 *
 * The three `useForm` generics are what give `handleSubmit` the **transformed**
 * output (parsed numbers, `''` collapsed to `null`, one `startsAt`) rather than
 * the raw input.
 */
export function useSlotForm({
  services,
  defaultServiceId,
  timezone,
  slot,
  mode,
  isDuplicate,
  onSuccess,
}: SlotFormOptions) {
  const router = useRouter()
  const isEdit = mode === 'edit'

  // The schema closes over the timezone and the slot's own `startsAt`, so it
  // must not be rebuilt per render. Passing the original instant is what lets
  // an edit that leaves the date untouched stay submittable even when the
  // slot is already in the past (see `timeSlotFormSchema`).
  const resolver = useMemo(
    () =>
      standardSchemaResolver(timeSlotFormSchema(timezone, { originalStartsAt: slot?.startsAt })),
    [timezone, slot?.startsAt],
  )

  // Creating while the list is filtered by a service should offer that service,
  // not the first one the organizer happens to own.
  const seedService = services.find((service) => service.id === defaultServiceId) ?? services[0]

  const form = useForm<TimeSlotFormValues, unknown, TimeSlotFormOutput>({
    resolver,
    // Seeded once per mount — the dialog is keyed per opening, so "now" is read
    // when the form appears rather than when the page was rendered.
    defaultValues: toTimeSlotFormValues(timezone, {
      slot,
      service: seedService,
      intent: isDuplicate ? 'duplicate' : 'edit',
    }),
  })

  const createSlot = useCreateSlot()
  // Hooks are unconditional: the id is only used by the mutation function, so a
  // create-mode placeholder is never requested.
  const updateSlot = useUpdateSlot(slot?.id ?? '')

  /** Every write re-runs the server render that painted the table. */
  const finish = (message: string) => {
    toast.success(message)
    onSuccess?.()
    router.refresh()
  }

  const submit = form.handleSubmit((values) => {
    if (!isEdit) {
      createSlot.mutate(toCreateTimeSlotInput(values), {
        onSuccess: () => finish('Slot added'),
        onError: (error) => toast.error(error.message || 'Failed to add the slot'),
      })
      return
    }

    updateSlot.mutate(toUpdateTimeSlotInput(values), {
      onSuccess: () => finish('Slot updated'),
      onError: (error) => toast.error(error.message || 'Failed to update the slot'),
    })
  })

  /**
   * Picking a service re-seeds capacity and duration from its defaults — that
   * is what `defaultCapacity` / `defaultDurationMinutes` are for (docs/domain.md).
   *
   * Only untouched fields are overwritten, so a deliberate override survives a
   * change of mind about the service. Editing an existing slot never re-seeds:
   * its stored values are the truth, not the service template.
   */
  const selectService = (nextServiceId: string) => {
    form.setValue('serviceId', nextServiceId, { shouldDirty: true, shouldValidate: true })
    if (isEdit) return

    const service = services.find((candidate) => candidate.id === nextServiceId)
    if (!service) return

    const { dirtyFields } = form.formState
    if (!dirtyFields.capacity) form.setValue('capacity', String(service.defaultCapacity))
    if (!dirtyFields.durationMinutes) {
      form.setValue('durationMinutes', String(service.defaultDurationMinutes))
    }
  }

  return {
    form,
    isEdit,
    submit,
    selectService,
    isSaving: createSlot.isPending || updateSlot.isPending,
  }
}
