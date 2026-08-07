/** Extract initials (up to 2 characters) from a display name for avatar fallbacks. */
export function initials(name: string): string {
  return name
    .split(/\s+/, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
}
