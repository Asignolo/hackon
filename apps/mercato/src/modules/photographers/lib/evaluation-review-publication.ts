import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { UserTask } from '@open-mercato/core/modules/workflows/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { AgentRun, AgentProposal, AgentGuardrailCheck } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { DispositionService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/disposition/dispositionService'
import { persistVerdict, type GuardrailService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/guardrailService'
import type { EvaluationReviewJob } from '../data/evaluation-review-workflow-validators'
import { evaluationReviewEnvelopeSchema, evaluationReviewPayloadSchema } from '../data/evaluation-review-validators'
import { readEvaluationReviewMaterials } from './evaluation-review-materials'
import { reviewDigest } from './proposal-review-materials'
import { evaluationReviewContext, EVALUATION_REVIEW_AGENT, EVALUATION_REVIEW_STEP } from './evaluation-review-workflow'

export async function publishEvaluationReview(job: EvaluationReviewJob, attemptId: string, rawPayload: unknown, container: AwilixContainer) {
  const startedAt = new Date()
  const payload = evaluationReviewPayloadSchema.parse(rawPayload)
  const ctx = evaluationReviewContext(container, job)
  await readEvaluationReviewMaterials(payload, ctx)
  const em = container.resolve<EntityManager>('em').fork()
  const bus = container.resolve<CommandBus>('commandBus')
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const binding = { ...scope, workflowInstanceId: job.workflowInstanceId, stepId: EVALUATION_REVIEW_STEP, agentId: EVALUATION_REVIEW_AGENT, invocationId: attemptId }
  const externalRunId = `${EVALUATION_REVIEW_AGENT}:${job.operationId}`
  let run = await findOneWithDecryption(em, AgentRun, { ...scope, runtime: 'external', externalRunId, deletedAt: null }, {}, scope)
  if (!run) {
    const created = await bus.execute<unknown, { runId: string }>('agent_orchestrator.runs.create', { input: { ...binding, runtime: 'external', externalRunId, agentType: 'decision_maker', input: { scoreRef: payload.scoreRef, factsRef: payload.factsRef, evaluationId: payload.evaluationId, source: 'deterministic_rules' } }, ctx })
    run = await findOneWithDecryption(em.fork(), AgentRun, { id: created.result.runId, ...scope, deletedAt: null }, {}, scope)
  }
  if (!run || run.workflowInstanceId !== binding.workflowInstanceId || run.stepId !== binding.stepId || run.invocationId !== attemptId || run.agentId !== binding.agentId) throw new Error('[internal] Evaluation review run mismatch')
  const proposals = await findWithDecryption(em.fork(), AgentProposal, { ...scope, runId: run.id, deletedAt: null }, { limit: 2 }, scope)
  if (proposals.length > 1) throw new Error('[internal] Evaluation review proposal is ambiguous')
  let proposal = proposals[0]
  const { translate } = await resolveTranslations()
  const envelope = evaluationReviewEnvelopeSchema.parse(proposal?.payload ?? {
    options: [{ id: 'review', label: translate('photographers.evaluation_review.option'), actions: [{ type: 'photographers.evaluation.review', risk: 'high', payload }] }],
    rationale: translate('photographers.evaluation_review.rationale'),
  })
  if (reviewDigest(envelope.options[0].actions[0].payload) !== reviewDigest(payload)) throw new Error('[internal] Evaluation review payload mismatch')
  const verdict = await container.resolve<GuardrailService>('guardrailService').checkOutput({ capability: EVALUATION_REVIEW_AGENT, schema: evaluationReviewEnvelopeSchema, output: envelope, allowedTools: [], attemptedTools: [] })
  if (verdict.result === 'block') throw new Error('[internal] Evaluation review guardrail blocked')
  if (!proposal) {
    const created = await bus.execute<unknown, { proposalId: string }>('agent_orchestrator.proposals.create', { input: { ...scope, workflowInstanceId: job.workflowInstanceId, stepId: EVALUATION_REVIEW_STEP, agentId: EVALUATION_REVIEW_AGENT, runId: run.id, payload: envelope, confidence: null, guardResults: verdict.checks }, ctx })
    const stored = await findOneWithDecryption(em.fork(), AgentProposal, { id: created.result.proposalId, ...scope, deletedAt: null }, {}, scope)
    if (!stored) throw new Error('[internal] Evaluation review proposal unavailable')
    proposal = stored
  }
  if (proposal.workflowInstanceId !== binding.workflowInstanceId || proposal.stepId !== binding.stepId || proposal.agentId !== binding.agentId || proposal.disposition !== 'pending') throw new Error('[internal] Evaluation review proposal mismatch')
  const guard = await findOneWithDecryption(em.fork(), AgentGuardrailCheck, { ...scope, agentRunId: run.id, proposalId: proposal.id, phase: 'output' }, {}, scope)
  if (!guard) await persistVerdict({ em: em.fork() }, { ...scope, agentRunId: run.id }, { verdict, capability: EVALUATION_REVIEW_AGENT, phase: 'output', proposalId: proposal.id })
  const output = { proposalId: proposal.id, scoreRef: payload.scoreRef }
  if (!run.completedAt) {
    const endedAt = new Date()
    await bus.execute('agent_orchestrator.trace.ingest', { input: { ...scope, payload: {
      runtime: 'external', externalRunId, agentId: EVALUATION_REVIEW_AGENT, status: 'ok', workflowInstanceId: job.workflowInstanceId, stepId: EVALUATION_REVIEW_STEP, proposalId: proposal.id, output,
      spans: [{ externalSpanId: `${job.operationId}:publication`, sequence: 0, name: 'photographers.evaluation.publish_flagged_score', kind: 'system', startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: endedAt.getTime() - startedAt.getTime(), status: 'ok', attributes: { source: 'deterministic_rules', scoreRef: payload.scoreRef, factsRef: payload.factsRef } }],
    } }, ctx })
    await bus.execute('agent_orchestrator.runs.complete', { input: { runId: run.id, status: 'ok', resultKind: 'proposal', output }, ctx })
  } else if (run.status !== 'ok' || run.resultKind !== 'proposal' || reviewDigest(run.output) !== reviewDigest(output)) throw new Error('[internal] Evaluation review completion mismatch')
  const tasks = await findWithDecryption(em.fork(), UserTask, { ...scope, workflowInstanceId: job.workflowInstanceId, stepInstanceId: attemptId, branchInstanceId: null }, { limit: 2 }, scope)
  if (tasks.length > 1 || (proposal.userTaskId && (tasks.length !== 1 || tasks[0].id !== proposal.userTaskId || tasks[0].formSchema?.proposalId !== proposal.id))) throw new Error('[internal] Evaluation review task correlation mismatch')
  if (!proposal.userTaskId && tasks.length) throw new Error('[internal] Evaluation review task link requires recovery')
  if (!proposal.userTaskId) {
    const outcome = await container.resolve<DispositionService>('dispositionService').dispose(proposal, { alwaysAsk: true }, { ...scope, userId: job.userId, workflowInstanceId: job.workflowInstanceId, stepId: EVALUATION_REVIEW_STEP, review: { assignedTo: job.userId } })
    if (outcome.kind !== 'user_task' || outcome.userTaskId.startsWith('pending:')) throw new Error('[internal] Evaluation review task unavailable')
    const linked = await findOneWithDecryption(em.fork(), AgentProposal, { id: proposal.id, ...scope }, {}, scope)
    if (linked?.userTaskId !== outcome.userTaskId) throw new Error('[internal] Evaluation review task link unavailable')
  }
  return { status: 'awaiting_review' as const, runId: run.id, proposalId: proposal.id }
}
