import type { ApifyDiagnostic, ApifyDiagnosticCode } from './diagnostics'
import { diagnostic } from './diagnostics'

export type UnavailableField = {
  field: string
  reason: 'not_exposed' | 'not_found' | 'private' | 'platform_blocked' | 'schema_changed' | 'redacted'
}

export type ApifyResearchResult<T> = {
  ok: boolean
  status: 'complete' | 'partial' | 'no_data' | 'error'
  platform: 'instagram' | 'facebook' | 'google_maps'
  canonicalUrl: string | null
  sourceUrl: string | null
  observedAt: string
  actorRunId: string | null
  data: T | null
  unavailableFields: UnavailableField[]
  diagnostics: ApifyDiagnostic[]
}

export function errorResult<T>(input: {
  platform: ApifyResearchResult<T>['platform']
  canonicalUrl?: string | null
  sourceUrl?: string | null
  actorRunId?: string | null
  code: ApifyDiagnosticCode
  message: string
}): ApifyResearchResult<T> {
  return {
    ok: false,
    status: input.code === 'no_data' ? 'no_data' : 'error',
    platform: input.platform,
    canonicalUrl: input.canonicalUrl ?? null,
    sourceUrl: input.sourceUrl ?? null,
    observedAt: new Date().toISOString(),
    actorRunId: input.actorRunId ?? null,
    data: null,
    unavailableFields: [],
    diagnostics: [diagnostic(input.code, input.code === 'no_data' ? 'info' : 'error', input.message)],
  }
}

export function serializedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
