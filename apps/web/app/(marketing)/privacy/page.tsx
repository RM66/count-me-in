import type { Metadata } from 'next'

import { LegalPage, LegalSection } from '@/app/(marketing)/_components/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy — CountMeIn',
  description: 'How CountMeIn handles organizer and guest data.',
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 1, 2026">
      <p>
        This privacy policy is a placeholder for the CountMeIn design mockups. It describes, at a
        high level, the data CountMeIn collects and how it is used.
      </p>
      <LegalSection heading="Data we collect">
        <p>
          For organizers: name, phone number, messenger handle, timezone, and the services and slots
          you publish. For guests: name and phone number, used to confirm and manage a booking.
        </p>
      </LegalSection>
      <LegalSection heading="How we use it">
        <p>
          Phone numbers are used to verify bookings via a one-time code sent through your messenger,
          and to deliver confirmations and cancellation links. We do not sell personal data.
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
