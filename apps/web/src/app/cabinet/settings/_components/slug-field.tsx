'use client'

import type { OrganizerFormValues } from '@repo/contracts'
import { CopyIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ControllerRenderProps, FieldError } from 'react-hook-form'
import { toast } from 'sonner'

import { FieldShell } from '@/components/field-shell'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { SITE_DOMAIN, SITE_URL } from '@/constants/site'

type SlugFieldProps = {
  /** The RHF slug field — registered as "slug" in the profile form. */
  field: ControllerRenderProps<OrganizerFormValues, 'slug'>
  invalid: boolean
  error?: FieldError
  /** Whether the input is unlocked — a guarded edit (see `slugWarning`). */
  isEditable: boolean
  onEdit: () => void
  /** Read-only demo account (ADR-010). Copy stays enabled — it doesn't write. */
  isReadOnly: boolean
}

/**
 * The public-page URL field: the slug input behind a deliberate "Edit" unlock
 * (its warning explains the link breaks) with a copy-to-clipboard affordance.
 */
export function SlugField({
  field,
  invalid,
  error,
  isEditable,
  onEdit,
  isReadOnly,
}: SlugFieldProps) {
  const t = useTranslations('Cabinet.settings')

  return (
    <FieldShell
      htmlFor="slug"
      label={t('publicPageUrl')}
      description={isReadOnly ? t('slugFixed') : !isEditable ? t('slugEditable') : t('slugWarning')}
      invalid={invalid}
      error={error}
    >
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>{SITE_DOMAIN}/</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          {...field}
          id="slug"
          disabled={!isEditable || isReadOnly}
          aria-invalid={invalid || undefined}
        />
        <InputGroupAddon align="inline-end" className="max-sm:gap-0">
          {!isEditable && !isReadOnly && (
            <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
              <PencilIcon data-icon="inline-start" />
              <span className="max-sm:hidden">{t('edit')}</span>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            // writeText rejects on insecure contexts / denied
            // permission — claim success only after it resolves.
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${SITE_URL}/${field.value}`)
                toast.success(t('linkCopied'))
              } catch {
                toast.error(t('copyFailed'))
              }
            }}
          >
            <CopyIcon data-icon="inline-start" />
            <span className="max-sm:hidden">{t('copy')}</span>
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </FieldShell>
  )
}
