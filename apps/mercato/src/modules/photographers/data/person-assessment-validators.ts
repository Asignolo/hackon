import { z } from 'zod'

export const personAssessmentPathSchema = z.object({ personId: z.string().uuid() })
export const personAssessmentBindingSchema = z.object({ evaluationId: z.string().uuid(), registrationId: z.string().uuid() })
export const personAssessmentResponseSchema = z.object({ assessment: personAssessmentBindingSchema.nullable() })
export type PersonAssessmentResponse = z.infer<typeof personAssessmentResponseSchema>
