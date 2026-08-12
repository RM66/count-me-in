import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/contracts'
import { AVATAR_MAX_BYTES, avatarContentType } from '@repo/contracts'
import { useReducer } from 'react'
import { toast } from 'sonner'

import { useUpdateOrganizerProfile, useUploadAvatar } from '@/api-client'
import { useImageUpload } from '@/hooks/use-image-upload'

type ProfileFormState = {
  name: string
  bio: string
  contact: string
  timezone: string
  location: string
  slug: string
}

type ProfileFormAction =
  | { type: 'UPDATE_FIELD'; field: keyof ProfileFormState; value: string }
  | { type: 'RESET'; organizer: OrganizerProfile }

function profileFormReducer(state: ProfileFormState, action: ProfileFormAction): ProfileFormState {
  switch (action.type) {
    case 'UPDATE_FIELD':
      return { ...state, [action.field]: action.value }
    case 'RESET':
      return toFormState(action.organizer)
    default:
      return state
  }
}

/** Seed the reducer from the loaded profile. Also used by `reset`. */
function toFormState(organizer: OrganizerProfile): ProfileFormState {
  return {
    name: organizer.name,
    bio: organizer.description ?? '',
    contact: organizer.contact ?? '',
    timezone: organizer.timezone,
    location: organizer.location ?? '',
    slug: organizer.slug,
  }
}

export function useProfileForm(organizer: OrganizerProfile, onSaveSuccess?: () => void) {
  const updateProfile = useUpdateOrganizerProfile()

  // Lazy initializer: `toFormState` runs on mount instead of every render.
  const [state, dispatch] = useReducer(profileFormReducer, organizer, toFormState)

  const avatar = useImageUpload({
    contentType: avatarContentType,
    maxBytes: AVATAR_MAX_BYTES,
    maxBytesLabel: '5 MB',
    mutation: useUploadAvatar(),
    // The avatar mutation persists the URL itself and updates the cache.
    onUploaded: () => toast.success('Photo updated'),
  })

  const updateField = (field: keyof ProfileFormState) => (value: string) => {
    dispatch({ type: 'UPDATE_FIELD', field, value })
  }

  const reset = () => {
    dispatch({ type: 'RESET', organizer })
  }

  const getChanges = (): UpdateOrganizerProfileInput => {
    const input: UpdateOrganizerProfileInput = {}

    if (state.name !== organizer.name) input.name = state.name
    if (state.slug !== organizer.slug) input.slug = state.slug
    if (state.bio !== (organizer.description ?? '')) input.description = state.bio || null
    if (state.contact !== (organizer.contact ?? '')) input.contact = state.contact || null
    if (state.timezone !== organizer.timezone) input.timezone = state.timezone
    if (state.location !== (organizer.location ?? '')) input.location = state.location || null

    return input
  }

  const hasChanges = () => Object.keys(getChanges()).length > 0

  const save = () => {
    const changes = getChanges()

    if (!hasChanges()) {
      toast.info('No changes to save')
      return
    }

    updateProfile.mutate(changes, {
      onSuccess: () => {
        toast.success('Profile updated')
        onSaveSuccess?.()
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to update profile')
      },
    })
  }

  return {
    state,
    updateField,
    reset,
    getChanges,
    hasChanges,
    save,
    isSaving: updateProfile.isPending,
    // Avatar upload — shared with the service cover picker.
    fileInputRef: avatar.inputRef,
    handleAvatarChange: avatar.onFileChange,
    triggerAvatarUpload: avatar.open,
    isUploadingAvatar: avatar.isUploading,
  }
}
