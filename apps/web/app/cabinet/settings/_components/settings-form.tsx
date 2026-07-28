'use client'

import { CopyIcon, ImageIcon } from 'lucide-react'
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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { organizer } from '@/lib/mock-data'

function saved() {
  toast.success('Changes saved', {
    description: 'This is a design mockup — no data was saved.',
  })
}

export function SettingsForm() {
  const [bio, setBio] = useState(organizer.description)

  return (
    <Tabs defaultValue="profile" className="gap-6">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="public">Public page</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="flex flex-col gap-6">
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
                <AvatarFallback>SL</AvatarFallback>
              </Avatar>
              <Button variant="outline">
                <ImageIcon data-icon="inline-start" />
                Change photo
              </Button>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Display name</FieldLabel>
                <Input id="name" defaultValue={organizer.name} />
              </Field>
              <Field>
                <FieldLabel htmlFor="bio">Bio</FieldLabel>
                <MarkdownEditor value={bio} onChange={setBio} height="220px" />
                <FieldDescription>
                  Shown at the top of your public page. Markdown is supported.
                </FieldDescription>
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="contact">Contact</FieldLabel>
                  <Input
                    id="contact"
                    defaultValue={organizer.contact ?? ''}
                    placeholder="e.g. +381 64 123 4567 or studio@example.com"
                  />
                  <FieldDescription>
                    Shown to guests on your public page. Phone, email, website, or any text.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="tz">Timezone</FieldLabel>
                  <Select defaultValue={organizer.timezone}>
                    <SelectTrigger id="tz">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="Europe/Belgrade">Europe/Belgrade (CET)</SelectItem>
                        <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                        <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={saved}>Save changes</Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="public" className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Public page</CardTitle>
            <CardDescription>Your bookable link and handle.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="slug">Page handle</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>countmein.group/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput id="slug" defaultValue={organizer.slug} />
                </InputGroup>
                <FieldDescription>Guests visit this link to browse and book.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="share">Share link</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="share"
                    readOnly
                    value={`https://countmein.group/${organizer.slug}`}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        toast.success('Link copied', { description: 'This is a mockup.' })
                      }
                    >
                      <CopyIcon data-icon="inline-start" />
                      Copy
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={saved}>Save changes</Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="notifications" className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Choose how you and guests get updates.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <Field orientation="horizontal">
              <div className="flex flex-col gap-0.5">
                <FieldTitle>New booking alerts</FieldTitle>
                <FieldDescription>Get notified when someone books.</FieldDescription>
              </div>
              <Switch defaultChecked />
            </Field>
            <Separator />
            <Field orientation="horizontal">
              <div className="flex flex-col gap-0.5">
                <FieldTitle>Cancellation alerts</FieldTitle>
                <FieldDescription>Get notified when a guest cancels.</FieldDescription>
              </div>
              <Switch defaultChecked />
            </Field>
            <Separator />
            <Field orientation="horizontal">
              <div className="flex flex-col gap-0.5">
                <FieldTitle>Guest reminders</FieldTitle>
                <FieldDescription>
                  Automatically remind guests 24h before their slot.
                </FieldDescription>
              </div>
              <Switch defaultChecked />
            </Field>
            <Separator />
            <Field orientation="horizontal">
              <div className="flex flex-col gap-0.5">
                <FieldTitle>Weekly summary</FieldTitle>
                <FieldDescription>A digest of the week every Monday.</FieldDescription>
              </div>
              <Switch />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={saved}>Save changes</Button>
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
