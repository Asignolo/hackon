import { z } from 'zod'

const nameSchema = z.string().min(1).max(200).refine((value) => value.trim().length > 0)
const portfolioRawSchema = z.string().max(2048)

export const rawDataCreateSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: z.string().email().max(320),
  portfolioRaw: portfolioRawSchema,
  submittedAt: z.string().datetime({ offset: true }).optional(),
  customerEntityId: z.string().uuid().nullable().optional(),
}).strict()

export const rawDataListSchema = z.object({
  id: z.string().uuid().optional(),
  customerEntityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

export type RawDataCreateInput = z.infer<typeof rawDataCreateSchema>
export type RawDataListInput = z.infer<typeof rawDataListSchema>
