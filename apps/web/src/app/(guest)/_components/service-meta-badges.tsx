import type { ServiceRecord } from '@repo/api-contracts'
import { Clock, Users } from 'lucide-react'

/**
 * The duration / capacity / price meta row shown under a service title.
 *
 * Extracted from the two places that had this exact layout: the public service
 * card (compact) and the service detail page (with gap-1.5). The `className`
 * lets each caller keep its own spacing without re-implementing the badges.
 */
export function ServiceMetaBadges({
  service,
  className,
}: {
  service: ServiceRecord
  className?: string
}) {
  return (
    <div
      className={
        className ?? 'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'
      }
    >
      <span className="flex items-center gap-1">
        <Clock className="size-3.5" />
        {service.defaultDurationMinutes} min
      </span>
      <span className="flex items-center gap-1">
        <Users className="size-3.5" />
        up to {service.defaultCapacity}
      </span>
      <span className="font-medium text-foreground">{service.defaultPrice}</span>
    </div>
  )
}
