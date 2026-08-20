import { ChevronDown } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

/**
 * Answers reflect the MVP scope in the docs:
 * - price is *display text*, no payments (domain.md: `defaultPrice` "not a payment amount")
 * - guests need no account, just a messenger login (ADR-002, ADR-008)
 * - cancellations via a secure manage link (domain.md Booking / manageToken)
 * Messenger is kept generic on purpose — more messengers are planned beyond the MVP.
 * The copy lives in the dictionaries; `page.tsx` reads the same entries for
 * the FAQPage JSON-LD, so the visible copy and the structured data share one
 * source of truth.
 */
export async function Faq() {
  const t = await getTranslations('Marketing.faq')
  const faqs = t.raw('items') as Array<{ q: string; a: string }>

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t('title')}
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">{t('subtitle')}</p>
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
