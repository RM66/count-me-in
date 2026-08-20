import { Dumbbell, Flower2, GraduationCap, PawPrint, Sparkles, Tent, Users2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const ICONS = [Dumbbell, Flower2, GraduationCap, Users2, Tent, PawPrint, Sparkles] as const

export async function Audiences() {
  const t = await getTranslations('Marketing.audiences')

  // Audience categories mirror the "Target audience" list in README.md.
  // Kept broad on purpose: the product spans many niches, and a visitor should
  // recognize their own use case here rather than infer it from a single hero
  // image. The copy itself lives in the dictionaries.
  const audiences = (t.raw('items') as Array<{ title: string; examples: string }>).map(
    (item, index) => ({ ...item, icon: ICONS[index] }),
  )

  return (
    <section id="who-its-for" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t('title')}
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">{t('subtitle')}</p>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {audiences.map((a) => {
          const Icon = a.icon ?? Dumbbell
          return (
            <li key={a.title} className="flex gap-4 rounded-xl border p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-medium">{a.title}</h3>
                <p className="text-sm text-muted-foreground text-pretty">{a.examples}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
