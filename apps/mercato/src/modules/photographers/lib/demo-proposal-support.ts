import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CustomerDeal, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import type { DemoAgentInput } from '../data/demo-proposal-validators'
import { requireDemoInstallation } from './demo-installation'
import { observeDemoCrmWrite, type DemoWriteExpectation } from './demo-proposal-write'
import { reviewError } from './proposal-review-materials'

export function demoCommandContext(input: Pick<DemoAgentInput, 'tenantId' | 'organizationId'> & { prepared: { userId: string } }, container: AwilixContainer): CommandRuntimeContext {
  return { container, auth: { sub: input.prepared.userId, tenantId: input.tenantId, orgId: input.organizationId }, selectedOrganizationId: input.organizationId, organizationIds: [input.organizationId], organizationScope: null }
}

export async function authorizeDemoCommand(ctx: CommandRuntimeContext) {
  if (!ctx.auth?.sub || !ctx.auth.tenantId || !ctx.selectedOrganizationId) return reviewError(403, 'forbidden')
  const scope = { tenantId: ctx.auth.tenantId, organizationId: ctx.selectedOrganizationId }
  const features = ['photographers.evaluations.run', 'photographers.evaluations.manage', 'customers.people.view', 'customers.deals.view', 'customers.deals.manage', 'customers.pipelines.view', 'customers.interactions.view', 'customers.interactions.manage']
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, features, scope)) return reviewError(403, 'forbidden')
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

export { withDemoOperationLock } from './demo-operation-lock'

export async function loadDemoOwners(input: Pick<DemoAgentInput, 'tenantId' | 'organizationId' | 'prepared'>, container: AwilixContainer) {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const em = container.resolve<EntityManager>('em').fork()
  const [person, deal] = await Promise.all([
    findOneWithDecryption(em, CustomerEntity, { id: input.prepared.photographerId, kind: 'person', ...scope, deletedAt: null }, {}, scope),
    findOneWithDecryption(em, CustomerDeal, { id: input.prepared.dealId, ...scope, deletedAt: null }, {}, scope),
  ])
  if (!person || !deal || deal.closureOutcome || deal.status === 'won' || deal.status === 'lost') return reviewError(409, 'material_conflict')
  return { person, deal }
}

export function versionedContext(ctx: CommandRuntimeContext, updatedAt: string): CommandRuntimeContext {
  return { ...ctx, request: new Request('http://internal/photographers/demo', { method: 'POST', headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } }) }
}

export const demoInstallation = requireDemoInstallation

export async function executeDemoCrmCommand(command: 'customers.deals.update' | 'customers.interactions.create', payload: Record<string, unknown>, ctx: CommandRuntimeContext, expected: DemoWriteExpectation) {
  const scope = await authorizeDemoCommand(ctx)
  const userFeatures = await ctx.container.resolve<RbacService>('rbacService').getGrantedFeatures(ctx.auth!.sub, scope)
  const update = command === 'customers.deals.update'
  const guarded = await runRouteMutationGuards({ container: ctx.container, req: ctx.request ?? new Request('http://internal/photographers/demo', { method: update ? 'PATCH' : 'POST' }), auth: { ...scope, userId: ctx.auth!.sub, userFeatures }, input: { resourceKind: update ? 'customers:customer_deal' : 'customers:customer_interaction', resourceId: update ? String(payload.id) : null, operation: update ? 'update' : 'create', mutationPayload: payload } })
  if (!guarded.ok) throw new CrudHttpError(guarded.errorStatus, guarded.errorBody)
  if (guarded.modifiedPayload && JSON.stringify(guarded.modifiedPayload) !== JSON.stringify(payload)) return reviewError(409, 'material_conflict')
  const result = await observeDemoCrmWrite(command, payload, ctx, expected)
  await guarded.runAfterSuccess()
  return result
}

export async function setDemoStage(input: DemoAgentInput, stage: 'contact_ready' | 'contacted' | 'observed', ctx: CommandRuntimeContext, expected: { personUpdatedAt: string; dealUpdatedAt: string }) {
  const installation = await demoInstallation(ctx)
  const pipelineStageId = installation.stageIds[stage]
  if (!pipelineStageId) return reviewError(409, 'material_conflict')
  return executeDemoCrmCommand('customers.deals.update', { id: input.prepared.dealId, tenantId: input.tenantId, organizationId: input.organizationId, pipelineId: installation.pipelineId, pipelineStageId }, versionedContext(ctx, expected.dealUpdatedAt), { ...expected, photographerId: input.prepared.photographerId, dealId: input.prepared.dealId })
}
