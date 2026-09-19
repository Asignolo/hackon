import { z } from 'zod'
import { traceFinderSnapshotContextSchema } from './trace-finder-validators'

const publicUrl = z.string().min(1).max(2048).url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, '[internal] O1 source must be an HTTP(S) URL without credentials')
const confidence = z.enum(['confirmed', 'probable', 'unconfirmed', 'conflict'])
const sources = z.array(z.object({
  url: publicUrl,
  method: z.enum(['page_read', 'page_link', 'search_result', 'redirect']),
  evidence: z.string().min(1).max(2048),
}).strict()).min(1).max(20)
const attributed = { confidence, approvalRequired: z.boolean(), sources }
const coverage = z.enum(['found', 'not_found', 'blocked', 'error', 'not_checked'])

export const portfolioDiscoveryInputSchema = z.object({
  originalPortfolio: z.string(), registrationEmail: z.string(), firstName: z.string(), lastName: z.string(),
}).strict()

export const portfolioDiscoveryResultSchema = z.object({
  kind: z.literal('research'),
  data: z.object({
    schemaVersion: z.literal(1),
    status: z.enum(['complete', 'partial', 'no_results', 'no_portfolio', 'invalid_input']),
    stopReason: z.enum(['search_exhausted', 'budget_exhausted', 'no_portfolio', 'invalid_input', 'tools_unavailable']),
    portfolio: z.object({
      kind: z.enum(['website_url', 'social_profile_url', 'google_maps_url', 'gallery_url', 'domain', 'account_name', 'missing', 'invalid']),
      originalValue: z.string().nullable(), normalizedValue: z.string().min(1).nullable(),
      resolvedUrl: publicUrl.nullable(), status: z.enum(['resolved', 'partial', 'unresolved']),
    }).strict(),
    links: z.array(z.object({ ...attributed,
      type: z.enum(['website', 'contact', 'instagram', 'facebook', 'google_maps']),
      originalUrl: publicUrl, url: publicUrl,
    }).strict()).max(5),
    nip: z.array(z.object({ ...attributed, originalValue: z.string().min(1), value: z.string().min(1).max(2048), checksumValid: z.boolean() }).strict()).max(50),
    city: z.array(z.object({ ...attributed, value: z.string().min(1).max(2048) }).strict()).max(50),
    coverage: z.object({ website: coverage, contact: coverage, instagram: coverage, facebook: coverage, google_maps: coverage, nip: coverage }).strict(),
    approvalRequired: z.boolean(),
    attempts: z.array(z.object({
      tool: z.enum(['web_search', 'web_fetch', 'run_skill_script']), target: z.string().min(1),
      outcome: z.enum(['opened', 'found', 'not_found', 'dead', 'empty', 'blocked', 'unavailable', 'timeout', 'error']), detail: z.string().min(1),
    }).strict()),
    summary: z.string().min(1),
  }).strict(),
}).strict()

export const portfolioDiscoverySnapshotContextSchema = traceFinderSnapshotContextSchema
