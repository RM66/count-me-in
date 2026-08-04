import { detectContactKind } from '@/lib/helpers/contact'

interface ContactLinkProps {
  contact: string
  className?: string
}

/**
 * Renders a contact string as the appropriate link type or plain text.
 * Uses `detectContactKind` to classify the string at render time (ADR-008):
 * - phone  → `<a href="tel:…">`
 * - email  → `<a href="mailto:…">`
 * - url    → `<a href="https://…" target="_blank" rel="noopener noreferrer">`
 * - text   → `<span>` (no link)
 */
export function ContactLink({ contact, className }: ContactLinkProps) {
  const { kind, href } = detectContactKind(contact)

  if (kind === 'text' || !href) {
    return <span className={className}>{contact}</span>
  }

  return (
    <a
      href={href}
      className={className}
      {...(kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {contact}
    </a>
  )
}
