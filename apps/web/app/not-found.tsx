import Link from 'next/link'
import { MapPinnedIcon, ArrowLeftIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MapPinnedIcon />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            We could not find the page you were looking for. It may have been moved or the link is
            no longer valid.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/">
                <ArrowLeftIcon data-icon="inline-start" />
                Back home
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/b">
                <SearchIcon data-icon="inline-start" />
                Find my booking
              </Link>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}
