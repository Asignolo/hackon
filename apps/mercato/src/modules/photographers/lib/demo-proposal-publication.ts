import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { DispositionService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/disposition/dispositionService'
import type { GuardrailService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/guardrailService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import messages from '../i18n/en.json'
import { demoResearchInputSchema, demoReviewInputSchema, type DemoAgentInput } from '../data/demo-proposal-validators'
import { messageReviewEnvelopeSchema } from '../data/proposal-review-validators'
import { tracesSnapshotSchema } from '../data/evaluation-validators'
import { materialOperationId } from './material-codec'
import { readEvaluationMaterial } from './material-store'
import { reviewError } from './proposal-review-materials'
import { authorizeDemoCommand, demoCommandContext, withDemoOperationLock } from './demo-proposal-support'
import { completeDemoRun, ensureDemoRun } from './demo-proposal-runs'

function materialOwners(input: DemoAgentInput) {
  const { photographerId, personId, registrationId, dealId } = input.prepared
  return { photographerId, personId, registrationId, dealId }
}

export async function ensureDemoResearch(rawInput: unknown, container: AwilixContainer) {
  const input = demoResearchInputSchema.parse(rawInput)
  const ctx = demoCommandContext(input, container)
  await authorizeDemoCommand(ctx)
  return withDemoOperationLock(container, `${input.tenantId}:${input.organizationId}:${input.invocationId}`, async () => {
    const agentId = `photographers.demo_${input.lane}`
    const runId = await ensureDemoRun(input, agentId, ctx)
    const sourceRef = `https://example.invalid/photographers-demo/${input.lane}`
    const observedAt = input.prepared.evaluatedAt
    const traceId = materialOperationId(input.invocationId, `trace:${input.lane}`)
    const data = tracesSnapshotSchema.parse({ schemaVersion: 1, evaluationId: input.prepared.evaluationId, evaluatedAt: observedAt, discoveryStatus: 'complete', traces: [{ schemaVersion: 1, id: traceId, kind: input.lane === 'portfolio' ? 'website' : 'instagram', value: sourceRef, status: 'confirmed', provenance: [{ value: sourceRef, sourceRef, observedAt }], observedAt, candidateIds: [] }] })
    const stored = await container.resolve<CommandBus>('commandBus').execute<unknown, { id: string }>('photographers.evaluation.store_material', { input: { operationId: materialOperationId(input.invocationId, 'research'), snapshot: { ...materialOwners(input), material: { kind: 'traces', data } } }, ctx })
    await completeDemoRun(input, agentId, runId, 'research', { materialId: stored.result.id }, ctx)
    return { runId, materialId: stored.result.id }
  })
}

export async function publishDemoReview(rawInput: unknown, container: AwilixContainer) {
  const input = demoReviewInputSchema.parse(rawInput)
  const ctx = demoCommandContext(input, container)
  const scope = await authorizeDemoCommand(ctx)
  return withDemoOperationLock(container, `${input.tenantId}:${input.organizationId}:${input.invocationId}`, async () => {
    const { getDemoReviewBinding } = await import('./demo-workflow-runtime')
    const binding = await getDemoReviewBinding({ ...scope, workflowInstanceId: input.workflowInstanceId }, container)
    if (binding.invocationId !== input.invocationId || binding.prepared.requestId !== input.prepared.requestId) return reviewError(409, 'material_conflict')
    const { AgentProposal, AgentRun, AgentGuardrailCheck } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
    const em = container.resolve<EntityManager>('em').fork()
    const bus = container.resolve<CommandBus>('commandBus')
    const agentId = 'photographers.message_review'
    const runId = await ensureDemoRun(input, agentId, ctx)
    let proposal = await findOneWithDecryption(em, AgentProposal, { ...scope, runId, workflowInstanceId: input.workflowInstanceId, stepId: input.stepId, deletedAt: null }, {}, scope)
    if (!proposal) {
      const translate = (key: keyof typeof messages) => messages[key]
      for (const [lane, branch] of Object.entries(input.research)) {
        const run = await findOneWithDecryption(em, AgentRun, { id: branch.runId, ...scope, agentId: `photographers.demo_${lane}`, workflowInstanceId: input.workflowInstanceId, runtime: 'external', status: 'ok', deletedAt: null }, {}, scope)
        if (!run || !run.output || typeof run.output !== 'object' || !('materialId' in run.output) || run.output.materialId !== branch.materialId) return reviewError(409, 'material_conflict')
      }
      const branches = await Promise.all([input.research.portfolio, input.research.social].map((branch) => readEvaluationMaterial(branch.materialId, ctx)))
      if (branches.some((material) => material.kind !== 'traces' || material.evaluationId !== input.prepared.evaluationId || material.photographerId !== input.prepared.photographerId || material.personId !== input.prepared.personId || material.dealId !== input.prepared.dealId)) return reviewError(409, 'material_conflict')
      const traces = branches.flatMap((material) => material.kind === 'traces' ? material.data.traces : [])
      const portfolio = traces.find((trace) => trace.kind === 'website')
      if (!portfolio) return reviewError(409, 'invalid_material')
      const store = async (part: string, material: unknown) => (await bus.execute<unknown, { id: string }>('photographers.evaluation.store_material', { input: { operationId: materialOperationId(input.invocationId, part), snapshot: { ...materialOwners(input), material } }, ctx })).result.id
      const tracesRef = await store('traces', { kind: 'traces', data: { schemaVersion: 1, evaluationId: input.prepared.evaluationId, evaluatedAt: input.prepared.evaluatedAt, discoveryStatus: 'complete', traces } })
      const factsRef = await store('facts', { kind: 'facts', data: { schemaVersion: 1, evaluationId: input.prepared.evaluationId, evaluatedAt: input.prepared.evaluatedAt, tracesRef, facts: [{ schemaVersion: 1, key: 'ownDomain', owner: 'portfolio', state: 'known', value: true, traceId: portfolio.id, sourceRef: portfolio.value, observedAt: input.prepared.evaluatedAt, readStatus: 'ok' }] } })
      const messageSnapshotId = await store('message', { kind: 'message', data: { schemaVersion: 1, evaluationId: input.prepared.evaluationId, recipientSource: 'registration', body: translate('photographers.demo.material.message'), internalRationale: translate('photographers.demo.material.rationale'), allowedEvidenceRefs: [portfolio.id], createdAt: input.prepared.evaluatedAt, factsRef } })
      const prepared = await bus.execute<unknown, { personUpdatedAt: string; dealUpdatedAt: string }>('photographers.demo.review.prepare', { input, ctx })
      const payload = messageReviewEnvelopeSchema.parse({ options: [{ id: 'accept', label: translate('photographers.demo.option.approve'), actions: [{ type: 'photographers.message.accept', risk: 'high', payload: { evaluationId: input.prepared.evaluationId, photographerId: input.prepared.photographerId, personId: input.prepared.personId, dealId: input.prepared.dealId, factsRef, messageSnapshotId, expectedVersions: { personUpdatedAt: prepared.result.personUpdatedAt, dealUpdatedAt: prepared.result.dealUpdatedAt, factsRef } } }] }] })
      const verdict = await container.resolve<GuardrailService>('guardrailService').checkOutput({ capability: agentId, schema: messageReviewEnvelopeSchema, output: payload, allowedTools: [], attemptedTools: [] })
      if (verdict.result === 'block') return reviewError(409, 'invalid_material')
      const created = await bus.execute<unknown, { proposalId: string }>('agent_orchestrator.proposals.create', { input: { ...scope, agentId, runId, payload, workflowInstanceId: input.workflowInstanceId, stepId: input.stepId, guardResults: verdict.checks }, ctx })
      proposal = await findOneWithDecryption(em, AgentProposal, { id: created.result.proposalId, ...scope }, {}, scope)
      if (!proposal) return reviewError(409, 'material_conflict')
    }
    const verdict = await container.resolve<GuardrailService>('guardrailService').checkOutput({ capability: agentId, schema: messageReviewEnvelopeSchema, output: proposal.payload, allowedTools: [], attemptedTools: [] })
    if (verdict.result === 'block') return reviewError(409, 'invalid_material')
    const persistedGuard = await findOneWithDecryption(em, AgentGuardrailCheck, { ...scope, agentRunId: runId, proposalId: proposal.id, phase: 'output' }, {}, scope)
    if (!persistedGuard) {
      const { persistVerdict } = await import('@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/guardrailService')
      await persistVerdict({ em }, { ...scope, agentRunId: runId }, { verdict, capability: agentId, phase: 'output', proposalId: proposal.id })
    }
    await completeDemoRun(input, agentId, runId, 'proposal', { proposalId: proposal.id }, ctx)
    if (proposal.disposition === 'pending' && !proposal.userTaskId) {
      const outcome = await container.resolve<DispositionService>('dispositionService').dispose(proposal, { alwaysAsk: true }, { ...scope, userId: input.prepared.userId, workflowInstanceId: input.workflowInstanceId, stepId: input.stepId, review: { assignedTo: input.prepared.userId } })
      if (outcome.kind !== 'user_task' || outcome.userTaskId.startsWith('pending:')) return reviewError(503, 'review_unavailable')
    }
    return { runId, proposalId: proposal.id }
  })
}
