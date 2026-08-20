import { CalendarX2, MessagesSquare, TableProperties } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const ICONS = [MessagesSquare, TableProperties, CalendarX2] as const

// Honest positioning band (no invented metrics or testimonials — the product
// is pre-launch). Each pillar restates a real pain from README's audience
// intro: organizers managing schedule and capacity "without endless chats and
// spreadsheets".
export async function Trust() {
  const t = await getTranslations('Marketing.trust')

  const pillars = (t.raw('pillars') as Array<{ title: string; body: string }>).map(
    (item, index) => ({ ...item, icon: ICONS[index] }),
  )

  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-4 text-muted-foreground text-pretty">{t('subtitle')}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {pillars.map((p) => {
            const Icon = p.icon ?? MessagesSquare
            return (
              <div key={p.title} className="flex flex-col items-center gap-3 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-6" />
                </span>
                <h3 className="font-medium">{p.title}</h3>
                <p className="max-w-xs text-sm text-muted-foreground text-pretty">{p.body}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
