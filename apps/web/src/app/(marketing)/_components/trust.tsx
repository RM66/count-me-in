import { CalendarX2, MessagesSquare, TableProperties } from 'lucide-react'

// Honest positioning band (no invented metrics or testimonials — the product
// is pre-launch). Each pillar restates a real pain from README's audience
// intro: organizers managing schedule and capacity "without endless chats and
// spreadsheets".
const pillars = [
  {
    icon: MessagesSquare,
    title: 'No more DM back-and-forth',
    body: 'Stop chasing “is there a spot?” messages. Your link shows what’s open, in real time.',
  },
  {
    icon: TableProperties,
    title: 'No more spreadsheet juggling',
    body: 'Capacity, seats, and cancellations stay in sync automatically — nothing to update by hand.',
  },
  {
    icon: CalendarX2,
    title: 'No more accidental overbooking',
    body: 'Seats are claimed atomically, so a full class can never take one booking too many.',
  },
]

export function Trust() {
  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Trade the chaos for one link
          </h2>
          <p className="mt-4 text-muted-foreground text-pretty">
            CountMeIn replaces the tools organizers usually cobble together to fill a group.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {pillars.map((p) => (
            <div key={p.title} className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <p.icon className="size-6" />
              </span>
              <h3 className="font-medium">{p.title}</h3>
              <p className="max-w-xs text-sm text-muted-foreground text-pretty">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
