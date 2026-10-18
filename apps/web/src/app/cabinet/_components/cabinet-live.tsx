'use client'

import { realtimeChannels } from '@repo/contracts'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import { useCurrentOrganizer, useRealtimeConfigured, useSlotOccupancyChannel } from '@/api-client'

/**
 * Quiet window after an occupancy event before the RSC refresh fires —
 * a burst of bookings (or a replayed history on reconnect) collapses into
 * one server render instead of one render per event.
 */
const REFRESH_DEBOUNCE_MS = 400

/**
 * The missed-emit fallback while the tab is visible: a full server refresh
 * even when no event arrived (dropped publish, trimmed history).
 */
const PERIODIC_REFRESH_MS = 120_000

/**
 * Live occupancy for the cabinet (ADR-025) — a renderless subscriber.
 *
 * Cabinet pages are server components with no client slot cache to
 * patch: an event schedules a debounced `router.refresh()` and the RSC
 * payload is the source of truth. `connected` refreshes on the first
 * connect too — the SDK replays only from connect time, so events
 * emitted between the SSR read and the handshake are never delivered
 * (later connects cover an unbounded offline gap). Hidden-tab refreshes
 * defer to a pending flag flushed on `visible`.
 *
 * The demo organizer never subscribes — the route refuses it anyway,
 * this spares the request. The periodic + visibility fallback runs in
 * polling-fresh mode too (off/demo): a deliberate two-minute floor.
 */
export function CabinetLive() {
  const router = useRouter()
  const configured = useRealtimeConfigured()
  const { data: organizer } = useCurrentOrganizer()
  const enabled = configured && !!organizer && !organizer.isDemo

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set when an event arrives while hidden — flushed on `visible`. */
  const pendingRef = useRef(false)

  const scheduleRefresh = useCallback(() => {
    if (document.visibilityState !== 'visible') {
      pendingRef.current = true
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      router.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [router])

  useSlotOccupancyChannel({
    channel: organizer ? realtimeChannels.organizer(organizer.id) : undefined,
    enabled,
    onEvent: scheduleRefresh,
    onConnected: scheduleRefresh,
  })

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (pendingRef.current) {
          pendingRef.current = false
          scheduleRefresh()
        }
      } else if (timerRef.current) {
        // An armed debounce must not fire hidden — fold into pending.
        clearTimeout(timerRef.current)
        timerRef.current = null
        pendingRef.current = true
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', scheduleRefresh)
    // Periodic reconcile; scheduleRefresh folds hidden fires into pending.
    const interval = setInterval(scheduleRefresh, PERIODIC_REFRESH_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', scheduleRefresh)
      clearInterval(interval)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [scheduleRefresh])

  return null
}
