import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { reviewDigest, reviewError } from './proposal-review-materials'
import type { DemoAgentInput } from '../data/demo-proposal-validators'

export async function ensureDemoRun(input: DemoAgentInput, agentId: string, ctx: CommandRuntimeContext) {
  const { AgentRun } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const externalRunId = `${agentId}:${input.invocationId}`
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const previous = await findOneWithDecryption(em, AgentRun, { ...scope, runtime: 'external', externalRunId, deletedAt: null }, {}, scope)
  if (previous) {
    if (previous.workflowInstanceId !== input.workflowInstanceId || previous.stepId !== input.stepId || previous.invocationId !== input.invocationId) throw new Error('[internal] Demo run correlation mismatch')
    return previous.id
  }
  const result = await ctx.container.resolve<CommandBus>('commandBus').execute<unknown, { runId: string }>('agent_orchestrator.runs.create', {
    input: { ...scope, agentId, runtime: 'external', externalRunId, workflowInstanceId: input.workflowInstanceId, stepId: input.stepId, invocationId: input.invocationId, agentType: agentId === 'photographers.message_review' ? 'action' : 'researcher', input: { evaluationId: input.prepared.evaluationId, registrationId: input.prepared.registrationId, source: 'demo_fixture' } }, ctx,
  })
  return result.result.runId
}

export async function completeDemoRun(input: DemoAgentInput, agentId: string, runId: string, resultKind: 'research' | 'proposal', output: Record<string, unknown>, ctx: CommandRuntimeContext) {
  const { AgentRun } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const run = await findOneWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), AgentRun, { id: runId, ...scope, agentId, runtime: 'external', externalRunId: `${agentId}:${input.invocationId}`, invocationId: input.invocationId, workflowInstanceId: input.workflowInstanceId }, {}, scope)
  if (!run) return reviewError(409, 'material_conflict')
  if (run.completedAt && run.resultKind === resultKind) {
    if (run.status !== 'ok' || reviewDigest(run.output) !== reviewDigest(output)) return reviewError(409, 'material_conflict')
    return
  }
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  await bus.execute('agent_orchestrator.trace.ingest', {
    input: { tenantId: input.tenantId, organizationId: input.organizationId, payload: {
      runtime: 'external', externalRunId: `${agentId}:${input.invocationId}`, agentId,
      status: 'ok', workflowInstanceId: input.workflowInstanceId, stepId: input.stepId,
      ...(typeof output.proposalId === 'string' ? { proposalId: output.proposalId } : {}),
      output, spans: [{ externalSpanId: `${input.invocationId}:demo`, sequence: 0, name: 'photographers.demo.fixture', kind: 'system', startedAt: input.prepared.evaluatedAt, endedAt: input.prepared.evaluatedAt, durationMs: 0, status: 'ok', attributes: { source: 'demo_fixture', invocationId: input.invocationId } }],
    } }, ctx,
  })
  await bus.execute('agent_orchestrator.runs.complete', { input: { runId, status: 'ok', resultKind, output }, ctx })
}
