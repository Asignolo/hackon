import { z } from 'zod'
import { evaluationMaterialSchema, MAX_SNAPSHOT_BYTES } from './evaluation-validators'

const uuid = z.string().uuid()
export const materialOwnersSchema = z.object({ photographerId: uuid, personId: uuid, registrationId: uuid.optional(), dealId: uuid.optional() }).strict()
export const storedMaterialSchema = materialOwnersSchema.extend({ material: evaluationMaterialSchema }).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SNAPSHOT_BYTES) {
    context.addIssue({ code: 'custom', message: '[internal] Material exceeds byte limit' })
  }
  if (value.material.kind !== 'eligibility' && !value.dealId) {
    context.addIssue({ code: 'custom', path: ['dealId'], message: '[internal] Evaluation material requires a deal' })
  }
  if (value.material.kind === 'eligibility' && value.material.data.photographerId !== value.photographerId) {
    context.addIssue({ code: 'custom', path: ['photographerId'], message: '[internal] Eligibility photographer mismatch' })
  }
  if (value.material.kind === 'summary' && (value.material.data.photographerId !== value.photographerId || value.material.data.personId !== value.personId || value.material.data.dealId !== value.dealId)) {
    context.addIssue({ code: 'custom', message: '[internal] Summary owner mismatch' })
  }
})
export const storeMaterialSchema = z.object({ operationId: uuid, snapshot: storedMaterialSchema }).strict()
export type MaterialOwners = z.infer<typeof materialOwnersSchema>

const responseFields = {
  id: uuid, evaluationId: uuid, schemaVersion: z.literal(1), updatedAt: z.string().datetime(),
  photographerId: uuid, personId: uuid, registrationId: uuid.optional(), dealId: uuid.optional(),
}
export const materialResponseSchema = z.discriminatedUnion('kind', [
  evaluationMaterialSchema.options[0].extend(responseFields),
  evaluationMaterialSchema.options[1].extend(responseFields),
  evaluationMaterialSchema.options[2].extend(responseFields),
  evaluationMaterialSchema.options[3].extend(responseFields),
  evaluationMaterialSchema.options[4].extend(responseFields),
  evaluationMaterialSchema.options[5].extend(responseFields),
  evaluationMaterialSchema.options[6].extend(responseFields),
])
