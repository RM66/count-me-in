'use client'

import { useLocale } from 'next-intl'

import { localeWeekStartsOn, type WeekStartsOn } from '@/helpers/week-starts-on'

/**
 * The app's first day of the week, derived from the *app* locale (ADR-011) —
 * deterministic between server and client, so a Monday-start page does not
 * flip to Sunday-start after hydration. Every cabinet calendar shares it so
 * the mini pickers and the week grid always start the week on the same day.
 */
export function useWeekStartsOn(): WeekStartsOn {
  return localeWeekStartsOn(useLocale())
}
