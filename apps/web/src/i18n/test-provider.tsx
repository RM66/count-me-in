import type { AppLocale } from '@repo/contracts'
import { DEFAULT_LOCALE } from '@repo/contracts'
import { WEB_MESSAGES } from '@repo/translations'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

/**
 * Test wrapper providing the intl context (locale + that locale's messages)
 * that `useTranslations` needs. Client components translated in this iteration
 * (`BookingManage`, the booking dialog steps, …) are rendered through it in
 * their co-located tests.
 */
export function IntlTestProvider({
  children,
  locale = DEFAULT_LOCALE,
}: {
  children: ReactNode
  locale?: AppLocale
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={WEB_MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  )
}
