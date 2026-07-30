import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/api-contracts'
import { AVATAR_MAX_BYTES, avatarContentType } from '@repo/api-contracts'
import { useReducer, useRef } from 'react'
import { toast } from 'sonner'

import { useUpdateOrganizerProfile, useUploadAvatar } from '@/lib/api'

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
      return {
        name: action.organizer.name,
        bio: action.organizer.description ?? '',
        contact: action.organizer.contact ?? '',
        timezone: action.organizer.timezone,
        location: action.organizer.location ?? '',
        slug: action.organizer.slug,
      }
    default:
      return state
  }
}

export function useProfileForm(organizer: OrganizerProfile, onSaveSuccess?: () => void) {
  const updateProfile = useUpdateOrganizerProfile()
  const uploadAvatar = useUploadAvatar()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [state, dispatch] = useReducer(profileFormReducer, {
    name: organizer.name,
    bio: organizer.description ?? '',
    contact: organizer.contact ?? '',
    timezone: organizer.timezone,
    location: organizer.location ?? '',
    slug: organizer.slug,
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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Client-side validation
    if (!avatarContentType.safeParse(file.type).success) {
      toast.error('Use a JPEG, PNG or WebP image')
      e.target.value = ''
      return
    }

    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('Image must be under 5 MB')
      e.target.value = ''
      return
    }

    // Upload
    uploadAvatar.mutate(file, {
      onSuccess: () => {
        toast.success('Photo updated')
        e.target.value = ''
      },
      onError: (error) => {
        toast.error(error.message)
        e.target.value = ''
      },
    })
  }

  const triggerAvatarUpload = () => {
    fileInputRef.current?.click()
  }

  return {
    state,
    updateField,
    reset,
    getChanges,
    hasChanges,
    save,
    isSaving: updateProfile.isPending,
    // Avatar upload
    fileInputRef,
    handleAvatarChange,
    triggerAvatarUpload,
    isUploadingAvatar: uploadAvatar.isPending,
  }
}
