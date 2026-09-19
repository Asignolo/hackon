import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { demoDispositionInputSchema, demoEffectPhaseInputSchema, demoEffectResultSchema, type DemoEffectCheckpoint } from '../data/demo-proposal-validators'
import { materialOperationId } from './material-codec'
import { readEvaluationMaterial } from './material-store'
import { loadReviewProposal, readMessageReviewMaterials, reviewError } from './proposal-review-materials'
import { assertCurrentDemoDecision, loadDemoDecision } from './demo-proposal-decision'
import { assertDemoCheckpoint, readDemoCheckpoint, requireDemoEffectEncryption } from './demo-proposal-journal'
import { demoCommandContext, loadDemoOwners, executeDemoCrmCommand, setDemoStage, withDemoOperationLock } from './demo-proposal-support'

export async function executeDemoEffectPhase(rawInput: unknown, ctx: CommandRuntimeContext): Promise<DemoEffectCheckpoint> {
  const { phase, ...input } = demoEffectPhaseInputSchema.parse(rawInput)
  const decision = await loadDemoDecision(input, ctx)
  await assertCurrentDemoDecision(decision, ctx)
  const previous = await readDemoCheckpoint(decision, phase, ctx)
  if (previous) {
    await assertDemoCheckpoint(decision, previous, ctx)
    return previous
  }
  const agentInput = { ...input, prepared: decision.prepared, workflowInstanceId: decision.proposal.workflowInstanceId!, stepId: 'wait_review', invocationId: decision.run.invocationId! }
  const interactionId = materialOperationId(decision.proposal.id, 'effect-interaction')
  if (phase === 'stage') {
    const { person, deal } = await loadDemoOwners(agentInput, ctx.container)
    if (person.updatedAt.toISOString() !== decision.payload.expectedVersions.personUpdatedAt || deal.updatedAt.toISOString() !== decision.payload.expectedVersions.dealUpdatedAt || !deal.pipelineStageId || !deal.pipelineId) return reviewError(409, 'material_conflict')
    if (decision.disposition === 'approved') await readMessageReviewMaterials(decision.payload, ctx)
    await requireDemoEffectEncryption(ctx, decision.scope)
    const versions = await setDemoStage(agentInput, decision.disposition === 'approved' ? 'contacted' : 'observed', ctx, decision.payload.expectedVersions)
    const after = await loadDemoOwners(agentInput, ctx.container)
    if (after.person.updatedAt.toISOString() !== versions.personUpdatedAt || after.deal.updatedAt.toISOString() !== versions.dealUpdatedAt) return reviewError(409, 'material_conflict')
    return { proposalId: decision.proposal.id, disposition: decision.disposition, interactionId, digest: decision.digest, personUpdatedAt: after.person.updatedAt.toISOString(), dealUpdatedAt: after.deal.updatedAt.toISOString(), interactionUpdatedAt: null, beforeStageId: deal.pipelineStageId, pipelineId: deal.pipelineId }
  }
  const stage = await readDemoCheckpoint(decision, 'stage', ctx)
  if (!stage) return reviewError(409, 'material_conflict')
  await assertDemoCheckpoint(decision, stage, ctx)
  const em = ctx.container.resolve<EntityManager>('em').fork()
  if (await findOneWithDecryption(em, CustomerInteraction, { id: interactionId, ...decision.scope }, {}, decision.scope)) return reviewError(409, 'material_conflict')
  const { translate } = await resolveTranslations()
  const title = translate(`photographers.demo.audit.${decision.disposition === 'approved' ? 'accept' : 'reject'}`)
  let body = title
  if (decision.disposition === 'approved') {
    const material = await readEvaluationMaterial(decision.payload.messageSnapshotId, ctx)
    if (material.kind !== 'message' || material.evaluationId !== decision.payload.evaluationId || material.photographerId !== decision.payload.photographerId || material.personId !== decision.payload.personId || material.dealId !== decision.payload.dealId || material.data.factsRef !== decision.payload.factsRef) return reviewError(409, 'material_conflict')
    body = material.data.body
  }
  await requireDemoEffectEncryption(ctx, decision.scope)
  const versions = await executeDemoCrmCommand('customers.interactions.create', { ...decision.scope, id: interactionId, entityId: decision.prepared.photographerId, dealId: decision.prepared.dealId, interactionType: 'note', status: 'completed', title, body, occurredAt: new Date(), authorUserId: ctx.auth!.sub, source: `photographers:message:${decision.payload.messageSnapshotId}` }, ctx, { ...stage, photographerId: decision.prepared.photographerId, dealId: decision.prepared.dealId })
  const [interaction, owners] = await Promise.all([
    findOneWithDecryption(em.fork(), CustomerInteraction, { id: interactionId, ...decision.scope, deletedAt: null }, {}, decision.scope),
    loadDemoOwners(agentInput, ctx.container),
  ])
  if (!interaction || interaction.updatedAt.toISOString() !== versions.interactionUpdatedAt || owners.person.updatedAt.toISOString() !== versions.personUpdatedAt || owners.deal.updatedAt.toISOString() !== versions.dealUpdatedAt) return reviewError(409, 'material_conflict')
  return { ...stage, personUpdatedAt: owners.person.updatedAt.toISOString(), dealUpdatedAt: owners.deal.updatedAt.toISOString(), interactionUpdatedAt: interaction.updatedAt.toISOString() }
}

