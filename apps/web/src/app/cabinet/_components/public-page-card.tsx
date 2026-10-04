import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SITE_DOMAIN } from '@/constants/site'

/** The overview's public-page card: the organizer's shareable booking URL. */
export function PublicPageCard({ slug }: { slug: string }) {
  const t = useTranslations('Cabinet.overview')
  const tc = useTranslations('Cabinet.common')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('yourPublicPage')}</CardTitle>
          <CardDescription>{t('shareLink')}</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${slug}`} target="_blank">
            <ExternalLinkIcon data-icon="inline-start" />
            {tc('open')}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <code className="rounded-md bg-muted px-3 py-2 text-sm">
          {SITE_DOMAIN}/{slug}
        </code>
      </CardContent>
    </Card>
  )
}
