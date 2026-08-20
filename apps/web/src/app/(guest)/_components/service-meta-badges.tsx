import type { ServiceRecord } from '@repo/contracts'
import { Clock, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

/**
 * The duration / capacity / price meta row shown under a service title.
 *
 * Extracted from the two places that had this exact layout: the public service
 * card (compact) and the service detail page (with gap-1.5). The `className`
 * lets each caller keep its own spacing without re-implementing the badges.
 */
export async function ServiceMetaBadges({
  service,
  className,
}: {
  service: ServiceRecord
  className?: string
}) {
  const t = await getTranslations('ServiceMetaBadges')

  return (
    <div
      className={
        className ?? 'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'
      }
    >
      <span className="flex items-center gap-1">
        <Clock className="size-3.5" />
        {t('minutes', { minutes: service.defaultDurationMinutes })}
      </span>
      <span className="flex items-center gap-1">
        <Users className="size-3.5" />
        {t('upToCapacity', { capacity: service.defaultCapacity })}
      </span>
      <span className="font-medium text-foreground">{service.defaultPrice}</span>
    </div>
  )
}
