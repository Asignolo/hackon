import { asValue, createContainer } from 'awilix'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import { CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { installHiddenPotential } from '../lib/install-hidden-potential'
import { DEFAULT_HIDDEN_POTENTIAL_RULES, hiddenPotentialRulesSchema, loadHiddenPotentialRules } from '../lib/rules-config'
import { entities } from '../ce'

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerPipeline: class CustomerPipeline {}, CustomerPipelineStage: class CustomerPipelineStage {},
}))
jest.mock('@open-mercato/core/modules/entities/lib/field-definitions', () => ({ ensureCustomFieldDefinitions: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
let mockLocale = 'en'
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => `${mockLocale}:${key}` }) }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const pipelineId = '33333333-3333-4333-8333-333333333333'

type Pipeline = { id: string; name: string; tenantId: string; organizationId: string }
type Stage = { id: string; label: string; pipelineId: string; tenantId: string; organizationId: string }
function fixture() {
  const configs = new Map<string, unknown>()
  const pipelines: Pipeline[] = []
  const stages: Stage[] = []
  let failAfterStageCommit = false
  const configService = {
    getRecord: jest.fn(async (_module: string, key: string) => configs.has(key) ? { value: structuredClone(configs.get(key)) } : null),
    getValue: jest.fn(async (_module: string, key: string) => configs.has(key) ? structuredClone(configs.get(key)) : null),
    setValue: jest.fn(async (_module: string, key: string, value: unknown) => { configs.set(key, structuredClone(value)); return { value } }),
  }
  const execute = jest.fn(async (command: string, { input }: { input: Record<string, unknown> }) => {
    if (command === 'customers.pipelines.create') {
      pipelines.push({ ...input, id: pipelineId } as Pipeline)
      return { result: { pipelineId } }
    }
    if (command === 'customers.pipeline-stages.create') {
      const stageId = `44444444-4444-4444-8444-${String(stages.length).padStart(12, '0')}`
      stages.push({ ...input, id: stageId } as Stage)
      if (failAfterStageCommit) { failAfterStageCommit = false; throw new Error('Simulated crash after stage commit') }
      return { result: { stageId } }
    }
    throw new Error(`Unexpected command ${command}`)
  })
  const query = jest.fn()
  const lockEm = { getConnection: () => ({ execute: query }), getTransactionContext: () => ({}) }
  const em = { fork: () => ({ transactional: (action: (manager: typeof lockEm) => unknown) => action(lockEm) }) }
  const deleteByTags = jest.fn(async () => 1)
  const container = createContainer()
  container.register({ moduleConfigService: asValue(configService), commandBus: asValue({ execute }), cache: asValue({ deleteByTags }) })
  const context = { em, container, tenantId, organizationId } as unknown as InitSetupContext
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity, filter) => {
    const rows = entity === CustomerPipeline ? pipelines : entity === CustomerPipelineStage ? stages : []
    const where = filter as Record<string, unknown>
    return rows.filter((row) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value))
  })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, filter) => {
    const where = filter as Record<string, unknown>
    return pipelines.find((row) => Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)) ?? null
  })
  return { context, execute, configs, configService, pipelines, stages, query, deleteByTags, failNextStage: () => { failAfterStageCommit = true } }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLocale = 'en'
  jest.mocked(ensureCustomFieldDefinitions).mockResolvedValue({ created: 0, updated: 0, unchanged: 12 })
})

