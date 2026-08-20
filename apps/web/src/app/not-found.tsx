import { ArrowLeftIcon, MapPinnedIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export default async function NotFound() {
  const t = await getTranslations('NotFound')

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MapPinnedIcon />
          </EmptyMedia>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/">
                <ArrowLeftIcon data-icon="inline-start" />
                {t('backHome')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/booking">
                <SearchIcon data-icon="inline-start" />
                {t('findMyBooking')}
              </Link>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}
