import { z } from 'zod'

export const SNAPSHOT_SCHEMA_VERSION = 1
export const MAX_SNAPSHOT_BYTES = 128 * 1024
export const MAX_MATERIAL_PART_CHARACTERS = 9000
export const MAX_MATERIAL_PARTS = 32

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const sourceRef = z.string().trim().min(1).max(2048)
const version = z.string().min(1).max(100)
const schemaVersion = z.literal(SNAPSHOT_SCHEMA_VERSION)

export const photographerCategorySchema = z.enum([
  'wedding', 'family_newborn', 'school_preschool', 'reportage_events',
  'product_commercial', 'other', 'unknown',
])
export const gallerySystemSchema = z.enum([
  'zalamo', 'mafelo', 'photonesto', 'fotoklaser', 'fotigo', 'pixieset',
  'pic_time', 'nphoto', 'other', 'none', 'unknown',
])
export const readStatusSchema = z.enum(['ok', 'empty', 'unavailable', 'blocked', 'timeout', 'error', 'partial'])
export const evaluationSourceSchema = z.enum(['registration', 'batch', 'demo_fixture'])
export const evaluationActionSchema = z.enum(['observe', 'qualify_contact', 'review', 'close_lost'])
export const businessFlagSchema = z.enum(['business_suspended', 'business_removed', 'non_photographic_pkd'])

export const traceEvidenceSchema = z.object({
  schemaVersion,
  id: uuid,
  kind: z.enum(['portfolio', 'website', 'instagram', 'facebook', 'gallery', 'google_maps', 'registry', 'email']),
  value: z.string().min(1).max(2048),
  status: z.enum(['confirmed', 'unconfirmed']),
  provenance: z.array(z.object({
    value: z.string().min(1).max(2048),
    sourceRef,
    observedAt: timestamp,
  }).strict()).min(1).max(20),
  observedAt: timestamp,
  ruleId: z.string().min(1).max(100).optional(),
  candidateIds: z.array(uuid).max(20),
  rejectionRef: uuid.optional(),
}).strict().superRefine((trace, context) => {
  if (trace.status === 'confirmed' && trace.rejectionRef) {
    context.addIssue({ code: 'custom', path: ['status'], message: '[internal] Rejected traces cannot be confirmed' })
  }
  if (new Set(trace.candidateIds).size !== trace.candidateIds.length) {
    context.addIssue({ code: 'custom', path: ['candidateIds'], message: '[internal] Duplicate trace candidates' })
  }
})

const factMetadata = {
  schemaVersion,
  state: z.enum(['known', 'unknown']),
  traceId: uuid,
  sourceRef,
  observedAt: timestamp,
  readStatus: readStatusSchema,
  reason: z.string().min(1).max(2048).optional(),
}
function factVariant<Key extends string, Value extends z.ZodType>(key: Key, value: Value, owner: 'social' | 'portfolio' | 'registry') {
  return z.object({ ...factMetadata, key: z.literal(key), value: value.nullable(), owner: z.literal(owner) }).strict()
}
export const researchFactSchema = z.discriminatedUnion('key', [
  factVariant('nipConfirmed', z.boolean(), 'registry'),
  factVariant('businessStartedAt', timestamp, 'registry'),
  factVariant('vatStatus', z.enum(['active', 'inactive', 'exempt', 'not_registered']), 'registry'),
  factVariant('photographicPkd', z.boolean(), 'registry'),
  factVariant('businessStatus', z.enum(['active', 'suspended', 'removed']), 'registry'),
  factVariant('showsPrint', z.boolean(), 'portfolio'),
  factVariant('instagramLastPostAt', timestamp, 'social'),
  factVariant('instagramFollowers', z.number().int().nonnegative(), 'social'),
  factVariant('instagramEngagement', z.object({ rate: z.number().nonnegative(), analyzedPostCount: z.number().int().min(1).max(12) }).strict(), 'social'),
  factVariant('instagramFollowerGrowth', z.number().finite(), 'social'),
  factVariant('facebookLastPostAt', timestamp, 'social'),
  factVariant('ownDomain', z.boolean(), 'portfolio'),
  factVariant('websiteCurrent', z.boolean(), 'portfolio'),
  factVariant('bookingCalendar', z.boolean(), 'portfolio'),
  factVariant('gallerySystem', gallerySystemSchema, 'portfolio'),
  factVariant('googleMapsReviews', z.number().int().nonnegative(), 'portfolio'),
  factVariant('googleMapsRating', z.number().min(0).max(5), 'portfolio'),
  factVariant('category', photographerCategorySchema, 'portfolio'),
]).superRefine((fact, context) => {
  if ((fact.state === 'unknown') !== (fact.value === null)) {
    context.addIssue({ code: 'custom', path: ['value'], message: '[internal] Unknown facts require null; known facts require a value' })
  }
  if (fact.state === 'known' && fact.readStatus !== 'ok' && fact.readStatus !== 'partial') {
    context.addIssue({ code: 'custom', path: ['readStatus'], message: '[internal] Unavailable sources cannot establish known facts' })
  }
  if (fact.key === 'instagramEngagement' && fact.value && fact.value.analyzedPostCount < 12 && fact.readStatus !== 'partial') {
    context.addIssue({ code: 'custom', path: ['readStatus'], message: '[internal] Fewer than twelve posts is a partial result' })
  }
})

