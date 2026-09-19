import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { UserTask } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun, AgentProposal, AgentGuardrailCheck } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { persistVerdict } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/guardrailService'
import { publishEvaluationReview } from '../lib/evaluation-review-publication'
import { readEvaluationReviewMaterials } from '../lib/evaluation-review-materials'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })) }))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/guardrailService', () => ({ persistVerdict: jest.fn() }))
jest.mock('../lib/evaluation-review-materials', () => ({ readEvaluationReviewMaterials: jest.fn() }))

function fixture() {
  const job = { workflowInstanceId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID(), operationId: randomUUID(), scoreRef: randomUUID() }
  const payload = { evaluationId: randomUUID(), registrationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), factsRef: randomUUID(), scoreRef: job.scoreRef }
  const attemptId = randomUUID()
  const run = Object.assign(new AgentRun(), { id: randomUUID(), workflowInstanceId: job.workflowInstanceId, stepId: 'review', agentId: 'photographers.evaluation_review', invocationId: attemptId, completedAt: null })
  const proposal = Object.assign(new AgentProposal(), { id: randomUUID(), workflowInstanceId: job.workflowInstanceId, stepId: 'review', agentId: 'photographers.evaluation_review', disposition: 'pending', userTaskId: null })
  const records: { run: AgentRun | null; proposals: AgentProposal[]; guard: object | null; tasks: UserTask[] } = { run: null, proposals: [], guard: null, tasks: [] }
  const em = { fork: jest.fn() }; em.fork.mockReturnValue(em)
  const execute = jest.fn(async (command: string, options: { input: Record<string, unknown> }) => {
    if (command === 'agent_orchestrator.runs.create') { records.run = run; return { result: { runId: run.id } } }
    if (command === 'agent_orchestrator.proposals.create') { proposal.payload = options.input.payload as AgentProposal['payload']; records.proposals = [proposal]; return { result: { proposalId: proposal.id } } }
    if (command === 'agent_orchestrator.runs.complete') { run.completedAt = new Date(); run.status = 'ok'; run.resultKind = 'proposal'; run.output = options.input.output as AgentRun['output'] }
    return { result: {} }
  })
  const checkOutput = jest.fn().mockResolvedValue({ result: 'pass', checks: [] })
  const dispose = jest.fn(async () => {
    proposal.userTaskId = randomUUID()
    records.tasks.push(Object.assign(new UserTask(), { id: proposal.userTaskId, formSchema: { proposalId: proposal.id }, status: 'PENDING' }))
    return { kind: 'user_task', userTaskId: proposal.userTaskId }
  })
  const container = createContainer()
  container.register({ em: asValue(em), commandBus: asValue({ execute }), guardrailService: asValue({ checkOutput }), dispositionService: asValue({ dispose }) })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => {
    if (entity === AgentRun) return records.run as never
    if (entity === AgentProposal) return records.proposals[0] as never
    if (entity === AgentGuardrailCheck) return records.guard as never
    return null
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => (entity === UserTask ? records.tasks : records.proposals) as never)
  jest.mocked(readEvaluationReviewMaterials).mockResolvedValue({} as never)
  jest.mocked(persistVerdict).mockImplementation(async () => { records.guard = { id: randomUUID() }; return undefined as never })
  return { job, payload, attemptId, run, proposal, records, execute, checkOutput, dispose, container, publish: () => publishEvaluationReview(job, attemptId, payload, container) }
}
beforeEach(() => jest.clearAllMocks())

test('publishes one pending high risk proposal and forces a human task with refs only', async () => {
  const setup = fixture()
  await expect(setup.publish()).resolves.toEqual({ status: 'awaiting_review', runId: setup.run.id, proposalId: setup.proposal.id })
  const creation = setup.execute.mock.calls.find(([command]) => command === 'agent_orchestrator.proposals.create')![1].input
  expect(creation.payload).toEqual({ options: [{ id: 'review', label: expect.any(String), actions: [{ type: 'photographers.evaluation.review', risk: 'high', payload: setup.payload }] }], rationale: expect.any(String) })
  expect(setup.dispose).toHaveBeenCalledWith(setup.proposal, { alwaysAsk: true }, expect.objectContaining({ userId: setup.job.userId, review: { assignedTo: setup.job.userId } }))
  expect(persistVerdict).toHaveBeenCalledTimes(1)
  expect(setup.execute.mock.calls.map(([command]) => command)).toEqual(['agent_orchestrator.runs.create', 'agent_orchestrator.proposals.create', 'agent_orchestrator.trace.ingest', 'agent_orchestrator.runs.complete'])
  for (const call of jest.mocked(findOneWithDecryption).mock.calls) {
    expect(call[2]).toEqual(expect.objectContaining({ tenantId: setup.job.tenantId, organizationId: setup.job.organizationId }))
    expect(call[4]).toEqual({ tenantId: setup.job.tenantId, organizationId: setup.job.organizationId })
  }
})

