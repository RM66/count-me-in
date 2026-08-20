'use client'

import type { OrganizerProfile } from '@repo/contracts'
import { CopyIcon, ImageIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { useCurrentOrganizer } from '@/api-client'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
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
  const form = useProfileForm(organizer, () => setIsSlugEditable(false))
  const t = useTranslations('Cabinet.settings')
  const tc = useTranslations('Cabinet.common')

  // Read-only demo account (ADR-010). Copy / navigation stay enabled — only
  // controls that would write are locked. The API rejects demo writes anyway.
  const isReadOnly = organizer.isDemo

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('profile')}</CardTitle>
          <CardDescription>{t('profileDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage
                src={organizer.photoUrl || '/placeholder.svg'}
                sizes="4rem"
                alt={organizer.name}
              />
              <AvatarFallback>{initials(organizer.name)}</AvatarFallback>
            </Avatar>
            <input
              ref={form.fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={form.handleAvatarChange}
            />
            <Button
              variant="outline"
              onClick={form.triggerAvatarUpload}
              disabled={form.isUploadingAvatar || isReadOnly}
            >
              <ImageIcon data-icon="inline-start" />
              {form.isUploadingAvatar ? t('uploading') : t('changePhoto')}
            </Button>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">{t('displayName')}</FieldLabel>
              <Input
                id="name"
                value={form.state.name}
                onChange={(e) => form.updateField('name')(e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">{t('publicPageUrl')}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{SITE_DOMAIN}/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="slug"
                  value={form.state.slug}
                  onChange={(e) => form.updateField('slug')(e.target.value)}
                  disabled={!isSlugEditable || isReadOnly}
                />
                <InputGroupAddon align="inline-end" className="max-sm:gap-0">
                  {!isSlugEditable && !isReadOnly && (
                    <Button size="sm" variant="ghost" onClick={() => setIsSlugEditable(true)}>
                      <PencilIcon data-icon="inline-start" />
                      <span className="max-sm:hidden">{t('edit')}</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(`${SITE_URL}/${form.state.slug}`)
                      toast.success(t('linkCopied'))
                    }}
                  >
                    <CopyIcon data-icon="inline-start" />
                    <span className="max-sm:hidden">{t('copy')}</span>
                  </Button>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {isReadOnly
                  ? t('slugFixed')
                  : !isSlugEditable
                    ? t('slugEditable')
                    : t('slugWarning')}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="bio">{t('bio')}</FieldLabel>
              <MarkdownEditor
                value={form.state.bio}
                onChange={form.updateField('bio')}
                height="220px"
                readOnly={isReadOnly}
              />
              <FieldDescription>{t('bioHint')}</FieldDescription>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contact">{t('contact')}</FieldLabel>
                <Input
                  id="contact"
                  value={form.state.contact}
                  onChange={(e) => form.updateField('contact')(e.target.value)}
                  placeholder={t('contactPlaceholder')}
                  disabled={isReadOnly}
                />
                <FieldDescription>{t('contactHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="tz">{t('timezone')}</FieldLabel>
                <Select
                  value={form.state.timezone}
                  onValueChange={form.updateField('timezone')}
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
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="location">{t('location')}</FieldLabel>
              <Input
                id="location"
                value={form.state.location}
                onChange={(e) => form.updateField('location')(e.target.value)}
                placeholder={t('locationPlaceholder')}
                disabled={isReadOnly}
              />
              <FieldDescription>{t('locationHint')}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={form.save} disabled={form.isSaving || isReadOnly}>
            {form.isSaving ? tc('saving') : t('saveChanges')}
          </Button>
        </CardFooter>
      </Card>

      {/* TODO: Notifications tab ('@/components/ui/tabs') */}
    </div>
  )
}
