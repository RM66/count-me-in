import { CalendarPlus, PhoneCall, Share2, UserPlus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const ICONS = [UserPlus, CalendarPlus, Share2, PhoneCall] as const

export async function HowItWorks() {
  const t = await getTranslations('Marketing.howItWorks')

  const steps = (t.raw('items') as Array<{ title: string; body: string }>).map((item, index) => ({
    ...item,
    icon: ICONS[index % ICONS.length],
  }))

  return (
    <section id="how-it-works" className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-4 text-muted-foreground text-pretty">{t('subtitle')}</p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => {
            const Icon = step.icon ?? UserPlus
            return (
              <li
                key={step.title}
                className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('step', { n: i + 1 })}
                  </span>
                </div>
                <h3 className="font-medium">{step.title}</h3>
                <p className="text-sm text-muted-foreground text-pretty">{step.body}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
