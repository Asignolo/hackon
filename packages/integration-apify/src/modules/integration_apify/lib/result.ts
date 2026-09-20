import type { ApifyDiagnostic, ApifyDiagnosticCode } from './diagnostics'
import { diagnostic } from './diagnostics'

export type UnavailableField = {
  field: string
  reason: 'not_exposed' | 'not_found' | 'private' | 'platform_blocked' | 'schema_changed' | 'redacted'
}

export type ApifyResearchResult<T> = {
  ok: boolean
  status: 'complete' | 'partial' | 'no_data' | 'error'
  platform: 'instagram' | 'facebook' | 'google_maps' | 'ceidg'
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

function truncateJsonValue(
  value: unknown,
  limits: { stringLength: number; arrayLength: number; objectKeys: number },
): unknown {
  if (typeof value === 'string') return value.slice(0, limits.stringLength)
  if (Array.isArray(value)) {
    return value.slice(0, limits.arrayLength).map((entry) => truncateJsonValue(entry, limits))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, limits.objectKeys)
        .map(([key, entry]) => [key, truncateJsonValue(entry, limits)]),
    )
  }
  return value
}

export function enforceApifyResultSize<T>(
  result: ApifyResearchResult<T>,
  maximumBytes = 64 * 1024,
): ApifyResearchResult<T> {
  if (serializedSize(result) <= maximumBytes) return result
  const plans = [
    { stringLength: 4_096, arrayLength: 25, objectKeys: 100 },
    { stringLength: 2_048, arrayLength: 20, objectKeys: 75 },
    { stringLength: 1_024, arrayLength: 10, objectKeys: 50 },
    { stringLength: 512, arrayLength: 5, objectKeys: 30 },
    { stringLength: 128, arrayLength: 3, objectKeys: 10 },
    { stringLength: 16, arrayLength: 1, objectKeys: 2 },
    { stringLength: 0, arrayLength: 0, objectKeys: 0 },
  ]
  for (const limits of plans) {
    const candidate: ApifyResearchResult<T> = {
      ...result,
      ok: true,
      status: 'partial',
      data: truncateJsonValue(result.data, limits) as T,
      unavailableFields: result.unavailableFields.slice(0, limits.objectKeys),
      diagnostics: [
        ...result.diagnostics.filter((entry) => entry.code !== 'output_truncated'),
        diagnostic(
          'output_truncated',
          'warning',
          'The normalized Apify result was truncated to its safe serialized size.',
          true,
        ),
      ],
    }
    if (serializedSize(candidate) <= maximumBytes) return candidate
  }
  throw new Error('[internal] Unable to bound the normalized Apify result.')
}
