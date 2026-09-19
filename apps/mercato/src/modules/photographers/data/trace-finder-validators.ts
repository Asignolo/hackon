import { z } from 'zod'
import { rawDataCreateSchema } from './validators'

const publicSourceSchema = z.string().min(1).max(2048).url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, '[internal] O2 source must be an HTTP(S) URL without credentials')

export const traceFinderInputSchema = rawDataCreateSchema.pick({
  firstName: true, lastName: true, email: true, portfolioRaw: true,
}).extend({ registrationId: z.string().uuid(), portfolioRaw: z.string().max(2048).optional() }).strict()

export const traceFinderResearchSchema = z.object({
  status: z.enum(['complete', 'partial', 'no_results', 'unavailable']),
  candidates: z.array(z.object({
    url: publicSourceSchema,
    kind: z.enum(['website', 'instagram', 'facebook', 'google_maps', 'other']),
    name: z.string().min(1).max(200),
    evidence: z.string().min(1).max(1000),
    sourceUrl: publicSourceSchema,
  }).strict()).max(5),
  summary: z.string().min(1).max(2000),
  issues: z.array(z.string().min(1).max(500)).max(10),
}).strict().superRefine((result, context) => {
  if (result.status === 'complete' && result.candidates.length === 0) {
    context.addIssue({ code: 'custom', path: ['candidates'], message: '[internal] Complete O2 research requires candidates' })
  }
  if (['no_results', 'unavailable'].includes(result.status) && result.candidates.length > 0) {
    context.addIssue({ code: 'custom', path: ['candidates'], message: '[internal] Empty O2 outcomes cannot contain candidates' })
  }
  if (['partial', 'unavailable'].includes(result.status) && result.issues.length === 0) {
    context.addIssue({ code: 'custom', path: ['issues'], message: '[internal] Incomplete O2 research requires an explanation' })
  }
})

export const traceFinderResultSchema = z.object({ kind: z.literal('research'), data: traceFinderResearchSchema }).strict()

export const traceFinderSnapshotContextSchema = z.object({
  evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
}).strict()
