import { z } from 'zod'
import { optionsSelectModeEnum } from './enums.js'
import { optionsList } from './options.js'
import {
  capacity,
  displayName,
  durationMinutes,
  priceText,
  serviceDescription,
} from './primitives.js'

const serviceFields = {
  title: displayName,
  description: serviceDescription.optional(),
  defaultPrice: priceText,
  defaultCapacity: capacity,
  defaultDurationMinutes: durationMinutes,
  options: optionsList.optional(),
  optionsSelectMode: optionsSelectModeEnum.optional(),
}

/** `optionsSelectMode` is required iff the service defines options. */
function refineOptionsConsistency<T extends z.ZodType>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const { options, optionsSelectMode } = value as {
      options?: string[]
      optionsSelectMode?: string
    }
    const hasOptions = Array.isArray(options) && options.length > 0
    if (hasOptions && !optionsSelectMode) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSelectMode'],
        message: 'optionsSelectMode is required when options are set',
      })
    }
    if (!hasOptions && optionsSelectMode) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSelectMode'],
        message: 'optionsSelectMode must be omitted when there are no options',
      })
    }
  })
}

export const createServiceInput = refineOptionsConsistency(z.object(serviceFields))
export type CreateServiceInput = z.infer<typeof createServiceInput>

export const updateServiceInput = refineOptionsConsistency(z.object(serviceFields).partial())
export type UpdateServiceInput = z.infer<typeof updateServiceInput>
