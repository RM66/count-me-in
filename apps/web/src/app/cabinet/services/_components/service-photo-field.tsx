'use client'

import { SERVICE_PHOTO_MAX_BYTES, servicePhotoContentType } from '@repo/contracts'
import { ImageIcon, XIcon } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useController } from 'react-hook-form'
import { toast } from 'sonner'

import { useUploadServicePhoto } from '@/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useImageUpload } from '@/hooks/use-image-upload'
import type { ServiceFormControl } from './use-service-form'

/**
 * Cover photo picker.
 *
 * The uploaded URL is held in form state and persisted on save: a new service
 * has no row to attach it to yet, and cancelling must not change stored data.
 */
export function ServicePhotoField({
  control,
  disabled,
}: {
  control: ServiceFormControl
  disabled?: boolean
}) {
  const { field: photoUrl } = useController({ control, name: 'photoUrl' })
  const { field: title } = useController({ control, name: 'title' })
  const t = useTranslations('Cabinet.services')

  const upload = useImageUpload({
    contentType: servicePhotoContentType,
    maxBytes: SERVICE_PHOTO_MAX_BYTES,
    maxBytesLabel: '10 MB',
    mutation: useUploadServicePhoto(),
    onUploaded: (url) => {
      // `shouldDirty` is what enables Save — without it an upload alone would
      // leave the form pristine and the button disabled.
      photoUrl.onChange(url, { shouldDirty: true })
      toast.success(t('photoReady'))
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('coverPhoto')}</CardTitle>
        <CardDescription>{t('coverHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {photoUrl.value ? (
          <div className="relative aspect-video w-full overflow-hidden rounded-md border">
            <Image
              src={photoUrl.value}
              alt={title.value || t('serviceCover')}
              fill
              className="object-cover"
              sizes="33vw"
            />
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed">
            <ImageIcon className="size-8 text-muted-foreground" />
          </div>
        )}

        <input
          ref={upload.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={upload.onFileChange}
        />

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={upload.open}
          disabled={upload.isUploading || disabled}
        >
          <ImageIcon data-icon="inline-start" />
          {upload.isUploading ? t('uploading') : photoUrl.value ? t('replaceImage') : t('uploadImage')}
        </Button>

        {photoUrl.value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => photoUrl.onChange(null, { shouldDirty: true })}
          >
            <XIcon data-icon="inline-start" />
            {t('removeImage')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