test('replays publication without duplicate run, proposal, trace, guard or task', async () => {
  const setup = fixture()
  const original = await setup.publish()
  await expect(setup.publish()).resolves.toEqual(original)
  expect(setup.execute).toHaveBeenCalledTimes(4)
  expect(setup.dispose).toHaveBeenCalledTimes(1)
  expect(persistVerdict).toHaveBeenCalledTimes(1)
  expect(setup.checkOutput).toHaveBeenCalledTimes(2)
})

test('checks material ownership and access before creating records', async () => {
  const setup = fixture(); jest.mocked(readEvaluationReviewMaterials).mockRejectedValue(new Error('access denied'))
  await expect(setup.publish()).rejects.toThrow('access denied')
  expect(setup.execute).not.toHaveBeenCalled()
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

test('blocked guardrail prevents proposal and task publication', async () => {
  const setup = fixture(); setup.checkOutput.mockResolvedValue({ result: 'block', checks: [] })
  await expect(setup.publish()).rejects.toThrow('guardrail blocked')
  expect(setup.execute.mock.calls.map(([command]) => command)).toEqual(['agent_orchestrator.runs.create'])
  expect(setup.dispose).not.toHaveBeenCalled()
})

test.each(['workflowInstanceId', 'stepId', 'agentId', 'invocationId'] as const)('rejects an existing run with different %s', async (field) => {
  const setup = fixture(); setup.records.run = setup.run; setup.run[field] = randomUUID()
  await expect(setup.publish()).rejects.toThrow('run mismatch')
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects ambiguous proposals and changed payloads', async () => {
  const setup = fixture(); await setup.publish()
  setup.records.proposals.push(setup.proposal)
  await expect(setup.publish()).rejects.toThrow('ambiguous')
  setup.records.proposals.pop()
  setup.payload.factsRef = randomUUID()
  await expect(setup.publish()).rejects.toThrow('payload mismatch')
  expect(setup.dispose).toHaveBeenCalledTimes(1)
})

test('rejects already decided proposals', async () => {
  const setup = fixture(); await setup.publish(); setup.proposal.disposition = 'approved'
  await expect(setup.publish()).rejects.toThrow('proposal mismatch')
  expect(setup.dispose).toHaveBeenCalledTimes(1)
})

test('does not claim a task exists when disposition returns an unresolved placeholder', async () => {
  const setup = fixture(); setup.dispose.mockResolvedValue({ kind: 'user_task', userTaskId: 'pending:123' })
  await expect(setup.publish()).rejects.toThrow('task unavailable')
})

test('requires a persisted proposal-task link', async () => {
  const setup = fixture(); setup.dispose.mockResolvedValue({ kind: 'user_task', userTaskId: randomUUID() })
  await expect(setup.publish()).rejects.toThrow('task link unavailable')
})

test('rejects inconsistent completed run output', async () => {
  const setup = fixture(); await setup.publish(); setup.run.output = { proposalId: randomUUID(), scoreRef: setup.payload.scoreRef }
  await expect(setup.publish()).rejects.toThrow('completion mismatch')
})


test('stops retry after a task was persisted but its proposal link was lost', async () => {
  const setup = fixture()
  await setup.publish()
  setup.proposal.userTaskId = null
  await expect(setup.publish()).rejects.toThrow('task link requires recovery')
  await expect(setup.publish()).rejects.toThrow('task link requires recovery')
  expect(setup.dispose).toHaveBeenCalledTimes(1)
  expect(setup.records.tasks).toHaveLength(1)
  const taskRead = jest.mocked(findWithDecryption).mock.calls.find((call) => call[1] === UserTask)!
  expect(taskRead[2]).toEqual({ tenantId: setup.job.tenantId, organizationId: setup.job.organizationId, workflowInstanceId: setup.job.workflowInstanceId, stepInstanceId: setup.attemptId, branchInstanceId: null })
  expect(taskRead[3]).toEqual({ limit: 2 })
})

test.each(['missing', 'duplicate', 'different-id', 'different-proposal'])('rejects %s linked task history without creating another task', async (problem) => {
  const setup = fixture()
  await setup.publish()
  if (problem === 'missing') setup.records.tasks = []
  if (problem === 'duplicate') setup.records.tasks.push(Object.assign(new UserTask(), { ...setup.records.tasks[0], id: randomUUID() }))
  if (problem === 'different-id') setup.records.tasks[0].id = randomUUID()
  if (problem === 'different-proposal') setup.records.tasks[0].formSchema = { proposalId: randomUUID() }
  await expect(setup.publish()).rejects.toThrow()
  expect(setup.dispose).toHaveBeenCalledTimes(1)
})
