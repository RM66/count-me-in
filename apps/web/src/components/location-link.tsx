import { MapPin } from 'lucide-react'

import { mapSearchUrl } from '@/helpers/location'

interface LocationLinkProps {
  location: string
  className?: string
  iconClassName?: string
}

/**
 * Renders a location string as a link to a maps search for that text, or as
 * the organizer's own link when the string already is one (`mapSearchUrl`
 * decides; `detectContactKind` classifies). The column is one free-text
 * string and the URL is built at render time, the same way `ContactLink`
 * classifies contacts.
 */
export function LocationLink({ location, className, iconClassName }: LocationLinkProps) {
  return (
    <a
      href={mapSearchUrl(location)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <MapPin className={iconClassName} />
      {location}
    </a>
  )
}
