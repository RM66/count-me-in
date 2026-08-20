import { getTranslations } from 'next-intl/server'

import { LegalPage, LegalSection } from '@/app/(marketing)/_components/legal-page'

export async function generateMetadata() {
  const t = await getTranslations('Legal.terms')
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function TermsPage() {
  const t = await getTranslations('Legal')

  return (
    <LegalPage title={t('terms.title')} updated={t('terms.updated')}>
      <p>{t('terms.intro')}</p>
      <LegalSection heading={t('terms.usingHeading')}>
        <p>{t('terms.usingBody')}</p>
      </LegalSection>
      <LegalSection heading={t('terms.bookingsHeading')}>
        <p>{t('terms.bookingsBody')}</p>
      </LegalSection>
      <LegalSection heading={t('terms.guestDataHeading')}>
        <p>{t('terms.guestDataBody')}</p>
      </LegalSection>
      <LegalSection heading={t('terms.cancellationsHeading')}>
        <p>{t('terms.cancellationsBody')}</p>
      </LegalSection>
      <LegalSection heading={t('terms.changesHeading')}>
        <p>{t('terms.changesBody')}</p>
      </LegalSection>
    </LegalPage>
  )
}
