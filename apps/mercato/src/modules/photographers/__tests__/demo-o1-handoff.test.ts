import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { readDemoO1Handoff } from '../lib/demo-o1-handoff'
import { authorizeDemo } from '../lib/demo-api'
import { readEvaluationMaterial } from '../lib/material-store'
import { discoveryResearch } from './portfolio-discovery-fixture'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../lib/demo-api', () => ({ authorizeDemo: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const references = { registrationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: '2026-09-19T10:00:00Z' }
  const result = { runId: randomUUID(), tracesRef: randomUUID(), status: 'partial' }
  const initialOutput = discoveryResearch()
  const output = { ...initialOutput, data: { ...initialOutput.data, status: 'partial', links: [{ type: 'instagram', originalUrl: 'https://instagram.com/photographer', url: 'https://www.instagram.com/photographer/', confidence: 'probable', approvalRequired: true, sources: [{ url: 'https://portfolio.example/contact', method: 'page_link', evidence: 'Portfolio links to the social profile' }] }] } }
  const instance = { id: randomUUID(), context: { o1Preparation: { result: { ...references, userId: randomUUID() } }, o1Result: { result } } }
  const run = { id: result.runId, completedAt: new Date(), output }
  const material = { ...references, kind: 'traces', id: result.tracesRef }
  const records = new Map<unknown, unknown>([[WorkflowInstance, instance], [AgentRun, run]])
  const em = { fork: jest.fn() }
  em.fork.mockReturnValue(em)
  const container = createContainer()
  container.register({ em: asValue(em) })
  const ctx: CommandRuntimeContext = { container, auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
  jest.mocked(authorizeDemo).mockResolvedValue(scope)
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => records.get(entity) as never)
  jest.mocked(readEvaluationMaterial).mockResolvedValue(material as never)
  return { scope, references, result, output, instance, run, material, records, em, ctx }
}

beforeEach(() => jest.clearAllMocks())

test('returns the complete saved O1 output including original links and provenance', async () => {
  const setup = fixture()
  await expect(readDemoO1Handoff(setup.instance.id, setup.ctx)).resolves.toEqual({ ...setup.references, workflowInstanceId: setup.instance.id, ...setup.result, sourcesAccepted: true, output: setup.output })
  expect(readEvaluationMaterial).toHaveBeenCalledWith(setup.result.tracesRef, setup.ctx)
  expect(authorizeDemo).toHaveBeenCalledWith(setup.ctx, false)
})

test('binds reads to authorized tenant, organization, workflow and successful O1 run', async () => {
  const setup = fixture()
  await readDemoO1Handoff(setup.instance.id, setup.ctx)
  expect(findOneWithDecryption).toHaveBeenCalledWith(setup.em, WorkflowInstance, { id: setup.instance.id, workflowId: 'photographers.demo-evaluation', ...setup.scope }, {}, setup.scope)
  expect(findOneWithDecryption).toHaveBeenCalledWith(setup.em, AgentRun, { id: setup.result.runId, workflowInstanceId: setup.instance.id, stepId: 'o1', agentId: 'agent_examples.portfolio_reader_o1', status: 'ok', resultKind: 'research', ...setup.scope }, {}, setup.scope)
})

test.each(['kind', 'evaluationId', 'registrationId', 'photographerId', 'personId', 'dealId'] as const)('rejects material with mismatched %s', async (field) => {
  const setup = fixture()
  setup.material[field] = field === 'kind' ? 'facts' : randomUUID()
  await expect(readDemoO1Handoff(setup.instance.id, setup.ctx)).rejects.toThrow('material binding mismatch')
})

test('rejects a missing run before reading its material', async () => {
  const setup = fixture()
  setup.records.delete(AgentRun)
  await expect(readDemoO1Handoff(setup.instance.id, setup.ctx)).rejects.toThrow('run is unavailable')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
})

test('rejects an unfinished run before reading its material', async () => {
  const setup = fixture()
  setup.records.set(AgentRun, { ...setup.run, completedAt: null })
  await expect(readDemoO1Handoff(setup.instance.id, setup.ctx)).rejects.toThrow('run is unavailable')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
})
