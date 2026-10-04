'use client'

import type { OrganizerProfile } from '@repo/contracts'
import { imageContentType } from '@repo/contracts'
import { ImageIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { RefObject } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { initials } from '@/helpers/name'

type AvatarFieldProps = {
  organizer: OrganizerProfile
  /** The hidden file input the button proxies a click to. */
  fileInputRef: RefObject<HTMLInputElement | null>
  isUploading: boolean
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
  onTriggerUpload: () => void
  onAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

/** The profile avatar block: the current photo plus the upload trigger. */
export function AvatarField({
  organizer,
  fileInputRef,
  isUploading,
  isReadOnly,
  onTriggerUpload,
  onAvatarChange,
}: AvatarFieldProps) {
  const t = useTranslations('Cabinet.settings')

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        {organizer.photoUrl ? (
          <AvatarImage src={organizer.photoUrl} sizes="4rem" alt={organizer.name} />
        ) : null}
        <AvatarFallback>{initials(organizer.name)}</AvatarFallback>
      </Avatar>
      <input
        ref={fileInputRef}
        type="file"
        accept={imageContentType.options.join(',')}
        className="hidden"
        onChange={onAvatarChange}
      />
      <Button
        type="button"
        variant="outline"
        onClick={onTriggerUpload}
        disabled={isUploading || isReadOnly}
      >
        <ImageIcon data-icon="inline-start" />
        {isUploading ? t('uploading') : t('changePhoto')}
      </Button>
    </div>
  )
}