export const researchFactKeySchema = z.enum([
  'nipConfirmed', 'businessStartedAt', 'vatStatus', 'photographicPkd', 'businessStatus',
  'showsPrint', 'instagramLastPostAt', 'instagramFollowers', 'instagramEngagement',
  'instagramFollowerGrowth', 'facebookLastPostAt', 'ownDomain', 'websiteCurrent',
  'bookingCalendar', 'gallerySystem', 'googleMapsReviews', 'googleMapsRating', 'category',
])

function withinSnapshotLimit(value: unknown, context: z.RefinementCtx) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SNAPSHOT_BYTES) {
    context.addIssue({ code: 'custom', message: '[internal] Snapshot exceeds the UTF-8 size limit' })
  }
}

export const tracesSnapshotSchema = z.object({
  schemaVersion, evaluationId: uuid, evaluatedAt: timestamp,
  traces: z.array(traceEvidenceSchema).max(100),
  discoveryStatus: z.enum(['complete', 'partial', 'unavailable']),
}).strict().superRefine(withinSnapshotLimit)
export const factsSnapshotSchema = z.object({
  schemaVersion, evaluationId: uuid, evaluatedAt: timestamp,
  facts: z.array(researchFactSchema).max(100),
  tracesRef: uuid,
  previousFactsRef: uuid.optional(),
}).strict().superRefine((snapshot, context) => {
  withinSnapshotLimit(snapshot, context)
  if (new Set(snapshot.facts.map((fact) => fact.key)).size !== snapshot.facts.length) {
    context.addIssue({ code: 'custom', path: ['facts'], message: '[internal] Fact keys must have one canonical owner and value' })
  }
})

export const scoreSnapshotSchema = z.object({
  schemaVersion,
  evaluationId: uuid,
  factsRef: uuid,
  rulesVersion: version,
  evaluatedAt: timestamp,
  score: z.number().int().min(0).max(100),
  matchedRules: z.array(z.object({
    ruleId: z.string().min(1).max(100), factKey: researchFactKeySchema,
    sourceRef, points: z.number().int().min(0).max(100),
  }).strict()).max(100),
  flags: z.array(businessFlagSchema).max(3),
  category: photographerCategorySchema,
  suggestedAction: evaluationActionSchema,
  unknownFactKeys: z.array(researchFactKeySchema).max(100),
}).strict().superRefine((snapshot, context) => {
  withinSnapshotLimit(snapshot, context)
  const expectedScore = Math.min(100, snapshot.matchedRules.reduce((sum, rule) => sum + rule.points, 0))
  if (snapshot.score !== expectedScore || new Set(snapshot.matchedRules.map((rule) => rule.ruleId)).size !== snapshot.matchedRules.length) {
    context.addIssue({ code: 'custom', path: ['score'], message: '[internal] Score must be the capped sum of unique rules' })
  }
  if (snapshot.flags.length > 0 && snapshot.suggestedAction !== 'review') {
    context.addIssue({ code: 'custom', path: ['suggestedAction'], message: '[internal] Business flags require review' })
  }
})

export const messageSnapshotSchema = z.object({
  schemaVersion, evaluationId: uuid, recipientSource: z.literal('registration'),
  body: z.string().min(1).max(2000).refine((value) => value.trim().length > 0),
  allowedEvidenceRefs: z.array(uuid).max(100),
  internalRationale: z.string().min(1).max(8192),
  createdAt: timestamp, factsRef: uuid,
}).strict().superRefine(withinSnapshotLimit)

