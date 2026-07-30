'use client'

import type { OrganizerProfile } from '@repo/api-contracts'
import { CopyIcon, ImageIcon, PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

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
import { useCurrentOrganizer } from '@/lib/api'
import { initials } from '@/lib/helpers/name'
import { TIMEZONES } from '@/lib/helpers/timezone'
import { useProfileForm } from './use-profile-form'
export function SettingsForm() {
  const { data: organizer, isPending, isError } = useCurrentOrganizer()

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (isError || !organizer) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load your profile — refresh the page to try again.
      </p>
    )
  }

  return <SettingsFormInner organizer={organizer} />
}

function SettingsFormInner({ organizer }: { organizer: OrganizerProfile }) {
  const [isSlugEditable, setIsSlugEditable] = useState(false)
  const form = useProfileForm(organizer, () => setIsSlugEditable(false))

  // Read-only demo account (ADR-010). Copy / navigation stay enabled — only
  // controls that would write are locked. The API rejects demo writes anyway.
  const isReadOnly = organizer.isDemo

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to guests.</CardDescription>
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
              {form.isUploadingAvatar ? 'Uploading...' : 'Change photo'}
            </Button>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Display name</FieldLabel>
              <Input
                id="name"
                value={form.state.name}
                onChange={(e) => form.updateField('name')(e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">Public page URL</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>countmein.group/</InputGroupText>
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
                      <span className="max-sm:hidden">Edit</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(`https://countmein.group/${form.state.slug}`)
                      toast.success('Link copied')
                    }}
                  >
                    <CopyIcon data-icon="inline-start" />
                    <span className="max-sm:hidden">Copy</span>
                  </Button>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {isReadOnly
                  ? 'The demo page URL is fixed.'
                  : !isSlugEditable
                    ? 'Your public booking page. Click Edit to change (old links will break).'
                    : 'Warning: Changing this will break existing links shared with guests.'}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="bio">Bio</FieldLabel>
              <MarkdownEditor
                value={form.state.bio}
                onChange={form.updateField('bio')}
                height="220px"
                readOnly={isReadOnly}
              />
              <FieldDescription>
                Shown at the top of your public page. Markdown is supported.
              </FieldDescription>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="contact">Contact</FieldLabel>
                <Input
                  id="contact"
                  value={form.state.contact}
                  onChange={(e) => form.updateField('contact')(e.target.value)}
                  placeholder="e.g. +381 64 123 4567 or studio@example.com"
                  disabled={isReadOnly}
                />
                <FieldDescription>
                  Shown to guests on your public page. Phone, email, social link, etc.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="tz">Timezone</FieldLabel>
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
              <FieldLabel htmlFor="location">Location</FieldLabel>
              <Input
                id="location"
                value={form.state.location}
                onChange={(e) => form.updateField('location')(e.target.value)}
                placeholder="e.g. Belgrade, Serbia"
                disabled={isReadOnly}
              />
              <FieldDescription>
                Optional. Shown on your public page and can be overridden per service.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={form.save} disabled={form.isSaving || isReadOnly}>
            {form.isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </CardFooter>
      </Card>

      {/* TODO: Notifications tab ('@/components/ui/tabs') */}
    </div>
  )
}
