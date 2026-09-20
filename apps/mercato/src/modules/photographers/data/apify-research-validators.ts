import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
export const apifyResearchArgumentsSchema = z.object({ o1RunId: uuid, tracesRef: uuid }).strict()
export const apifyResearchOutcomeSchema = z.object({
  kind: z.literal('research'),
  data: z.object({
    schemaVersion: z.literal(1),
    status: z.enum(['complete', 'partial', 'no_data', 'no_targets', 'invalid_input', 'error']),
    results: z.array(z.object({
      tool: z.enum(['integration_apify.scrape_instagram_profile', 'integration_apify.scrape_facebook_page', 'integration_apify.scrape_google_maps_place', 'integration_apify.scrape_google_maps_reviews']),
      url: z.string().min(1), confidence: z.enum(['confirmed', 'probable', 'unconfirmed']),
      approvalRequired: z.boolean(), status: z.enum(['complete', 'partial', 'no_data', 'error']),
      actorRunId: z.string().nullable(), observedAt: z.string().nullable(),
      resultJson: z.string().nullable(), error: z.string().nullable(),
    }).strict()),
    skipped: z.array(z.object({ url: z.string().nullable(), reason: z.string().min(1) }).strict()),
    summary: z.string().min(1),
  }).strict(),
}).strict()

export const apifyResearchSnapshotSchema = z.object({
  schemaVersion: z.literal(1), evaluationId: uuid, evaluatedAt: timestamp,
  o1RunId: uuid, tracesRef: uuid, workflowInstanceId: uuid, stepId: z.string().min(1),
  invocationId: uuid, userId: uuid,
  state: z.enum(['claimed', 'finished']),
  runId: uuid.nullable(), runStatus: z.string().nullable(),
  outcomeStatus: apifyResearchOutcomeSchema.shape.data.shape.status.nullable(),
  payloadRefs: z.array(uuid),
}).strict()

export const apifyResearchPartSchema = z.object({
  schemaVersion: z.literal(1), evaluationId: uuid, evaluatedAt: timestamp,
  invocationId: uuid, index: z.number().int().nonnegative(), content: z.string().max(16000),
}).strict()

export const apifyResearchPayloadSchema = z.object({
  outcome: apifyResearchOutcomeSchema.nullable(),
  rawOutput: z.unknown(),
  o1: z.unknown(),
  error: z.string().nullable(),
  toolCalls: z.array(z.object({
    id: uuid, toolName: z.string(), status: z.string(), observedAt: timestamp,
    requestSummary: z.unknown(), responseSummary: z.unknown(),
    requestArtifactKey: z.string().nullable(), responseArtifactKey: z.string().nullable(),
    error: z.string().nullable(),
  }).strict()),
}).strict()