const eligibilitySnapshotBaseSchema = z.object({
  schemaVersion,
  photographerId: uuid,
  requestId: uuid,
  status: z.literal('no_orders_confirmed'),
  checkedAt: timestamp,
  confirmedBy: uuid,
  sourceRef,
  expiresAt: timestamp,
}).strict()
export const eligibilitySnapshotSchema = eligibilitySnapshotBaseSchema.superRefine((snapshot, context) => {
  if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.checkedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: '[internal] Eligibility must expire after the check' })
  }
})
export const waiverSnapshotSchema = z.object({
  schemaVersion, evaluationId: uuid, factsRef: uuid, proposalId: uuid,
  selectedOptionId: z.string().min(1).max(100),
  reason: z.string().trim().min(1).max(4096),
  confirmedBy: uuid, createdAt: timestamp,
  flags: z.array(businessFlagSchema).min(1).max(3),
}).strict()
export const evaluationSummarySchema = z.object({
  schemaVersion, photographerId: uuid, personId: uuid, dealId: uuid, evaluationId: uuid,
  evaluatedAt: timestamp, completedAt: timestamp.optional(), rulesVersion: version,
  instructionVersions: z.array(z.object({ agentId: z.string().min(1).max(150), version }).strict()).max(6),
  steps: z.array(z.object({
    stepId: z.string().min(1).max(100), snapshotId: uuid.optional(), runId: uuid.optional(),
    status: z.enum(['done', 'partial', 'unavailable', 'waiting', 'rejected']),
  }).strict()).max(30),
  previousEvaluationId: uuid.optional(),
  changedFactKeys: z.array(researchFactKeySchema).max(100),
  decisions: z.array(z.object({
    proposalId: uuid, disposition: z.enum(['approved', 'edited', 'rejected']),
    selectedOptionId: z.string().min(1).max(100).optional(), decidedAt: timestamp,
  }).strict()).max(30),
}).strict().superRefine(withinSnapshotLimit)

export const eligibilityCreateSchema = eligibilitySnapshotBaseSchema.pick({
  photographerId: true, requestId: true, status: true, checkedAt: true, sourceRef: true,
})
export const evaluationStartSchema = z.object({
  registrationIds: z.array(uuid).min(1).max(200).refine((ids) => new Set(ids).size === ids.length),
  requestId: uuid,
}).strict()
export const messageRevisionCreateSchema = z.object({
  proposalId: uuid, body: z.string().min(1).max(2000).refine((value) => value.trim().length > 0), expectedProposalUpdatedAt: timestamp,
}).strict()
export const waiverCreateSchema = z.object({
  selectedOptionId: z.string().min(1).max(100), reason: z.string().trim().min(1).max(4096), expectedProposalUpdatedAt: timestamp,
}).strict()
export const materialQuerySchema = z.object({ id: uuid }).strict()
export const expectedVersionsSchema = z.object({ personUpdatedAt: timestamp, dealUpdatedAt: timestamp, factsRef: uuid }).strict()

export type TraceEvidence = z.infer<typeof traceEvidenceSchema>
export type ResearchFact = z.infer<typeof researchFactSchema>
export type ResearchFactKey = z.infer<typeof researchFactKeySchema>
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>
export type MessageSnapshot = z.infer<typeof messageSnapshotSchema>
export type EligibilitySnapshot = z.infer<typeof eligibilitySnapshotSchema>
export type WaiverSnapshot = z.infer<typeof waiverSnapshotSchema>
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>
export type FactsSnapshot = z.infer<typeof factsSnapshotSchema>
export type TracesSnapshot = z.infer<typeof tracesSnapshotSchema>
export type PhotographerCategory = z.infer<typeof photographerCategorySchema>
export type BusinessFlag = z.infer<typeof businessFlagSchema>

export const evaluationMaterialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('traces'), data: tracesSnapshotSchema }).strict(),
  z.object({ kind: z.literal('facts'), data: factsSnapshotSchema }).strict(),
  z.object({ kind: z.literal('score'), data: scoreSnapshotSchema }).strict(),
  z.object({ kind: z.literal('message'), data: messageSnapshotSchema }).strict(),
  z.object({ kind: z.literal('summary'), data: evaluationSummarySchema }).strict(),
  z.object({ kind: z.literal('eligibility'), data: eligibilitySnapshotSchema }).strict(),
  z.object({ kind: z.literal('waiver'), data: waiverSnapshotSchema }).strict(),
]).superRefine(withinSnapshotLimit)
export type EvaluationMaterial = z.infer<typeof evaluationMaterialSchema>
