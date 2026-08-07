import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ContactLink } from './contact-link'

describe('ContactLink', () => {
  describe('phone contacts', () => {
    it('renders a tel: link for a phone number', () => {
      render(<ContactLink contact="+381 60 123 4567" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'tel:+381601234567')
      expect(link).toHaveTextContent('+381 60 123 4567')
    })

    it('does not add target/rel for phone links', () => {
      render(<ContactLink contact="+1 555 0100" />)
      const link = screen.getByRole('link')
      expect(link).not.toHaveAttribute('target')
      expect(link).not.toHaveAttribute('rel')
    })
  })

  describe('email contacts', () => {
    it('renders a mailto: link for an email address', () => {
      render(<ContactLink contact="hello@example.com" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'mailto:hello@example.com')
      expect(link).toHaveTextContent('hello@example.com')
    })

    it('does not add target/rel for email links', () => {
      render(<ContactLink contact="info@countmein.group" />)
      const link = screen.getByRole('link')
      expect(link).not.toHaveAttribute('target')
      expect(link).not.toHaveAttribute('rel')
    })
  })

  describe('url contacts', () => {
    it('renders an external link for an https URL', () => {
      render(<ContactLink contact="https://countmein.group" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://countmein.group')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders an external link for a bare domain', () => {
      render(<ContactLink contact="countmein.group" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://countmein.group')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders an external link for a t.me link', () => {
      render(<ContactLink contact="t.me/countmein" />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://t.me/countmein')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('text contacts', () => {
    it('renders a span (no link) for plain text', () => {
      render(<ContactLink contact="Call after 6pm" />)
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.getByText('Call after 6pm')).toBeInTheDocument()
    })

    it('renders a span for an empty string', () => {
      const { container } = render(<ContactLink contact="" />)
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('span')).not.toBeNull()
    })
  })

  describe('className', () => {
    it('applies className to the link element', () => {
      render(<ContactLink contact="hello@example.com" className="text-blue-500" />)
      const link = screen.getByRole('link')
      expect(link).toHaveClass('text-blue-500')
    })

    it('applies className to the span for text contacts', () => {
      const { container } = render(<ContactLink contact="Just text" className="font-bold" />)
      const span = container.querySelector('span')
      expect(span).toHaveClass('font-bold')
    })
  })
})
