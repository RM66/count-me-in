'use client'

import type { ServiceRecord } from '@repo/api-contracts'
import { Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'

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
import { useIsDemo } from '@/lib/api'
import { ServiceOptionsField } from './service-options-field'
import { ServicePhotoField } from './service-photo-field'
import { ServiceTextareaField, ServiceTextField } from './service-text-field'
import { useServiceForm } from './use-service-form'

export function ServiceForm({ service }: { service?: ServiceRecord }) {
  const router = useRouter()
  const { form, isEdit, submit, remove, isSaving, isDeleting } = useServiceForm(service)

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
            <CardTitle>Details</CardTitle>
            <CardDescription>Basic information guests will see.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <ServiceTextField
                control={control}
                name="title"
                label="Title"
                placeholder="e.g. Morning Vinyasa Flow"
                disabled={isReadOnly}
              />
              <ServiceTextareaField
                control={control}
                name="description"
                label="Description"
                rows={4}
                placeholder="Describe what guests can expect..."
                description="Shown on the service page. Markdown is not supported."
                disabled={isReadOnly}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ServiceTextField
                  control={control}
                  name="location"
                  label="Location"
                  placeholder="e.g. Kralja Petra 12, Belgrade"
                  description="Overrides your profile location when set."
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="contact"
                  label="Contact"
                  placeholder="e.g. phone, email or social link"
                  description="Overrides your profile contact when set."
                  disabled={isReadOnly}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Defaults</CardTitle>
            <CardDescription>Applied to new slots. You can override them per slot.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ServiceTextField
                  control={control}
                  name="defaultPrice"
                  label="Price"
                  placeholder="1200 RSD"
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="defaultCapacity"
                  label="Capacity"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  disabled={isReadOnly}
                />
                <ServiceTextField
                  control={control}
                  name="defaultDurationMinutes"
                  label="Duration (min)"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  disabled={isReadOnly}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <ServiceOptionsField control={control} disabled={isReadOnly} />
      </div>

      <div className="flex flex-col gap-6">
        <ServicePhotoField control={control} disabled={isReadOnly} />

        <Card>
          <CardHeader>
            <CardTitle>Publish</CardTitle>
            <CardDescription>Save changes to this service.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {/*
              Disabled until something changes — this is what replaced the
              "No changes to save" toast and the manual field-by-field diff.
            */}
            <Button type="submit" disabled={isBusy || isReadOnly || !isDirty}>
              {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create service'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/cabinet/services')}
              disabled={isBusy}
            >
              Cancel
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
                      {isDeleting ? 'Deleting...' : 'Delete service'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this service?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {service?.title} and all of its time slots and bookings will be removed.
                        This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep service</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={remove}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        Delete
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
