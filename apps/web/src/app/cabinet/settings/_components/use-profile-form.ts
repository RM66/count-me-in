import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { OrganizerFormOutput, OrganizerFormValues, OrganizerProfile } from '@repo/contracts'
import {
  AVATAR_MAX_BYTES,
  imageContentType,
  organizerFormSchema,
  toOrganizerFormValues,
  toOrganizerProfilePatch,
} from '@repo/contracts'
import { useTranslations } from 'next-intl'
import type { Control } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { useUpdateOrganizerProfile, useUploadAvatar } from '@/api-client'
import { useImageUpload } from '@/hooks/use-image-upload'

/**
 * Field components take `control` rather than the whole form instance, so each
 * subscribes only to the field it renders.
 */
export type ProfileFormControl = Control<OrganizerFormValues, unknown, OrganizerFormOutput>

/**
 * Fields backed by a plain text input — slug, timezone and description have
 * custom controls and are wired in the form itself.
 */
export type ProfileTextFieldName = 'name' | 'contact' | 'location'

/**
 * Wires the settings profile form to the API. Validation lives in
 * `organizerFormSchema`; the merge-patch diff (absent = keep, null = clear —
 * only touched keys may leave) lives in `toOrganizerProfilePatch`. The avatar
 * upload is unchanged: it persists the URL itself, outside the form.
 */
export function useProfileForm(organizer: OrganizerProfile, onSaveSuccess?: () => void) {
  const updateProfile = useUpdateOrganizerProfile()
  const t = useTranslations('Cabinet.settings')

  const form = useForm<OrganizerFormValues, unknown, OrganizerFormOutput>({
    resolver: standardSchemaResolver(organizerFormSchema),
    defaultValues: toOrganizerFormValues(organizer),
  })

  // Subscribing the proxy is what turns dirty tracking ON — `setValue` only
  // computes dirtyFields/isDirty for formState props someone has read.
  const { isDirty } = form.formState

  const avatar = useImageUpload({
    contentType: imageContentType,
    maxBytes: AVATAR_MAX_BYTES,
    maxBytesLabel: '5 MB',
    mutation: useUploadAvatar(),
    // The avatar mutation persists the URL itself and updates the cache.
    onUploaded: () => toast.success(t('photoUpdated')),
  })

  const save = form.handleSubmit((values) => {
    const patch = toOrganizerProfilePatch(values, form.formState.dirtyFields)
    if (Object.keys(patch).length === 0) {
      toast.info(t('noChanges'))
      return
    }

    updateProfile.mutate(patch, {
      onSuccess: () => {
        // Re-baseline: what was just persisted is the new clean state.
        form.reset(form.getValues())
        toast.success(t('updatedToast'))
        onSaveSuccess?.()
      },
      onError: (error) => {
        toast.error(error.message || t('updateFailed'))
      },
    })
  })

  return {
    form,
    save,
    isDirty,
    isSaving: updateProfile.isPending,
    // Avatar upload — shared with the service cover picker.
    fileInputRef: avatar.inputRef,
    handleAvatarChange: avatar.onFileChange,
    triggerAvatarUpload: avatar.open,
    isUploadingAvatar: avatar.isUploading,
  }
}
