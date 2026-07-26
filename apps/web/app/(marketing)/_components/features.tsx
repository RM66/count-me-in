import { CalendarDays, Layers, LinkIcon, MessageCircle, ShieldCheck, Users } from 'lucide-react'

const features = [
  {
    icon: Users,
    title: 'Capacity that never overbooks',
    body: 'Every slot has a seat count. Bookings are claimed atomically, so you never double-book a full class.',
  },
  {
    icon: LinkIcon,
    title: 'No account for guests',
    body: 'Guests book with just a name and phone. One shareable link does all the work.',
  },
  {
    icon: MessageCircle,
    title: 'Messenger-native',
    body: 'Verification, confirmations, and cancel links all arrive in the messenger your guests already use.',
  },
  {
    icon: Layers,
    title: 'Flexible options',
    body: 'Offer pickup points, add-ons, or variants per service — pick-one or pick-many.',
  },
  {
    icon: CalendarDays,
    title: 'Add to calendar',
    body: 'Guests save their booking to Google Calendar or download an .ics in a single tap.',
  },
  {
    icon: ShieldCheck,
    title: 'Easy cancellations',
    body: 'Guests manage bookings from a secure link. Seats are released the moment they cancel.',
  },
]

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Everything you need to run group bookings
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">
          Purpose-built for small-group classes, workshops, and sessions.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="flex flex-col gap-3 rounded-xl border p-6">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <f.icon className="size-5" />
            </span>
            <h3 className="font-medium">{f.title}</h3>
            <p className="text-sm text-muted-foreground text-pretty">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
