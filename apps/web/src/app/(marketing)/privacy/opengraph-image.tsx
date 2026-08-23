/**
 * Site-default social card for the privacy page. A page-level `openGraph` (set
 * via `pageMetadata`) drops inherited og:image — Next merges file-convention
 * images per segment — so the card re-exports beside the page.
 */
export {
  alt,
  contentType,
  default,
  size,
} from '@/app/opengraph-image'