describe('hidden potential installation', () => {
  it('installs exactly one dedicated pipeline and seven stages across repeated setup without enterprise', async () => {
    const state = fixture()
    const first = await installHiddenPotential(state.context)
    const repeated = await installHiddenPotential(state.context)
    expect(repeated).toEqual(first)
    expect(state.pipelines).toHaveLength(1)
    expect(state.stages).toHaveLength(7)
    expect(state.execute).toHaveBeenCalledTimes(8)
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [`photographers:hidden-potential:install:${tenantId}`], 'all', {})
    expect(ensureCustomFieldDefinitions).toHaveBeenCalledWith(expect.anything(), expect.any(Array), { tenantId, organizationId: null })
    expect(state.execute.mock.calls.every(([command]) => command.startsWith('customers.'))).toBe(true)
  })

  it('invalidates cached field definitions only after installation or repair changes them', async () => {
    const state = fixture()
    jest.mocked(ensureCustomFieldDefinitions)
      .mockResolvedValueOnce({ created: 12, updated: 0, unchanged: 0 })
      .mockResolvedValueOnce({ created: 0, updated: 0, unchanged: 12 })
      .mockResolvedValueOnce({ created: 0, updated: 1, unchanged: 11 })
    await installHiddenPotential(state.context)
    expect(state.deleteByTags).toHaveBeenCalledTimes(1)
    expect(state.deleteByTags).toHaveBeenCalledWith(expect.arrayContaining([
      `entities:definitions:${tenantId}:entity:customers:customer_person_profile`,
      `entities:definitions:${tenantId}:entity:customers:customer_deal`,
    ]))
    await installHiddenPotential(state.context)
    expect(state.deleteByTags).toHaveBeenCalledTimes(1)
    await installHiddenPotential(state.context)
    expect(state.deleteByTags).toHaveBeenCalledTimes(2)
  })

  it('recovers a stage committed before its mapping was recorded', async () => {
    const state = fixture()
    state.failNextStage()
    await expect(installHiddenPotential(state.context)).rejects.toThrow('Simulated crash')
    mockLocale = 'pl'
    await installHiddenPotential(state.context)
    expect(state.pipelines).toHaveLength(1)
    expect(state.stages).toHaveLength(7)
    expect(new Set(state.stages.map((stage) => stage.label)).size).toBe(7)
  })

  it('keeps operator rules and stage names during repair', async () => {
    const state = fixture()
    const configured = { ...DEFAULT_HIDDEN_POTENTIAL_RULES, version: 'operator-2', contactThreshold: 75 }
    state.configs.set('hidden_potential_rules', configured)
    const installed = await installHiddenPotential(state.context)
    state.stages[0].label = 'Operator stage'
    expect(await installHiddenPotential(state.context)).toEqual(installed)
    expect(state.stages[0].label).toBe('Operator stage')
    expect(state.configs.get('hidden_potential_rules')).toEqual(configured)
    expect(state.execute).toHaveBeenCalledTimes(8)
  })

  it('rejects a deleted mapped pipeline instead of replacing it and silently orphaning deals', async () => {
    const state = fixture()
    await installHiddenPotential(state.context)
    state.pipelines.splice(0)
    await expect(installHiddenPotential(state.context)).rejects.toThrow('pipeline is missing')
    expect(state.execute).toHaveBeenCalledTimes(8)
  })

  it('scopes CRM lookups to tenant and organization and separates installation mappings', async () => {
    const state = fixture()
    await installHiddenPotential(state.context)
    for (const call of jest.mocked(findWithDecryption).mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ tenantId, organizationId }))
      expect(call[4]).toEqual({ tenantId, organizationId })
    }
    expect(state.configs.has(`hidden_potential_installation_${organizationId}`)).toBe(true)
    expect(state.configService.setValue).toHaveBeenCalledWith('photographers', expect.any(String), expect.anything(), { tenantId, organizationId })
  })

  it('encrypts facts, evidence, score reasons and business flags in field declarations', () => {
    const fields = entities.flatMap((entity) => entity.fields ?? [])
    for (const key of ['facts_json', 'traces_json', 'flags_json', 'score_breakdown_json']) {
      expect(fields.find((field) => field.key === `photographers_${key}`)).toEqual(expect.objectContaining({ encrypted: true, indexed: false, formEditable: false }))
    }
    expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length)
  })

  it('copies rule snapshots and rejects backfill or unsafe limits', async () => {
    const state = fixture()
    const rules = await loadHiddenPotentialRules(state.configService as unknown as Parameters<typeof loadHiddenPotentialRules>[0], { tenantId, organizationId })
    rules.weights.nipConfirmed = 0
    expect(DEFAULT_HIDDEN_POTENTIAL_RULES.weights.nipConfirmed).toBe(20)
    expect(hiddenPotentialRulesSchema.safeParse({ ...DEFAULT_HIDDEN_POTENTIAL_RULES, backfillOnInstall: true }).success).toBe(false)
    expect(hiddenPotentialRulesSchema.safeParse({ ...DEFAULT_HIDDEN_POTENTIAL_RULES, limits: { ...DEFAULT_HIDDEN_POTENTIAL_RULES.limits, batchSize: 201 } }).success).toBe(false)
  })
})
