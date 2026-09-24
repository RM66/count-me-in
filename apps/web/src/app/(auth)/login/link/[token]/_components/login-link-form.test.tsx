import { DEFAULT_LOCALE } from '@repo/contracts'
import { WEB_MESSAGES } from '@repo/translations'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { LoginLinkForm } from './login-link-form'

// the one-time login link must be spent by a POST, never a GET —
// link previewers fetch URLs before any human clicks, so a token spent
// on render would be burned by a robot. This form is that POST: it
// auto-submits the server action on mount, with a no-JS fallback button.

describe('LoginLinkForm', () => {
  it('auto-submits the consume action on mount (the token-spending POST)', async () => {
    const action = vi.fn(async () => {})

    render(
      <IntlTestProvider>
        <LoginLinkForm action={action} />
      </IntlTestProvider>,
    )

    // The mount effect calls form.requestSubmit(); React runs the form's
    // action — this invocation is the POST that spends the token.
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })

  it('renders the opening copy while the POST is in flight', () => {
    render(
      <IntlTestProvider>
        <LoginLinkForm action={vi.fn()} />
      </IntlTestProvider>,
    )

    expect(screen.getByText('One moment while we open your cabinet.')).toBeInTheDocument()
  })

  it('keeps a no-JS fallback submit button (noscript)', async () => {
    // jsdom drops <noscript> content with scripting enabled, so assert
    // on the server HTML instead — that is exactly what a no-JS browser
    // receives: a working submit carrying the same copy.
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { NextIntlClientProvider } = await import('next-intl')

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={WEB_MESSAGES[DEFAULT_LOCALE]}>
        <LoginLinkForm action={async () => {}} />
      </NextIntlClientProvider>,
    )
    expect(html).toContain('<noscript>')
    expect(html).toContain('type="submit"')
    expect(html).toContain('Continue to your cabinet')
  })
})
