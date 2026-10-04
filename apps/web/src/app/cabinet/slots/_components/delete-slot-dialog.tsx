'use client'

import type { TimeSlotRecord } from '@repo/contracts'
import { useTranslations } from 'next-intl'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type DeleteSlotDialogProps = {
  /** The slot awaiting confirmation — `null` keeps the dialog closed. */
  slot: TimeSlotRecord | null
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Destructive confirm for deleting a slot — only reachable for slots with no bookings. */
export function DeleteSlotDialog({ slot, isPending, onConfirm, onClose }: DeleteSlotDialogProps) {
  const t = useTranslations('Cabinet.slots')

  return (
    <AlertDialog open={Boolean(slot)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('keepSlot')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(event) => {
              // Keep the dialog up while the request is in flight; it closes
              // in `onSuccess`, so a failure leaves the confirm recoverable.
              event.preventDefault()
              onConfirm()
            }}
          >
            {isPending ? t('deletingDialog') : t('deleteSlot')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
