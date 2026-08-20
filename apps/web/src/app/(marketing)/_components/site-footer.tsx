import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { SUPPORT_EMAIL } from '@/constants/site'

export async function SiteFooter() {
  const t = await getTranslations('Marketing.footer')

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={24} height={24} className="size-6" />
          <span className="font-semibold">CountMeIn</span>
          <span className="text-sm text-muted-foreground">{t('tagline')}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/#features" className="hover:text-foreground">
            {t('features')}
          </Link>
          <Link href="/login" className="hover:text-foreground">
            {t('logIn')}
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            {t('terms')}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t('privacy')}
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">
            {t('contact')}
          </a>
        </nav>
        <p className="text-sm text-muted-foreground">{t('copyright')}</p>
      </div>
    </footer>
  )
}
