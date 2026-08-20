import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

export async function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  const t = await getTranslations('Legal')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('lastUpdated', { date: updated })}</p>
      <div className="mt-8 flex flex-col gap-6 leading-relaxed text-muted-foreground">
        {children}
      </div>
    </main>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-foreground">{heading}</h2>
      {children}
    </section>
  )
}
