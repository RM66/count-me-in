'use client'

import { PlusIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useController } from 'react-hook-form'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import type { ServiceFormControl } from './use-service-form'

/**
 * Options list + selection mode.
 *
 * The "add an option" draft is local state on purpose: it never reaches the
 * payload, and keeping it out of the form means typing here re-renders only this
 * card instead of every field in the form.
 */
export function ServiceOptionsField({
  control,
  disabled,
}: {
  control: ServiceFormControl
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const t = useTranslations('Cabinet.services')

  const { field: options, fieldState } = useController({ control, name: 'options' })
  const { field: selectMode } = useController({ control, name: 'optionsSelectMode' })

  const addOption = () => {
    const value = draft.trim()
    // Silently ignore empties and duplicates — the schema rejects duplicates,
    // but re-typing an existing label is a slip, not an error worth a message.
    if (value && !options.value.includes(value)) {
      options.onChange([...options.value, value])
    }
    setDraft('')
  }

  const removeOption = (index: number) => {
    options.onChange(options.value.filter((_, i) => i !== index))
  }

  const hasOptions = options.value.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('optionsTitle')}</CardTitle>
        <CardDescription>{t('optionsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor="option-draft">{t('addOption')}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="option-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    // Adding an option must not submit the surrounding form.
                    event.preventDefault()
                    addOption()
                  }
                }}
                placeholder={t('optionPlaceholder')}
                disabled={disabled}
                aria-invalid={fieldState.invalid || undefined}
              />
              <Button type="button" variant="outline" onClick={addOption} disabled={disabled}>
                <PlusIcon data-icon="inline-start" />
                {t('add')}
              </Button>
            </div>
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </Field>

          {hasOptions && (
            <div className="flex flex-wrap gap-2">
              {options.value.map((option, index) => (
                <Badge key={option} variant="secondary" className="gap-1 pr-1">
                  {option}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="rounded-sm opacity-70 hover:opacity-100"
                      aria-label={t('removeOption', { option })}
                    >
                      <XIcon className="size-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          )}

          {hasOptions && (
            <>
              <Separator />
              <FieldSet>
                <FieldLegend>{t('selectionMode')}</FieldLegend>
                <RadioGroup
                  value={selectMode.value}
                  onValueChange={selectMode.onChange}
                  disabled={disabled}
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem value="single" id="mode-single" />
                    <FieldLabel htmlFor="mode-single" className="font-normal">
                      {t('singleChoice')}
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="multi" id="mode-multi" />
                    <FieldLabel htmlFor="mode-multi" className="font-normal">
                      {t('multipleChoice')}
                    </FieldLabel>
                  </Field>
                </RadioGroup>
              </FieldSet>
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
