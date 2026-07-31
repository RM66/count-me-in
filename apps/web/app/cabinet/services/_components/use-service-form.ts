'use client'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { ServiceFormOutput, ServiceFormValues, ServiceRecord } from '@repo/api-contracts'
import { serviceFormSchema, toCreateServiceInput, toServiceFormValues } from '@repo/api-contracts'
import { useRouter } from 'next/navigation'
import type { Control } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { useCreateService, useDeleteService, useUpdateService } from '@/lib/api'

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
    if (!isEdit) {
      createService.mutate(toCreateServiceInput(values), {
        onSuccess: () => leaveToList('Service created'),
        onError: (error) => toast.error(error.message || 'Failed to create the service'),
      })
      return
    }

    // `updateServiceInput` is `.partial()` and nullable, so the normalized form
    // output is a valid payload as-is — Save is disabled unless something is
    // dirty, which is what used to require hand-rolled field diffing.
    updateService.mutate(values, {
      onSuccess: () => leaveToList('Service updated'),
      onError: (error) => toast.error(error.message || 'Failed to update the service'),
    })
  })

  const remove = () => {
    deleteService.mutate(undefined, {
      onSuccess: () => leaveToList('Service deleted'),
      onError: (error) => toast.error(error.message || 'Failed to delete the service'),
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
