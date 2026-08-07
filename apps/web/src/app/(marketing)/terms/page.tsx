import type { Metadata } from 'next'

import { LegalPage, LegalSection } from '@/app/(marketing)/_components/legal-page'

export const metadata: Metadata = {
  title: 'Terms of Service — CountMeIn',
  description: 'The terms that govern your use of CountMeIn.',
}

// Static legal content — prerendered at build time.
export const dynamic = 'force-static'

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="August 1, 2026">
      <p>
        These terms govern your use of CountMeIn. They outline the agreement between CountMeIn and
        the organizers who publish bookable services on the platform, as well as the guests who book
        them.
      </p>
      <LegalSection heading="1. Using CountMeIn">
        <p>
          CountMeIn lets organizers publish services with time slots and capacity, and lets guests
          book those slots without creating an account. You are responsible for the accuracy of the
          services, prices, and availability you publish.
        </p>
      </LegalSection>
      <LegalSection heading="2. Bookings and capacity">
        <p>
          Prices shown are informational labels only — CountMeIn does not process payments in this
          release. Capacity is enforced per slot; once a slot is full, no further bookings are
          accepted for it.
        </p>
      </LegalSection>
      <LegalSection heading="3. Guest data">
        <p>
          Guests provide a display name and authenticate with their messenger account to book. You
          agree to handle guest details responsibly and only for the purpose of delivering the
          booked service.
        </p>
      </LegalSection>
      <LegalSection heading="4. Cancellations">
        <p>
          Guests may cancel from their secure management link. Cancelling releases the reserved
          seats back to the slot immediately.
        </p>
      </LegalSection>
      <LegalSection heading="5. Changes">
        <p>
          We may update these terms as the product evolves. Continued use after changes take effect
          constitutes acceptance of the revised terms.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
