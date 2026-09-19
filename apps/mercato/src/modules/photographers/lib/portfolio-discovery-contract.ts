import { tracesSnapshotSchema } from '../data/evaluation-validators'
import { portfolioDiscoveryInputSchema, portfolioDiscoveryResultSchema, portfolioDiscoverySnapshotContextSchema } from '../data/portfolio-discovery-validators'
import { materialOperationId } from './material-codec'

export const PORTFOLIO_DISCOVERY_AGENT_ID = 'agent_examples.portfolio_reader_o1'
export const PORTFOLIO_DISCOVERY_WORKFLOW_ID = 'photographers.hidden_potential'
export const PORTFOLIO_DISCOVERY_STEP_ID = 'o1'

export function preparePortfolioDiscoveryInput(registration: {
  firstName: string; lastName: string; email: string; portfolioRaw: string;
}) {
  return portfolioDiscoveryInputSchema.parse({
    originalPortfolio: registration.portfolioRaw, registrationEmail: registration.email,
    firstName: registration.firstName, lastName: registration.lastName,
  })
}

export function preparePortfolioDiscoveryMaterial(rawResult: unknown, rawContext: unknown) {
  const { data: research } = portfolioDiscoveryResultSchema.parse(rawResult)
  const context = portfolioDiscoverySnapshotContextSchema.parse(rawContext)
  const candidates = [
    ...research.links.map((link) => ({ kind: link.type === 'contact' ? 'website' as const : link.type, value: new URL(link.url).href, sources: link.sources, metadata: `confidence=${link.confidence}; approvalRequired=${link.approvalRequired}` })),
    ...research.nip.map((nip) => ({ kind: 'nip' as const, value: nip.value, sources: nip.sources, metadata: `confidence=${nip.confidence}; approvalRequired=${nip.approvalRequired}; checksumValid=${nip.checksumValid}` })),
    ...research.city.map((city) => ({ kind: 'city' as const, value: city.value, sources: city.sources, metadata: `confidence=${city.confidence}; approvalRequired=${city.approvalRequired}` })),
  ]
  const traces = new Map<string, {
    schemaVersion: 1; id: string; kind: typeof candidates[number]['kind']; value: string;
    status: 'unconfirmed'; provenance: Array<{ value: string; sourceRef: string; observedAt: string }>;
    observedAt: string; candidateIds: string[];
  }>()
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.value}`
    const trace = traces.get(key) ?? {
      schemaVersion: 1, id: materialOperationId(context.evaluationId, `o1:${key}`),
      kind: candidate.kind, value: candidate.value, status: 'unconfirmed', provenance: [],
      observedAt: context.observedAt, candidateIds: [],
    }
    for (const source of candidate.sources) {
      const sourceRef = new URL(source.url).href
      const value = `${source.method}; ${candidate.metadata}: ${source.evidence}`
      if (!trace.provenance.some((existing) => existing.sourceRef === sourceRef && existing.value === value)) {
        trace.provenance.push({ value, sourceRef, observedAt: context.observedAt })
      }
    }
    traces.set(key, trace)
  }
  const exhausted = research.stopReason === 'search_exhausted'
    && ['complete', 'partial', 'no_results'].includes(research.status)
    && Object.values(research.coverage).every((status) => status === 'found' || status === 'not_found')
    && research.attempts.some((attempt) => attempt.tool === 'web_search' && ['found', 'not_found'].includes(attempt.outcome))
    && !research.attempts.some((attempt) => ['blocked', 'unavailable', 'timeout', 'error'].includes(attempt.outcome))
  const snapshot = tracesSnapshotSchema.parse({
    schemaVersion: 1, evaluationId: context.evaluationId, evaluatedAt: context.evaluatedAt,
    discoveryStatus: exhausted ? 'complete' : research.stopReason === 'tools_unavailable' && traces.size === 0 ? 'unavailable' : 'partial',
    traces: [...traces.values()],
  })
  return { research, material: { kind: 'traces' as const, data: snapshot } }
}
