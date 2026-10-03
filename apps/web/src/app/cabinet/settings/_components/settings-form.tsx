'use client'

import type { OrganizerProfile } from '@repo/contracts'
import { CopyIcon, ImageIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useController } from 'react-hook-form'
import { toast } from 'sonner'

import { useCurrentOrganizer } from '@/api-client'
import { FieldShell } from '@/components/field-shell'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SITE_DOMAIN, SITE_URL } from '@/constants/site'
import { TIMEZONES } from '@/constants/timezones'
import { initials } from '@/helpers/name'
import type { ProfileFormControl, ProfileTextFieldName } from './use-profile-form'
import { useProfileForm } from './use-profile-form'

export function SettingsForm() {
  const { data: organizer, isPending, isError } = useCurrentOrganizer()
  const t = useTranslations('Cabinet.settings')

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (isError || !organizer) {
    return <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
  }

  return <SettingsFormInner organizer={organizer} />
}

function SettingsFormInner({ organizer }: { organizer: OrganizerProfile }) {
  const [isSlugEditable, setIsSlugEditable] = useState(false)
  const {
    form,
    save,
    isSaving,
    fileInputRef,
    handleAvatarChange,
    triggerAvatarUpload,
    isUploadingAvatar,
  } = useProfileForm(organizer, () => setIsSlugEditable(false))
  const t = useTranslations('Cabinet.settings')
  const tc = useTranslations('Cabinet.common')

  const slug = useController({ control: form.control, name: 'slug' })
  const description = useController({ control: form.control, name: 'description' })
  const timezone = useController({ control: form.control, name: 'timezone' })

  // Read-only demo account (ADR-010). Copy / navigation stay enabled — only
  // controls that would write are locked. The API rejects demo writes anyway.
  const isReadOnly = organizer.isDemo

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('profile')}</CardTitle>
          <CardDescription>{t('profileDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
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
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <Button
              type="button"
              variant="outline"
              onClick={triggerAvatarUpload}
              disabled={isUploadingAvatar || isReadOnly}
            >
              <ImageIcon data-icon="inline-start" />
              {isUploadingAvatar ? t('uploading') : t('changePhoto')}
            </Button>
          </div>
          <FieldGroup>
            <SettingsTextField
              control={form.control}
              name="name"
              label={t('displayName')}
              disabled={isReadOnly}
            />
            <FieldShell
              htmlFor="slug"
              label={t('publicPageUrl')}
              description={
                isReadOnly ? t('slugFixed') : !isSlugEditable ? t('slugEditable') : t('slugWarning')
              }
              invalid={slug.fieldState.invalid}
              error={slug.fieldState.error}
            >
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{SITE_DOMAIN}/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  {...slug.field}
                  id="slug"
                  disabled={!isSlugEditable || isReadOnly}
                  aria-invalid={slug.fieldState.invalid || undefined}
                />
                <InputGroupAddon align="inline-end" className="max-sm:gap-0">
                  {!isSlugEditable && !isReadOnly && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsSlugEditable(true)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      <span className="max-sm:hidden">{t('edit')}</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(`${SITE_URL}/${slug.field.value}`)
                      toast.success(t('linkCopied'))
                    }}
                  >
                    <CopyIcon data-icon="inline-start" />
                    <span className="max-sm:hidden">{t('copy')}</span>
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </FieldShell>
            <FieldShell
              htmlFor="bio"
              label={t('bio')}
              description={t('bioHint')}
              invalid={description.fieldState.invalid}
              error={description.fieldState.error}
            >
              <MarkdownEditor
                value={description.field.value}
                onChange={description.field.onChange}
                height="220px"
                readOnly={isReadOnly}
              />
            </FieldShell>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingsTextField
                control={form.control}
                name="contact"
                label={t('contact')}
                placeholder={t('contactPlaceholder')}
                description={t('contactHint')}
                disabled={isReadOnly}
              />
              <FieldShell
                htmlFor="tz"
                label={t('timezone')}
                invalid={timezone.fieldState.invalid}
                error={timezone.fieldState.error}
              >
                <Select
                  value={timezone.field.value}
                  onValueChange={timezone.field.onChange}
                  disabled={isReadOnly}
                >
                  <SelectTrigger id="tz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldShell>
            </div>
            <SettingsTextField
              control={form.control}
              name="location"
              label={t('location')}
              placeholder={t('locationPlaceholder')}
              description={t('locationHint')}
              disabled={isReadOnly}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={isSaving || isReadOnly}>
            {isSaving ? tc('saving') : t('saveChanges')}
          </Button>
        </CardFooter>
      </Card>

      {/* TODO: Notifications tab ('@/components/ui/tabs') */}
    </form>
  )
}

/** Single-line text field — the plain inputs share the invalid-state plumbing. */
function SettingsTextField({
  control,
  name,
  label,
  description,
  placeholder,
  disabled,
}: {
  control: ProfileFormControl
  name: ProfileTextFieldName
  label: string
  description?: string
  placeholder?: string
  disabled?: boolean
}) {
  const { field, fieldState } = useController({ control, name })

  return (
    <FieldShell
      htmlFor={name}
      label={label}
      description={description}
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Input
        {...field}
        id={name}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}
