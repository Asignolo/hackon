import { tracesSnapshotSchema } from '../data/evaluation-validators'
import { traceFinderInputSchema, traceFinderResultSchema, traceFinderSnapshotContextSchema } from '../data/trace-finder-validators'
import { materialOperationId } from './material-codec'

export const TRACE_FINDER_AGENT_ID = 'photographers.trace_finder'
export const TRACE_FINDER_WORKFLOW_ID = 'photographers.hidden_potential'
export const TRACE_FINDER_STEP_ID = 'o2'

export function prepareTraceFinderInput(registration: {
  id: string; firstName: string; lastName: string; email: string; portfolioRaw: string;
}) {
  return traceFinderInputSchema.parse({
    registrationId: registration.id,
    firstName: registration.firstName,
    lastName: registration.lastName,
    email: registration.email,
    portfolioRaw: registration.portfolioRaw,
  })
}

function canonicalTraceUrl(value: string) {
  const url = new URL(value)
  return url.href
}

export function prepareTraceFinderMaterial(rawResult: unknown, rawContext: unknown) {
  const result = traceFinderResultSchema.parse(rawResult)
  const context = traceFinderSnapshotContextSchema.parse(rawContext)
  const byUrl = new Map<string, {
    kind: 'website' | 'instagram' | 'facebook' | 'google_maps';
    provenance: Array<{ value: string; sourceRef: string; observedAt: string }>;
  }>()
  for (const candidate of result.data.candidates) {
    const url = canonicalTraceUrl(candidate.url)
    const kind = candidate.kind === 'other' ? 'website' : candidate.kind
    const previous = byUrl.get(url)
    if (previous && previous.kind !== kind) throw new Error('[internal] Conflicting O2 candidate kinds')
    const trace = previous ?? { kind, provenance: [] }
    const sourceRef = canonicalTraceUrl(candidate.sourceUrl)
    const value = `${candidate.name}: ${candidate.evidence}`
    if (!trace.provenance.some((source) => source.sourceRef === sourceRef && source.value === value)) {
      trace.provenance.push({ value, sourceRef, observedAt: context.observedAt })
    }
    byUrl.set(url, trace)
  }
  const snapshot = tracesSnapshotSchema.parse({
    schemaVersion: 1,
    evaluationId: context.evaluationId,
    evaluatedAt: context.evaluatedAt,
    discoveryStatus: result.data.status === 'unavailable' ? 'unavailable' : 'partial',
    traces: [...byUrl].map(([url, trace]) => ({
      schemaVersion: 1,
      id: materialOperationId(context.evaluationId, `o2:${url}`),
      kind: trace.kind,
      value: url,
      status: 'unconfirmed',
      provenance: trace.provenance,
      observedAt: context.observedAt,
      candidateIds: [],
    })),
  })
  return { research: result.data, material: { kind: 'traces' as const, data: snapshot } }
}
