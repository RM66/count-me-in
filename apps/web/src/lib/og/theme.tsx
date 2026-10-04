/**
 * The shared look of the generated OG cards (Satori — no CSS variables, so
 * raw hexes are deliberate and live only here).
 */

/** Brand gradient lifted from logo.svg (#2726CF → #6F23F7). */
export const OG_GRADIENT = 'linear-gradient(135deg, #2726CF 0%, #6F23F7 100%)'

/**
 * The brand card an OG route renders when its entity cannot be resolved —
 * a shared link still deserves the mark, just without specifics.
 */
export function OgFallbackCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: OG_GRADIENT,
        color: 'white',
        fontSize: 64,
        fontWeight: 700,
        fontFamily: 'Figtree',
      }}
    >
      CountMeIn
    </div>
  )
}
