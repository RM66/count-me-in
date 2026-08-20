import { getTranslations } from 'next-intl/server'

import { LegalPage, LegalSection } from '@/app/(marketing)/_components/legal-page'

export async function generateMetadata() {
  const t = await getTranslations('Legal.privacy')
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function PrivacyPage() {
  const t = await getTranslations('Legal')

  return (
    <LegalPage title={t('privacy.title')} updated={t('privacy.updated')}>
      <p>{t('privacy.intro')}</p>
      <LegalSection heading={t('privacy.collectHeading')}>
        <p>{t('privacy.collectBody')}</p>
      </LegalSection>
      <LegalSection heading={t('privacy.useHeading')}>
        <p>{t('privacy.useBody')}</p>
      </LegalSection>
      <LegalSection heading={t('privacy.analyticsHeading')}>
        <p>{t('privacy.analyticsBody')}</p>
        <p>{t('privacy.analyticsCookies')}</p>
      </LegalSection>
      <LegalSection heading={t('privacy.retentionHeading')}>
        <p>{t('privacy.retentionBody')}</p>
      </LegalSection>
      <LegalSection heading={t('privacy.contactHeading')}>
        <p>{t('privacy.contactBody')}</p>
      </LegalSection>
    </LegalPage>
  )
}
