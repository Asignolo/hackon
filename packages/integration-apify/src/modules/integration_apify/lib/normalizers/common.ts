import { diagnostic, type ApifyDiagnostic } from '../diagnostics'
import type { ApifyResearchResult, UnavailableField } from '../result'

export type NormalizerState = {
  unavailableFields: UnavailableField[]
  diagnostics: ApifyDiagnostic[]
}

export function createNormalizerState(): NormalizerState {
  return { unavailableFields: [], diagnostics: [] }
}

function select(record: Record<string, unknown>, keys: string[]): { found: boolean; value: unknown } {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return { found: true, value: record[key] }
  }
  return { found: false, value: undefined }
}

function unavailable(
  state: NormalizerState,
  field: string,
  reason: UnavailableField['reason'],
): null {
  state.unavailableFields.push({ field, reason })
  if (reason === 'schema_changed') {
    state.diagnostics.push(diagnostic('schema_changed', 'warning', `The upstream field ${field} changed shape.`, true))
  }
  return null
}

export function optionalString(
  record: Record<string, unknown>,
  keys: string[],
  field: string,
  state: NormalizerState,
  maxLength = 2_000,
): string | null {
  const selected = select(record, keys)
  if (!selected.found || selected.value === null || selected.value === '') {
    return unavailable(state, field, 'not_exposed')
  }
  if (typeof selected.value !== 'string') return unavailable(state, field, 'schema_changed')
  if (selected.value.length > maxLength) {
    state.diagnostics.push(diagnostic('output_truncated', 'warning', `The field ${field} was truncated to its safe limit.`, true))
  }
  return selected.value.slice(0, maxLength)
}

export function optionalNumber(
  record: Record<string, unknown>,
  keys: string[],
  field: string,
  state: NormalizerState,
): number | null {
  const selected = select(record, keys)
  if (!selected.found || selected.value === null) return unavailable(state, field, 'not_exposed')
  if (typeof selected.value !== 'number' || !Number.isFinite(selected.value)) {
    return unavailable(state, field, 'schema_changed')
  }
  return selected.value
}

export function optionalBoolean(
  record: Record<string, unknown>,
  keys: string[],
  field: string,
  state: NormalizerState,
): boolean | null {
  const selected = select(record, keys)
  if (!selected.found || selected.value === null) return unavailable(state, field, 'not_exposed')
  if (typeof selected.value !== 'boolean') return unavailable(state, field, 'schema_changed')
  return selected.value
}

export function optionalStringArray(
  record: Record<string, unknown>,
  keys: string[],
  field: string,
  state: NormalizerState,
  limit: number,
  maxItemLength = 500,
): string[] | null {
  const selected = select(record, keys)
  if (!selected.found || selected.value === null) return unavailable(state, field, 'not_exposed')
  if (!Array.isArray(selected.value) || selected.value.some((entry) => typeof entry !== 'string')) {
    return unavailable(state, field, 'schema_changed')
  }
  const unique = [...new Set(selected.value.map((entry) => entry.slice(0, maxItemLength)))]
  if (unique.length > limit || selected.value.some((entry) => entry.length > maxItemLength)) {
    state.diagnostics.push(diagnostic('output_truncated', 'warning', `The field ${field} was truncated to its safe limit.`, true))
  }
  return unique.slice(0, limit)
}

export function completeResult<T>(input: {
  platform: ApifyResearchResult<T>['platform']
  canonicalUrl: string | null
  sourceUrl: string | null
  actorRunId: string
  data: T
  state: NormalizerState
}): ApifyResearchResult<T> {
  return {
    ok: true,
    status: input.state.unavailableFields.length > 0 || input.state.diagnostics.some((entry) => entry.partial)
      ? 'partial'
      : 'complete',
    platform: input.platform,
    canonicalUrl: input.canonicalUrl,
    sourceUrl: input.sourceUrl,
    observedAt: new Date().toISOString(),
    actorRunId: input.actorRunId,
    data: input.data,
    unavailableFields: input.state.unavailableFields,
    diagnostics: input.state.diagnostics,
  }
}
