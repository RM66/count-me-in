import type { Metadata } from 'next'

import { LegalPage, LegalSection } from '@/app/(marketing)/_components/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy — CountMeIn',
  description: 'How CountMeIn handles organizer and guest data.',
}

// Static legal content — prerendered at build time.
export const dynamic = 'force-static'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="August 7, 2026">
      <p>This privacy policy describes the data CountMeIn collects and how it is used.</p>
      <LegalSection heading="Data we collect">
        <p>
          For organizers: name, messenger account, timezone, and the services and slots you publish.
          For guests: display name and messenger account, used to confirm and manage a booking.
        </p>
      </LegalSection>
      <LegalSection heading="How we use it">
        <p>
          Messenger accounts are verified through the Messenger Login Widget at booking time — no
          one-time codes or passwords are collected. We use your messenger account to deliver
          booking confirmations and cancellation links. We do not sell personal data.
        </p>
      </LegalSection>
      <LegalSection heading="Analytics and error monitoring">
        <p>
          We use PostHog for product analytics (page views, feature usage) and Sentry for error
          monitoring (crash reports and performance traces). PostHog session recordings are enabled
          with all input fields masked, so no typed personal data appears in recordings. Signed-in
          organizers are identified by an internal id so their activity can be grouped; guests are
          not identified in analytics. Neither service receives your messenger credentials.
        </p>
      </LegalSection>
      <LegalSection heading="Retention">
        <p>
          Booking records are retained so organizers can view their history. Guests can cancel a
          booking at any time from their management link.
        </p>
      </LegalSection>
      <LegalSection heading="Contact">
        <p>
          Questions about privacy can be directed to the organizer you booked with, or to the
          CountMeIn team.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
