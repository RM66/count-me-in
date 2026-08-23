/**
 * Site-default social card for the marketing pages. A page-level `openGraph`
 * (set via `pageMetadata`) drops the root layout's inherited og:image — Next
 * merges file-convention images per segment — so this segment re-exports the
 * root card instead of losing it.
 */
export {
  alt,
  contentType,
  default,
  size,
} from '@/app/opengraph-image'
