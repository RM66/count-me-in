import { ChevronDown } from 'lucide-react'

// Answers reflect the MVP scope in the docs:
// - price is *display text*, no payments (domain.md: `defaultPrice` "not a payment amount")
// - guests need no account, just a messenger login (ADR-002, ADR-008)
// - cancellations via a secure manage link (domain.md Booking / manageToken)
// Messenger is kept generic on purpose — more messengers are planned beyond the MVP.
// Exported so the FAQPage JSON-LD in page.tsx is generated from this single
// source of truth and can never drift from the visible copy.
export const faqs = [
  {
    q: 'Is CountMeIn really free?',
    a: 'Yes — while the service is new, it’s completely free: create your account, publish services, and take bookings at no cost. Down the road we may introduce an optional paid subscription at a symbolic price, but you can get started for free today.',
  },
  {
    q: 'Do my guests need to install an app or create an account?',
    a: 'No. Guests open your link, pick a slot, and confirm with their messenger login and a name. There’s no separate app to download and no password to remember.',
  },
  {
    q: 'Does CountMeIn handle payments?',
    a: 'Not yet. Prices are shown as text on your services so guests know the cost, but payment happens the way you already collect it. Booking is about reserving the seat.',
  },
  {
    q: 'How do guests and I get notified?',
    a: 'Confirmations, cancel links, and new-booking alerts arrive in the messenger you and your guests already use — each new booking pings you with a deep link to your cabinet.',
  },
  {
    q: 'Can a slot ever be overbooked?',
    a: 'No. Every slot has a seat count and bookings are claimed atomically, so once a class is full it stops accepting bookings — no double-booking.',
  },
  {
    q: 'What if a guest needs to cancel?',
    a: 'Guests manage their booking from a secure link. The moment they cancel, the seat is released and becomes available to someone else.',
  },
]

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Frequently asked questions
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">
          Everything you might want to know before you publish your first service.
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        {faqs.map((item) => (
          <details key={item.q} className="group rounded-xl border p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm text-muted-foreground text-pretty">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