export async function executeDemoEffect(rawInput: unknown, ctx: CommandRuntimeContext): Promise<DemoEffectCheckpoint> {
  const input = demoDispositionInputSchema.parse(rawInput)
  return withDemoOperationLock(ctx.container, `effect:${input.tenantId}:${input.organizationId}:${input.proposalId}`, async () => {
    const decision = await loadDemoDecision(input, ctx)
    if (await readDemoCheckpoint(decision, 'revoke_stage', ctx)) return reviewError(409, 'material_conflict')
    const finished = await readDemoCheckpoint(decision, 'interaction', ctx)
    if (finished) {
      await assertDemoCheckpoint(decision, finished, ctx)
      return finished
    }
    const bus = ctx.container.resolve<CommandBus>('commandBus')
    await bus.execute('photographers.demo.message.phase', { input: { ...input, phase: 'stage' }, ctx })
    return (await bus.execute<unknown, DemoEffectCheckpoint>('photographers.demo.message.phase', { input: { ...input, phase: 'interaction' }, ctx })).result
  })
}

async function decisionContext(rawInput: unknown, container: AwilixContainer) {
  const input = demoDispositionInputSchema.parse(rawInput)
  const proposal = await loadReviewProposal(input.proposalId, input, { container })
  if (!proposal.dispositionBy) return reviewError(409, 'material_conflict')
  const ctx = demoCommandContext({ ...input, prepared: { userId: proposal.dispositionBy } }, container)
  return { input, ctx }
}

export async function resolveDemoReview(rawInput: unknown, container: AwilixContainer) {
  const { input, ctx } = await decisionContext(rawInput, container)
  const decision = await loadDemoDecision(input, ctx)
  const command = decision.disposition === 'approved' ? 'photographers.message.accept' : 'photographers.demo.message.reject'
  const result = await container.resolve<CommandBus>('commandBus').execute<unknown, DemoEffectCheckpoint>(command, { input, ctx })
  return demoEffectResultSchema.parse({ proposalId: result.result.proposalId, disposition: result.result.disposition, interactionId: result.result.interactionId })
}

export async function readDemoEffectResult(rawInput: unknown, container: AwilixContainer) {
  const { input, ctx } = await decisionContext(rawInput, container)
  const decision = await loadDemoDecision(input, ctx)
  if (await readDemoCheckpoint(decision, 'revoke_stage', ctx)) return null
  const result = await readDemoCheckpoint(decision, 'interaction', ctx)
  if (result) await assertDemoCheckpoint(decision, result, ctx)
  return result ? demoEffectResultSchema.parse({ proposalId: result.proposalId, disposition: result.disposition, interactionId: result.interactionId }) : null
}

export async function probeDemoReviewEffectStatus(rawInput: unknown, container: AwilixContainer): Promise<'ready' | 'completed' | 'conflict'> {
  const { input, ctx } = await decisionContext(rawInput, container)
  const decision = await loadDemoDecision(input, ctx)
  if (await readDemoCheckpoint(decision, 'revoke_stage', ctx)) return 'conflict'
  const finished = await readDemoCheckpoint(decision, 'interaction', ctx)
  const stage = finished ?? await readDemoCheckpoint(decision, 'stage', ctx)
  if (stage) {
    await assertDemoCheckpoint(decision, stage, ctx)
    return finished ? 'completed' : 'ready'
  }
  const owners = await loadDemoOwners({ ...input, prepared: decision.prepared }, container)
  return owners.person.updatedAt.toISOString() === decision.payload.expectedVersions.personUpdatedAt && owners.deal.updatedAt.toISOString() === decision.payload.expectedVersions.dealUpdatedAt ? 'ready' : 'conflict'
}
