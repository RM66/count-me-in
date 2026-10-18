'use client'

import {
  type PublicServiceViewEnvelope,
  publicServiceViewEnvelope,
  REALTIME_EVENT_SLOT_OCCUPANCY,
  realtimeChannels,
  type SlotOccupancyEvent,
  slotOccupancyEvent,
} from '@repo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createRealtime } from '@upstash/realtime/client'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

import { get } from './client'
import { queryKeys } from './keys'

/**
 * Whether the deployment can serve realtime at all (ADR-025) — env
 * *presence* only, the credentials never reach the browser. `false`
 * keeps every subscription off; pages rely on their periodic reconcile
 * ("polling-fresh" mode).
 */
const RealtimeConfiguredContext = createContext(false)

export const RealtimeConfiguredProvider = RealtimeConfiguredContext.Provider

export function useRealtimeConfigured(): boolean {
  return useContext(RealtimeConfiguredContext)
}

// The event schema map mirrored to `server/realtime.ts` — nested so the
// wire path reads `slot.occupancy` on both sides.
type OccupancySchema = { slot: { occupancy: typeof slotOccupancyEvent } }

// `./shared` types are not re-exported through `./client` — spelling
// them out avoids referencing unreachable internals (TS2883).
type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting'
type UseRealtime = (opts: {
  events?: readonly 'slot.occupancy'[]
  onData?: (message: { event: 'slot.occupancy'; data: unknown; channel: string }) => void
  channels?: readonly (string | undefined)[]
  enabled?: boolean
}) => { status: ConnectionStatus }
const useRealtime: UseRealtime = createRealtime<OccupancySchema>().useRealtime

/**
 * Thin typed wrapper over the library's `useRealtime` (ADR-025).
 *
 * `onConnected` derives from the only signal exposed — `status` →
 * `connected` — covering mount and every provider reconnect. A native
 * EventSource retry never flips `status`; `last_ack` replay and the
 * periodic reconcile cover that gap.
 */
export function useSlotOccupancyChannel({
  channel,
  enabled,
  onEvent,
  onConnected,
}: {
  channel: string | undefined
  enabled: boolean
  onEvent: (event: SlotOccupancyEvent) => void
  onConnected?: () => void
}): ConnectionStatus {
  // The library keeps the first `onData` closure for the subscription's
  // life — route through a ref so the *latest* handler runs.
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const { status } = useRealtime({
    channels: channel ? [channel] : [],
    events: [REALTIME_EVENT_SLOT_OCCUPANCY],
    enabled,
    onData: (message) => {
      // The library delivers `data` unvalidated — parse first.
      const parsed = slotOccupancyEvent.safeParse(message.data)
      if (parsed.success) onEventRef.current(parsed.data)
    },
  })

  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected
  useEffect(() => {
    if (enabled && status === 'connected') onConnectedRef.current?.()
  }, [enabled, status])

  return status
}

/**
 * Quiet window after an SSE signal or handshake before the query
 * invalidation fires — collapses the connect handshake + any replayed
 * stream entries (or a burst of bookings) into one HTTP GET.
 */
export const PUBLIC_SERVICE_INVALIDATE_DEBOUNCE_MS = 250

/**
 * Polling-fresh interval when realtime is off — the sole freshness
 * source besides focus/reconnect. `/api/public/services` is behind a
 * 60/min IP rate limit (venue Wi-Fi shares one IP), so this exists
 * only where it is the sole reconcile path.
 */
export const PUBLIC_SERVICE_REFETCH_MS = 60_000

/**
 * The dead-SSE floor when realtime is on: healthy connections reconcile
 * via the ~298 s stream close → reconnect → invalidate cycle, so faster
 * would only spend rate-limit budget. Five minutes keeps a repair path
 * if SSE is entirely blocked.
 */
const LIVE_FLOOR_MS = 300_000

/**
 * The public service view with live occupancy (ADR-025): one hook owns
 * the React Query read AND the `service:{id}` subscription.
 *
 * Both an incoming `slot.occupancy` signal and `connected` schedule a
 * debounced invalidation — HTTP is the single source of truth for slot
 * state, and the debounce coalesces the handshake + stream replay (or a
 * booking burst) into one GET. Hidden-tab signals defer until the tab
 * is visible again. Demo services are read-only (ADR-010) and never
 * subscribe or poll.
 */
export function useLivePublicService(serviceId: string, initialData: PublicServiceViewEnvelope) {
  const queryClient = useQueryClient()
  const realtimeOn = useRealtimeConfigured()
  const isDemo = initialData.organizer?.isDemo === true
  const enabled = realtimeOn && !isDemo
  const key = queryKeys.publicService.detail(serviceId)

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      get(`/api/public/services/${encodeURIComponent(serviceId)}`, publicServiceViewEnvelope),
    initialData,
    staleTime: 0,
    // Demo is static; realtime-on uses the first `connected` below as
    // its mount reconcile; realtime-off uses the mount GET.
    refetchOnMount: !isDemo && !realtimeOn,
    refetchOnWindowFocus: !isDemo,
    refetchOnReconnect: !isDemo,
    refetchInterval: isDemo ? false : realtimeOn ? LIVE_FLOOR_MS : PUBLIC_SERVICE_REFETCH_MS,
    refetchIntervalInBackground: false,
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)

  const scheduleInvalidate = useCallback(() => {
    if (document.visibilityState !== 'visible') {
      pendingRef.current = true
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void queryClient.invalidateQueries({ queryKey: key })
    }, PUBLIC_SERVICE_INVALIDATE_DEBOUNCE_MS)
  }, [queryClient, key])

  useEffect(() => {
    if (isDemo) return
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (pendingRef.current) {
          pendingRef.current = false
          scheduleInvalidate()
        }
      } else if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        pendingRef.current = true
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isDemo, scheduleInvalidate])

  useSlotOccupancyChannel({
    channel: realtimeChannels.service(serviceId),
    enabled,
    onEvent: scheduleInvalidate,
    onConnected: scheduleInvalidate,
  })

  return query
}
