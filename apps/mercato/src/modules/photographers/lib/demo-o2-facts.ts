import { z } from 'zod'
import { researchFactSchema, tracesSnapshotSchema, type ResearchFact, type PhotographerCategory, type TraceEvidence } from '../data/evaluation-validators'
import { materialOperationId } from './material-codec'

export const DEMO_O1_SOURCE_ASSUMPTION = 'demo-o1-sources-belong-to-photographer-v1'
const timestamp = z.string().datetime({ offset: true })
const toolSchema = z.enum(['integration_apify.scrape_instagram_profile', 'integration_apify.scrape_facebook_page', 'integration_apify.scrape_google_maps_place', 'integration_apify.scrape_google_maps_reviews'])
const resultSchema = z.object({
  tool: toolSchema, url: z.string().min(1).max(2048),
  confidence: z.enum(['confirmed', 'probable', 'unconfirmed']), approvalRequired: z.boolean(),
  status: z.enum(['complete', 'partial', 'no_data', 'error']),
  actorRunId: z.string().nullable(), observedAt: z.string().nullable(),
  resultJson: z.string().max(128 * 1024).nullable(), error: z.string().nullable(),
}).strict()
export const demoO2OutcomeSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['complete', 'partial', 'no_data', 'no_targets', 'invalid_input', 'error']),
  results: z.array(resultSchema).max(4),
  skipped: z.array(z.object({ url: z.string().nullable(), reason: z.string().min(1) }).strict()),
  summary: z.string().min(1),
}).strict()
const providerSchema = z.object({
  ok: z.boolean(), status: z.enum(['complete', 'partial', 'no_data', 'error']),
  platform: z.enum(['instagram', 'facebook', 'google_maps']),
  canonicalUrl: z.string().max(2048).nullable(), sourceUrl: z.string().max(2048).nullable(),
  observedAt: timestamp, actorRunId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  unavailableFields: z.array(z.object({ field: z.string(), reason: z.string() })),
  diagnostics: z.array(z.unknown()),
})
const categoryPatterns: Array<[PhotographerCategory, RegExp]> = [
  ['wedding', /\b(?:wedding photograph(?:er|y)|fotograf(?:ia)? slubn\w*)\b/],
  ['family_newborn', /\b(?:(?:family|newborn|maternity) photograph(?:er|y)|fotograf(?:ia)? (?:rodzinn|noworodkow|ciazow)\w*|sesje (?:rodzinne|noworodkowe|ciazowe))\b/],
  ['school_preschool', /\b(?:(?:school|preschool) photograph(?:er|y)|fotograf(?:ia)? (?:szkoln|przedszkoln)\w*)\b/],
  ['reportage_events', /\b(?:event photograph(?:er|y)|fotograf(?:ia)? (?:reportazow|eventow)\w*)\b/],
  ['product_commercial', /\b(?:(?:product|commercial) photograph(?:er|y)|fotograf(?:ia)? (?:produktow|reklamow|komercyjn)\w*)\b/],
  ['other', /\b(?:(?:landscape|wildlife|architecture) photograph(?:er|y)|fotograf(?:ia)? (?:krajobrazow|przyrodnicz|architektur)\w*)\b/],
]

export function classifyDemoPhotographer(text: string): PhotographerCategory {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase()
  if (/\b(?:nie|not|no|never|without|formerly|dawniej)\b/.test(normalized)) return 'unknown'
  const matches = categoryPatterns.filter(([, pattern]) => pattern.test(normalized))
  return matches.length === 1 ? matches[0][0] : 'unknown'
}

