import { z } from 'zod'

export const optionsSelectModeEnum = z.enum(['single', 'multi'])
export type OptionsSelectMode = z.infer<typeof optionsSelectModeEnum>

export const bookingStatusEnum = z.enum(['confirmed', 'cancelled'])
export type BookingStatus = z.infer<typeof bookingStatusEnum>

/** MVP ships Telegram first; more messengers become additional variants later. */
export const messengerEnum = z.enum(['telegram'])
export type Messenger = z.infer<typeof messengerEnum>
