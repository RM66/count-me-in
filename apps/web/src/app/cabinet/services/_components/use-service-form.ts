'use client'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { ServiceFormOutput, ServiceFormValues, ServiceRecord } from '@repo/contracts'
import {
  serviceFormSchema,
  toCreateServiceInput,
  toServiceFormValues,
  toUpdateServiceInput,
} from '@repo/contracts'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { Control } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { useCreateService, useDeleteService, useUpdateService } from '@/api-client'

/**
 * Field components take `control` rather than the whole form instance, so each
 * subscribes only to the field it renders.
 */
export type ServiceFormControl = Control<ServiceFormValues, unknown, ServiceFormOutput>

/**
 * Fields backed by a plain text control. Excluding the non-text fields keeps
 * `<ServiceTextField name="options" />` from type-checking.
 */
export type ServiceTextFieldName = Exclude<
  keyof ServiceFormValues,
  'options' | 'optionsSelectMode' | 'photoUrl'
>

/**
 * Wires the cabinet service form to the API. Validation lives in
 * `serviceFormSchema`, payload shaping in `toCreate/UpdateServiceInput`; this
 * hook only owns submission, deletion and post-write navigation.
 *
 * The three `useForm` generics are what give `handleSubmit` the **transformed**
 * output (parsed numbers, `''` collapsed to `null`) rather than the raw input.
 */
export function useServiceForm(service?: ServiceRecord) {
  const t = useTranslations('Cabinet.services')
  const router = useRouter()
  const isEdit = Boolean(service)

  const form = useForm<ServiceFormValues, unknown, ServiceFormOutput>({
    resolver: standardSchemaResolver(serviceFormSchema),
    defaultValues: toServiceFormValues(service),
  })

  const createService = useCreateService()
  // Hooks are unconditional: the id is only used by the mutation function, so a
  // create-mode placeholder is never requested.
  const updateService = useUpdateService(service?.id ?? '')
  const deleteService = useDeleteService(service?.id ?? '')

  /** Every write leaves for the list; `refresh` re-runs the server render. */
  const leaveToList = (message: string) => {
    toast.success(message)
    router.push('/cabinet/services')
    router.refresh()
  }

  const submit = form.handleSubmit((values) => {
    if (!service) {
      createService.mutate(toCreateServiceInput(values), {
        onSuccess: () => leaveToList(t('createdToast')),
        onError: (error) => toast.error(error.message || t('createFailed')),
      })
      return
    }

    // Value-diff, not the whole record: an empty patch is a 400 server-side,
    // and resending an unchanged photoUrl would trigger the replaced-media
    // cleanup on every save. A reverted edit yields an empty diff — a save
    // that changes nothing is a successful no-op.
    const patch = toUpdateServiceInput(values, service)
    if (Object.keys(patch).length === 0) {
      leaveToList(t('updatedToast'))
      return
    }
    updateService.mutate(patch, {
      onSuccess: () => leaveToList(t('updatedToast')),
      onError: (error) => toast.error(error.message || t('updateFailed')),
    })
  })

  const remove = () => {
    deleteService.mutate(undefined, {
      onSuccess: () => leaveToList(t('deletedToast')),
      onError: (error) => toast.error(error.message || t('deleteFailed')),
    })
  }

  return {
    form,
    isEdit,
    submit,
    remove,
    isSaving: createService.isPending || updateService.isPending,
    isDeleting: deleteService.isPending,
  }
}
