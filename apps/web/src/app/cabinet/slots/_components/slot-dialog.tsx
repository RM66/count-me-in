'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { instantToWallClockInputs } from '@repo/contracts'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { SlotServiceField, SlotTextField } from './slot-fields'
import { useSlotForm } from './use-slot-form'

export type SlotDialogMode = 'create' | 'edit' | 'duplicate'

type SlotDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  services: ServiceRecord[]
  /** Preselect this service when creating — the list's active filter. */
  defaultServiceId?: string
  timezone: string
  mode: SlotDialogMode
  /** The slot to edit, or the one being duplicated. */
  slot?: TimeSlotRecord
}

/**
 * Create / edit / duplicate a slot.
 *
 * One component for all three because they are the same form over the same
 * fields — only the seed values, the wording and the target endpoint differ.
 * Duplicate is create-with-a-seed, which is why the mode maps down to the
 * form's binary create/edit.
 *
 * `defaultValues` are read once per mount, so the caller keys this component
 * per opening (see `SlotsTable`) to get a fresh form each time rather than the
 * previously edited slot's values.
 */
export function SlotDialog({
  open,
  onOpenChange,
  services,
  defaultServiceId,
  timezone,
  mode,
  slot,
}: SlotDialogProps) {
  const t = useTranslations('Cabinet.slots')
  const tc = useTranslations('Cabinet.common')

  // The wording that distinguishes one mode from another, kept as a set so the
  // three variants read beside each other.
  const WORDING: Record<SlotDialogMode, { title: string; description: string; submit: string }> = {
    create: {
      title: t('dialogCreateTitle'),
      description: t('dialogCreateDescription'),
      submit: t('addSlot'),
    },
    edit: {
      title: t('dialogEditTitle'),
      description: t('dialogEditDescription'),
      submit: t('saveChanges'),
    },
    duplicate: {
      title: t('dialogDuplicateTitle'),
      description: t('dialogDuplicateDescription'),
      submit: t('addSlot'),
    },
  }

  const wording = WORDING[mode]
  const today = instantToWallClockInputs(new Date().toISOString(), timezone).date
  const { form, submit, selectService, isSaving } = useSlotForm({
    services,
    defaultServiceId,
    timezone,
    slot,
    mode: mode === 'edit' ? 'edit' : 'create',
    isDuplicate: mode === 'duplicate',
    onSuccess: () => onOpenChange(false),
  })

  const { control } = form
  const { isDirty } = form.formState

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{wording.title}</DialogTitle>
            <DialogDescription>{wording.description}</DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <SlotServiceField
              control={control}
              services={services}
              onSelect={selectService}
              // A slot cannot move between services — the update contract has
              // no `serviceId`, so the control follows the rule.
              disabled={mode === 'edit'}
            />
            <div className="grid grid-cols-2 gap-4">
              <SlotTextField
                control={control}
                name="date"
                label={t('fieldDate')}
                type="date"
                // Native hint only — the schema is what actually rejects a past
                // start, since `min` says nothing about the time of day.
                min={today}
              />
              <SlotTextField control={control} name="time" label={t('fieldTime')} type="time" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SlotTextField
                control={control}
                name="durationMinutes"
                label={t('fieldDuration')}
                type="number"
                min={1}
                inputMode="numeric"
              />
              <SlotTextField
                control={control}
                name="capacity"
                label={t('fieldCapacity')}
                type="number"
                min={1}
                inputMode="numeric"
              />
            </div>
            <SlotTextField
              control={control}
              name="price"
              label={t('fieldPrice')}
              placeholder={t('pricePlaceholder')}
              description={t('priceDescription')}
            />
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isSaving}>
                {tc('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving || (mode === 'edit' && !isDirty)}>
              {isSaving ? tc('saving') : wording.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
