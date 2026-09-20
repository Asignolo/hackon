import { errorResult, type ApifyResearchResult } from '../result'
import { normalizeNipTarget } from '../targets'
import { completeResult, createNormalizerState, optionalString } from './common'

export type CeidgCompanyData = {
  nip: string
  companyName: string | null
  regon: string | null
  krs: string | null
  businessStatus: string | null
  registerDate: string | null
  registry: string | null
}

export function normalizeCeidgCompany(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  expectedNip: string
}): ApifyResearchResult<CeidgCompanyData> {
  const failure = (code: 'no_data' | 'schema_changed', message: string) => errorResult<CeidgCompanyData>({
    platform: 'ceidg', actorRunId: input.actorRunId, code, message,
  })
  if (input.items.length === 0) return failure('no_data', 'No company registry record was returned.')
  const record = input.items.find((item) => item.status === 'AKTYWNY' && item.nip === input.expectedNip) ?? input.items[0]
  if (!record || typeof record.nip !== 'string') return failure('schema_changed', 'The registry record has no valid NIP.')
  try {
    if (normalizeNipTarget(record.nip).nip !== input.expectedNip) {
      return failure('schema_changed', 'The registry record does not match the requested NIP.')
    }
  } catch {
    return failure('schema_changed', 'The registry record has an invalid NIP.')
  }
  const fields = ['companyName', 'regon', 'krs', 'status', 'registerDate', 'source']
  if (fields.some((field) => record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string')) {
    return failure('schema_changed', 'The registry record fields changed shape.')
  }
  const state = createNormalizerState()
  return completeResult({
    platform: 'ceidg', canonicalUrl: null, sourceUrl: null, actorRunId: input.actorRunId, state,
    data: {
      nip: input.expectedNip,
      companyName: optionalString(record, ['companyName'], 'companyName', state, 500),
      regon: optionalString(record, ['regon'], 'regon', state, 14),
      krs: optionalString(record, ['krs'], 'krs', state, 10),
      businessStatus: optionalString(record, ['status'], 'businessStatus', state, 100),
      registerDate: optionalString(record, ['registerDate'], 'registerDate', state, 40),
      registry: optionalString(record, ['source'], 'registry', state, 40),
    },
  })
}
