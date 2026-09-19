import { z } from 'zod'

export const registrationCrmInputSchema = z.object({ registrationId: z.string().uuid() }).strict()
export const registrationCrmResponseSchema = z.object({
  registrationId: z.string().uuid(),
  status: z.enum(['pending', 'ready', 'eligibility_required']),
  photographerId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  links: z.object({ person: z.string(), deal: z.string() }).strict().optional(),
}).strict()
export type RegistrationCrmResult = z.infer<typeof registrationCrmResponseSchema>