export function normalizeDemoO2Facts(raw: unknown, evaluation: { evaluationId: string; evaluatedAt: string }) {
  const envelope = z.object({ kind: z.literal('research'), data: demoO2OutcomeSchema }).strict().safeParse(raw)
  const outcome = envelope.success ? envelope.data.data : demoO2OutcomeSchema.parse(raw)
  const traces: TraceEvidence[] = []
  const facts = new Map<ResearchFact['key'], ResearchFact>()
  const classificationEvidence: Array<{ traceId: string; sourceRef: string; observedAt: string; field: string; text: string }> = []
  const seenTools = new Set<string>()
  for (const entry of [...outcome.results].sort((left, right) => toolSchema.options.indexOf(left.tool) - toolSchema.options.indexOf(right.tool))) {
    if (seenTools.has(entry.tool)) throw new Error('[internal] Duplicate O2 tool result')
    seenTools.add(entry.tool)
    if (!entry.resultJson) continue
    let parsed: unknown
    try { parsed = JSON.parse(entry.resultJson) } catch { continue }
    const checked = providerSchema.safeParse(parsed)
    if (!checked.success) continue
    const provider = checked.data
    const kind = entry.tool.includes('instagram') ? 'instagram' : entry.tool.includes('facebook') ? 'facebook' : 'google_maps'
    if (provider.platform !== kind || provider.status !== entry.status || provider.observedAt !== entry.observedAt || provider.actorRunId !== entry.actorRunId) continue
    if (!provider.ok || !['complete', 'partial'].includes(provider.status) || !provider.data) continue
    const sourceRef = provider.sourceUrl || provider.canonicalUrl
    if (!sourceRef) continue
    const traceId = materialOperationId(evaluation.evaluationId, `demo-o2:${entry.tool}:${entry.url}`)
    const trace: TraceEvidence = {
      schemaVersion: 1, id: traceId, kind, value: entry.url, status: 'confirmed',
      observedAt: provider.observedAt, ruleId: DEMO_O1_SOURCE_ASSUMPTION, candidateIds: [],
      provenance: [{ value: DEMO_O1_SOURCE_ASSUMPTION, sourceRef, observedAt: provider.observedAt }],
    }
    traces.push(trace)
    const unavailable = new Set(provider.unavailableFields.map((field) => field.field))
    const addNumber = (field: string, key: ResearchFact['key'], owner: 'social' | 'portfolio') => {
      if (facts.has(key) || unavailable.has(field)) return
      const value = provider.data?.[field]
      if (typeof value !== 'number') return
      const fact = researchFactSchema.safeParse({ schemaVersion: 1, key, owner, value, state: 'known', traceId, sourceRef, observedAt: provider.observedAt, readStatus: provider.status === 'partial' ? 'partial' : 'ok' })
      if (fact.success) {
        facts.set(key, fact.data)
        trace.provenance.push({ value: JSON.stringify({ field, value }), sourceRef, observedAt: provider.observedAt })
      }
    }
    if (kind === 'instagram') addNumber('followersCount', 'instagramFollowers', 'social')
    if (kind === 'google_maps') {
      addNumber('reviewsCount', 'googleMapsReviews', 'portfolio')
      addNumber('rating', 'googleMapsRating', 'portfolio')
    }
    const fields = kind === 'instagram' ? ['biography', 'businessCategory'] : kind === 'facebook' ? ['description', 'category'] : ['primaryCategory', 'categories']
    for (const field of fields) {
      if (unavailable.has(field)) continue
      const value = provider.data[field]
      const content = typeof value === 'string' ? value : Array.isArray(value) && value.every((item) => typeof item === 'string') ? value.join('; ') : ''
      if (!content.trim() || content.length > 2000) continue
      classificationEvidence.push({ traceId, sourceRef, observedAt: provider.observedAt, field, text: content })
      trace.provenance.push({ value: JSON.stringify({ field, text: content }), sourceRef, observedAt: provider.observedAt })
    }
  }
  const category = classifyDemoPhotographer(classificationEvidence.map((evidence) => evidence.text).join('\n'))
  const evidence = classificationEvidence.find((item) => classifyDemoPhotographer(item.text) === category)
  if (category !== 'unknown' && evidence) {
    facts.set('category', researchFactSchema.parse({
      schemaVersion: 1, key: 'category', owner: 'portfolio', state: 'known', value: category,
      traceId: evidence.traceId, sourceRef: evidence.sourceRef, observedAt: evidence.observedAt,
      readStatus: 'partial', reason: 'demo-explicit-specialty-v1; evidence retained in trace provenance',
    }))
  }
  return {
    traces: tracesSnapshotSchema.parse({ schemaVersion: 1, evaluationId: evaluation.evaluationId, evaluatedAt: evaluation.evaluatedAt, traces, discoveryStatus: traces.length === 0 ? 'unavailable' : outcome.status === 'complete' && traces.length === outcome.results.length && outcome.skipped.length === 0 ? 'complete' : 'partial' }),
    facts: [...facts.values()], category,
  }
}
