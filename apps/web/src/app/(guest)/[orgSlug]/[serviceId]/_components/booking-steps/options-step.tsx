'use client'

import type { ServiceRecord } from '@repo/contracts'
import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

/**
 * Step 2: choose options (add-ons or single-choice).
 *
 * Only rendered when the service has options. The selection mode (single vs
 * multi) comes from the service and decides whether this is a `RadioGroup` or a
 * checkbox list.
 */
export function OptionsStep({
  service,
  selectedOptions,
  onToggleOption,
  onBack,
  onContinue,
}: {
  service: ServiceRecord
  selectedOptions: string[]
  onToggleOption: (value: string) => void
  onBack: () => void
  onContinue: () => void
}) {
  const t = useTranslations('Booking')

  return (
    <div className="flex flex-col gap-4">
      {service.optionsSelectMode === 'single' ? (
        <RadioGroup
          value={selectedOptions[0]}
          onValueChange={(v) => onToggleOption(v)}
          className="gap-2"
        >
          {service.options?.map((opt) => (
            <label
              key={opt}
              htmlFor={`opt-${opt}`}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                selectedOptions[0] === opt && 'border-primary bg-accent',
              )}
            >
              <RadioGroupItem id={`opt-${opt}`} value={opt} />
              <span className="text-sm font-medium">{opt}</span>
            </label>
          ))}
        </RadioGroup>
      ) : (
        <FieldSet>
          <FieldLegend className="sr-only">{t('optionsLegend')}</FieldLegend>
          <div className="flex flex-col gap-2">
            {service.options?.map((opt) => (
              <label
                key={opt}
                htmlFor={`opt-${opt}`}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                  selectedOptions.includes(opt) && 'border-primary bg-accent',
                )}
              >
                <Checkbox
                  id={`opt-${opt}`}
                  checked={selectedOptions.includes(opt)}
                  onCheckedChange={() => onToggleOption(opt)}
                />
                <span className="text-sm font-medium">{opt}</span>
              </label>
            ))}
          </div>
        </FieldSet>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          {t('back')}
        </Button>
        <Button
          className="flex-1"
          disabled={service.optionsSelectMode === 'single' && !selectedOptions.length}
          onClick={onContinue}
        >
          {t('continue')}
        </Button>
      </div>
    </div>
  )
}
