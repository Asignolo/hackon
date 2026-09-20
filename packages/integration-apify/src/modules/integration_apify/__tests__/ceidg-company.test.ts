import metadata from '../__fixtures__/ceidg-metadata.json'
import { resolveApifyInputSchemaHash, resolveApifyPricingFingerprint } from '../lib/health'
import { ceidgCompanyTool } from '../ai-tools'
import { ACTOR_CATALOG } from '../lib/actor-catalog'
import { normalizeCeidgCompany } from '../lib/normalizers/ceidg-company'
import { normalizeNipTarget } from '../lib/targets'

const nip = '5260250274'
const record = { nip, companyName: 'Synthetic registry fixture', regon: '123456789', krs: '0000123456', status: 'AKTYWNY', registerDate: '2001-01-01', source: 'KRS' }
const normalize = (items: Array<Record<string, unknown>>) => normalizeCeidgCompany({ items, actorRunId: 'fixture-run', expectedNip: nip })

describe('CEIDG company research', () => {
  it('pins the schema and active price verified from public actor metadata', () => {
    expect(resolveApifyInputSchemaHash({ actorDefinition: { input: metadata.input } })).toBe(ACTOR_CATALOG.ceidg_company.inputSchemaHash)
    expect(resolveApifyPricingFingerprint(metadata, Date.parse('2026-09-20T00:00:00Z'))).toBe(ACTOR_CATALOG.ceidg_company.pricingFingerprint)
    expect(metadata.buildNumber).toBe(ACTOR_CATALOG.ceidg_company.build)
  })

  it('normalizes formatting and checks NIP before any external call', async () => {
    expect(normalizeNipTarget(' PL 526-025-02-74 ')).toEqual({ nip })
    for (const invalid of ['5260250275', '0000000000', '123', 'abc5260250274', '52602502740']) {
      expect(() => normalizeNipTarget(invalid)).toThrow()
      expect(await ceidgCompanyTool.handler({ nip: invalid }, {} as never)).toMatchObject({
        status: 'error', diagnostics: [{ code: 'invalid_target' }],
      })
    }
  })

  it('builds only a bounded registry lookup from the validated target', () => {
    expect(ACTOR_CATALOG.ceidg_company.buildInput({ nip })).toEqual({
      searchMode: 'nip', searchValues: [nip], maxResults: 1, sourceFilter: 'ALL', status: 'ALL',
    })
    expect(ACTOR_CATALOG.ceidg_company).toMatchObject({ build: '3.0.7', maxItems: 1, minimumChargeUsd: 0.00305 })
    expect(() => ACTOR_CATALOG.ceidg_company.buildInput({ username: 'invalid' })).toThrow()
  })

  it('returns only allowlisted company fields and no fabricated source URL', () => {
    const result = normalize([{ ...record, bankAccount: 'private', ownerPhone: 'private' }])
    expect(result).toMatchObject({ status: 'complete', platform: 'ceidg', sourceUrl: null, canonicalUrl: null,
      data: { nip, companyName: record.companyName, registry: 'KRS', businessStatus: 'AKTYWNY' } })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('preserves missing fields as unavailable and distinguishes empty from malformed data', () => {
    expect(normalize([{ nip }])).toMatchObject({ status: 'partial', data: { nip, companyName: null },
      unavailableFields: expect.arrayContaining([{ field: 'companyName', reason: 'not_exposed' }]) })
    expect(normalize([])).toMatchObject({ status: 'no_data', data: null })
    for (const malformed of [{}, { nip: 5260250274 }, { ...record, companyName: {} }, { ...record, nip: '8567346215' }]) {
      expect(normalize([malformed])).toMatchObject({ status: 'error', data: null, diagnostics: [{ code: 'schema_changed' }] })
    }
  })
})
