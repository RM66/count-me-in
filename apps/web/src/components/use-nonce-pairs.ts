'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { newNoncePair, type NoncePair } from './telegram-oidc'

// Bounds the map against a click loop; a real user never holds this
// many popups.
const MAX_PENDING_PAIRS = 8

/**
 * Pending nonce→verifier storage for the OIDC click flow.
 *
 * Every pair handed to Telegram lives in `Map<nonce, verifier>`; a
 * result is paired by the nonce inside its token (never click order)
 * and consumed once. One pair is minted ahead of the click —
 * `window.open` must stay synchronous in the click handler — and each
 * hand-off starts minting the next.
 *
 * The map clears on unmount/disable: a result arriving afterwards must
 * not act on stale state (e.g. VerifyStep hidden on slot.occupancy,
 * ADR-025).
 */
export function useNoncePairs(enabled: boolean) {
  const pairsRef = useRef<Map<string, string>>(new Map())
  const nextPairRef = useRef<NoncePair | null>(null)
  const disposedRef = useRef(false)
  const [pairReady, setPairReady] = useState(false)

  useEffect(() => {
    if (!enabled) return
    disposedRef.current = false
    const pairs = pairsRef.current
    void newNoncePair().then((pair) => {
      if (disposedRef.current) return
      nextPairRef.current = pair
      setPairReady(true)
    })
    return () => {
      disposedRef.current = true
      pairs.clear()
    }
  }, [enabled])

  /**
   * Hand the precomputed pair to the click — synchronously, no await in
   * the click handler. Registers it as pending and starts the mint of
   * the following pair. Returns null while nothing is minted yet.
   */
  const takePair = useCallback((): NoncePair | null => {
    const pair = nextPairRef.current
    if (!pair) return null
    const pairs = pairsRef.current
    // Evict only for a *new* nonce: a fast second click before the mint
    // lands reuses `pair` — evicting an owed verifier for a re-set
    // would drop a result we still expect.
    if (!pairs.has(pair.nonce) && pairs.size >= MAX_PENDING_PAIRS) {
      const oldest = pairs.keys().next().value
      if (oldest !== undefined) pairs.delete(oldest)
    }
    pairs.set(pair.nonce, pair.verifier)
    // A tap before this lands reuses the current pair — harmless: the
    // server's single-use claim rejects a second token with a clean 400.
    void newNoncePair().then((p) => {
      if (!disposedRef.current) nextPairRef.current = p
    })
    return pair
  }, [])

  /** Consume the verifier paired with `nonce` — undefined when unknown. */
  const consumeVerifier = useCallback((nonce: string): string | undefined => {
    const verifier = pairsRef.current.get(nonce)
    if (verifier !== undefined) pairsRef.current.delete(nonce)
    return verifier
  }, [])

  /** Drop a pending pair that can no longer produce a result. */
  const dropPair = useCallback((nonce: string) => {
    pairsRef.current.delete(nonce)
  }, [])

  return { pairReady, takePair, consumeVerifier, dropPair }
}
