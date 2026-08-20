import { CalendarDays, Layers, LinkIcon, MessageCircle, ShieldCheck, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const ICONS = [Users, LinkIcon, MessageCircle, Layers, CalendarDays, ShieldCheck] as const

export async function Features() {
  const t = await getTranslations('Marketing.features')

  const features = (
    t.raw('items') as Array<{ title: string; body: string }>
  ).map((item, index) => ({
    ...item,
    icon: ICONS[index % ICONS.length],
  }))

  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t('title')}
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">{t('subtitle')}</p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon ?? Users
          return (
            <div key={f.title} className="flex flex-col gap-3 rounded-xl border p-6">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <h3 className="font-medium">{f.title}</h3>
              <p className="text-sm text-muted-foreground text-pretty">{f.body}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
