'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { PlusIcon, XIcon, ImageIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { Service } from '@/lib/mock-data'

export function ServiceForm({ service }: { service?: Service }) {
  const router = useRouter()
  const isEdit = Boolean(service)
  const [options, setOptions] = useState<string[]>(service?.options ?? [])
  const [optionDraft, setOptionDraft] = useState('')
  const [selectMode, setSelectMode] = useState(service?.optionsSelectMode ?? 'single')

  function addOption() {
    const val = optionDraft.trim()
    if (!val) return
    setOptions((prev) => [...prev, val])
    setOptionDraft('')
  }

  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i))
  }

  function onSave() {
    toast.success(isEdit ? 'Service updated' : 'Service created', {
      description: 'This is a design mockup — no data was saved.',
    })
    router.push('/dashboard/services')
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Basic information guests will see.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input
                  id="title"
                  defaultValue={service?.title}
                  placeholder="e.g. Morning Vinyasa Flow"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea
                  id="description"
                  rows={4}
                  defaultValue={service?.description}
                  placeholder="Describe what guests can expect..."
                />
                <FieldDescription>
                  Shown on the service page. Markdown is not supported.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Defaults</CardTitle>
            <CardDescription>
              Applied to new slots. You can override them per slot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="price">Price</FieldLabel>
                  <Input id="price" defaultValue={service?.defaultPrice} placeholder="1200 RSD" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="capacity">Capacity</FieldLabel>
                  <Input
                    id="capacity"
                    type="number"
                    defaultValue={service?.defaultCapacity ?? 10}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="duration">Duration (min)</FieldLabel>
                  <Input
                    id="duration"
                    type="number"
                    defaultValue={service?.defaultDurationMinutes ?? 60}
                  />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking options</CardTitle>
            <CardDescription>
              Optional add-ons or choices guests pick when booking.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="option">Add an option</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="option"
                    value={optionDraft}
                    onChange={(e) => setOptionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        addOption()
                      }
                    }}
                    placeholder="e.g. Riverside studio"
                  />
                  <Button type="button" variant="outline" onClick={addOption}>
                    <PlusIcon data-icon="inline-start" />
                    Add
                  </Button>
                </div>
              </Field>

              {options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {options.map((opt, i) => (
                    <Badge key={`${opt}-${i}`} variant="secondary" className="gap-1 pr-1">
                      {opt}
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="rounded-sm opacity-70 hover:opacity-100"
                        aria-label={`Remove ${opt}`}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {options.length > 0 && (
                <>
                  <Separator />
                  <FieldSet>
                    <FieldLegend>Selection mode</FieldLegend>
                    <RadioGroup
                      value={selectMode}
                      onValueChange={(v) => setSelectMode(v as 'single' | 'multi')}
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem value="single" id="mode-single" />
                        <FieldLabel htmlFor="mode-single" className="font-normal">
                          Single choice (guest picks one)
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem value="multi" id="mode-multi" />
                        <FieldLabel htmlFor="mode-multi" className="font-normal">
                          Multiple choice (guest picks any)
                        </FieldLabel>
                      </Field>
                    </RadioGroup>
                  </FieldSet>
                </>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Cover photo</CardTitle>
            <CardDescription>Shown on your public page.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {service?.photoUrl ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-md border">
                <Image
                  src={service.photoUrl || '/placeholder.svg'}
                  alt={service.title}
                  fill
                  className="object-cover"
                  sizes="33vw"
                />
              </div>
            ) : (
              <div className="flex aspect-[16/9] w-full items-center justify-center rounded-md border border-dashed">
                <ImageIcon className="size-8 text-muted-foreground" />
              </div>
            )}
            <Button variant="outline" className="w-full">
              <ImageIcon data-icon="inline-start" />
              Upload image
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publish</CardTitle>
            <CardDescription>Save changes to this service.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={onSave}>{isEdit ? 'Save changes' : 'Create service'}</Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard/services')}>
              Cancel
            </Button>
            {isEdit && (
              <>
                <Separator className="my-1" />
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    toast('Delete service?', {
                      description: 'This is a mockup — nothing was deleted.',
                    })
                  }
                >
                  <Trash2Icon data-icon="inline-start" />
                  Delete service
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
