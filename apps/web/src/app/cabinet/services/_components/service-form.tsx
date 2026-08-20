'use client'

import type { ServiceRecord } from '@repo/contracts'
import { Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { useIsDemo } from '@/api-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { ServiceOptionsField } from './service-options-field'
import { ServicePhotoField } from './service-photo-field'
import { ServiceTextareaField, ServiceTextField } from './service-text-field'
import { useServiceForm } from './use-service-form'

export function ServiceForm({ service }: { service?: ServiceRecord }) {
  const router = useRouter()
  const { form, isEdit, submit, remove, isSaving, isDeleting } = useServiceForm(service)
  const t = useTranslations('Cabinet.services')
  const tc = useTranslations('Cabinet.common')

  // Read-only demo account (ADR-010). Disabling here is UX only — every write
  // endpoint rejects the demo id server-side regardless.
  const isReadOnly = useIsDemo()

  const { control } = form
  const { isDirty } = form.formState
  const isBusy = isSaving || isDeleting

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
            <CardDescription>{t('detailsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ServiceTextField
                control={control}
                name="title"
                label={t('fieldTitle')}
                placeholder={t('titlePlaceholder')}
                disabled={isReadOnly}
              />
              <ServiceTextareaField
                control={control}
                name="description"
                label={t('fieldDescription')}
                rows={4}
                placeholder={t('descriptionPlaceholder')}
                description={t('descriptionHint')}
                disabled={isReadOnly}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ServiceTextField
                  control={control}
                  name="location"
                  label={t('fieldLocation')}
                  placeholder={t('locationPlaceholder')}
                  description={t('locationHint')}
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="contact"
                  label={t('fieldContact')}
                  placeholder={t('contactPlaceholder')}
                  description={t('contactHint')}
                  disabled={isReadOnly}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('defaults')}</CardTitle>
            <CardDescription>{t('defaultsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ServiceTextField
                  control={control}
                  name="defaultPrice"
                  label={t('fieldPrice')}
                  placeholder={t('pricePlaceholder')}
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="defaultCapacity"
                  label={t('fieldCapacity')}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="defaultDurationMinutes"
                  label={t('fieldDuration')}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  disabled={isReadOnly}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('groupBookings')}</CardTitle>
            <CardDescription>{t('groupBookingsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ServiceTextField
                control={control}
                name="maxSeatsPerBooking"
                label={t('fieldMaxSeats')}
                type="number"
                min={1}
                inputMode="numeric"
                description={t('maxSeatsHint')}
                disabled={isReadOnly}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <ServiceOptionsField control={control} disabled={isReadOnly} />
      </div>

      <div className="flex flex-col gap-6">
        <ServicePhotoField control={control} disabled={isReadOnly} />

        <Card>
          <CardHeader>
            <CardTitle>{t('publish')}</CardTitle>
            <CardDescription>{t('publishDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/*
              Disabled until something changes — this is what replaced the
              "No changes to save" toast and the manual field-by-field diff.
            */}
            <Button type="submit" disabled={isBusy || isReadOnly || !isDirty}>
              {isSaving ? tc('saving') : isEdit ? t('saveChanges') : t('createService')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/cabinet/services')}
              disabled={isBusy}
            >
              {tc('cancel')}
            </Button>
            {isEdit && (
              <>
                <Separator className="my-1" />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={isBusy || isReadOnly}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      {isDeleting ? t('deleting') : t('deleteService')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('deleteDescription', { title: service?.title ?? '' })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('keepService')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={remove}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        {t('delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
