'use client'

import type { OrganizerProfile } from '@repo/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useController } from 'react-hook-form'

import { useCurrentOrganizer } from '@/api-client'
import { FieldShell } from '@/components/field-shell'
import { FormTextField } from '@/components/form-field'
import { MarkdownEditor } from '@/components/markdown/markdown-editor'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { timezoneLabel, TIMEZONES } from '@/constants/timezones'
import { AvatarField } from './avatar-field'
import { SlugField } from './slug-field'
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
  const locale = useLocale()

  // A stored zone missing from the curated list still needs an option or
  // the Select renders blank.
  const timezoneOptions =
    timezone.field.value && !TIMEZONES.includes(timezone.field.value)
      ? [timezone.field.value, ...TIMEZONES]
      : TIMEZONES

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
          <AvatarField
            organizer={organizer}
            fileInputRef={fileInputRef}
            isUploading={isUploadingAvatar}
            isReadOnly={isReadOnly}
            onTriggerUpload={triggerAvatarUpload}
            onAvatarChange={handleAvatarChange}
          />
          <FieldGroup>
            <FormTextField
              control={form.control}
              name="name"
              label={t('displayName')}
              disabled={isReadOnly}
            />
            <SlugField
              field={slug.field}
              invalid={slug.fieldState.invalid}
              error={slug.fieldState.error}
              isEditable={isSlugEditable}
              onEdit={() => setIsSlugEditable(true)}
              isReadOnly={isReadOnly}
            />
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
              <FormTextField
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
                      {timezoneOptions.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {timezoneLabel(tz, locale)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FieldShell>
            </div>
            <FormTextField
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
