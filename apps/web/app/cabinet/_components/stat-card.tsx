import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function StatCard({
  title,
  value,
  hint,
  delta,
  icon: Icon,
}: {
  title: string
  value: string
  hint?: string
  delta?: string
  icon: LucideIcon
}) {
  return (
    <Card className="justify-between gap-1">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold tracking-tight">{value}</span>
          {delta && <Badge variant="secondary">{delta}</Badge>}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}
