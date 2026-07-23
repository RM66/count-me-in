import { UserPlus, CalendarPlus, Share2, PhoneCall } from 'lucide-react'

const steps = [
  {
    icon: UserPlus,
    title: 'Create your account',
    body: 'Sign up with your phone and messenger. Set your public handle, name, and timezone.',
  },
  {
    icon: CalendarPlus,
    title: 'Add services & slots',
    body: 'Describe each service, set capacity and duration, then open the time slots you offer.',
  },
  {
    icon: Share2,
    title: 'Share your link',
    body: 'Send guests your countmein.group/you page. They pick a slot and book in seconds.',
  },
  {
    icon: PhoneCall,
    title: 'Get notified',
    body: 'Every booking pings you in your messenger with a deep link straight to your cabinet.',
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            From setup to first booking in minutes
          </h2>
          <p className="mt-4 text-muted-foreground text-pretty">
            CountMeIn handles capacity, confirmations, and reminders so you can focus on running
            your events.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="size-5" />
                </span>
                <span className="text-sm font-medium text-muted-foreground">Step {i + 1}</span>
              </div>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm text-muted-foreground text-pretty">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
