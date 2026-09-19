import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'

export async function prepareProposalReviewFixture(scope: { tenantId: string; organizationId: string; userId: string }) {
  const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT ?? 'apps/mercato')
  const targetRequire = createRequire(path.join(appRoot, 'package.json'))
  const { bootstrapFromAppRoot } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  const { createRequestContainer } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
  await bootstrapFromAppRoot(appRoot)
  const container = await createRequestContainer()
  const bus = container.resolve<CommandBus>('commandBus')
  const em = container.resolve<EntityManager>('em').fork()
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId, isSuperAdmin: true },
    selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null,
  }
  const ownedIds: string[] = []
  let proposalId: string | null = null
  let runId: string | null = null
  let photographerId: string | null = null
  let dealId: string | null = null
  const materialIds: string[] = []
  async function cleanup() {
    const connection = em.getConnection()
    if (proposalId) {
      const accesses = await container.resolve<AccessLogService>('accessLogService').list({ ...scope, actorUserId: scope.userId, resourceKind: 'photographers.proposal_material', pageSize: 100 })
      for (const access of accesses.items.filter((entry) => entry.resourceId === proposalId)) await connection.execute('delete from access_logs where id = ? and tenant_id = ? and organization_id = ?', [access.id, scope.tenantId, scope.organizationId])
      await connection.execute('delete from agent_eval_cases where tenant_id = ? and organization_id = ? and source_id in (select id from agent_corrections where proposal_id = ?)', [scope.tenantId, scope.organizationId, proposalId])
      await connection.execute('delete from agent_corrections where proposal_id = ? and tenant_id = ? and organization_id = ?', [proposalId, scope.tenantId, scope.organizationId])
      await connection.execute('delete from agent_proposals where id = ? and tenant_id = ? and organization_id = ?', [proposalId, scope.tenantId, scope.organizationId])
      await connection.execute('delete from notifications where source_entity_id = ? and tenant_id = ? and organization_id = ?', [proposalId, scope.tenantId, scope.organizationId])
    }
    if (runId) await connection.execute('delete from agent_runs where id = ? and tenant_id = ? and organization_id = ?', [runId, scope.tenantId, scope.organizationId])
    for (const id of materialIds) await connection.execute('delete from photographers_evaluation_materials where id = ? and tenant_id = ? and organization_id = ?', [id, scope.tenantId, scope.organizationId])
    if (dealId) await bus.execute('customers.deals.delete', { input: { body: { id: dealId } }, ctx })
    if (photographerId) await bus.execute('customers.people.delete', { input: { body: { id: photographerId } }, ctx })
    for (const id of ownedIds) await connection.execute('delete from action_logs where resource_id = ? and tenant_id = ? and organization_id = ?', [id, scope.tenantId, scope.organizationId])
    await container.dispose()
  }
  try {
    const person = await bus.execute<Record<string, unknown>, { entityId: string; personId: string }>('customers.people.create', { input: { ...scope, firstName: 'Review', lastName: 'Fixture', displayName: `Review fixture ${randomUUID()}` }, ctx })
    photographerId = person.result.entityId
    ownedIds.push(photographerId)
    const deal = await bus.execute<Record<string, unknown>, { dealId: string }>('customers.deals.create', { input: { ...scope, title: `Review proof ${randomUUID()}`, personIds: [photographerId] }, ctx })
    dealId = deal.result.dealId
    ownedIds.push(dealId)
    const evaluationId = randomUUID()
    const createdAt = new Date().toISOString()
    const owners = { photographerId, personId: person.result.personId, dealId }
    async function store(material: unknown) {
      const result = await bus.execute<unknown, { id: string }>('photographers.evaluation.store_material', { input: { operationId: randomUUID(), snapshot: { ...owners, material } }, ctx })
      materialIds.push(result.result.id)
      ownedIds.push(result.result.id)
      return result.result.id
    }
    const traceId = randomUUID()
    const sourceRef = 'https://example.invalid/synthetic-portfolio'
    const tracesRef = await store({ kind: 'traces', data: { schemaVersion: 1, evaluationId, evaluatedAt: createdAt, discoveryStatus: 'complete', traces: [{ schemaVersion: 1, id: traceId, kind: 'website', value: sourceRef, status: 'confirmed', provenance: [{ value: sourceRef, sourceRef, observedAt: createdAt }], observedAt: createdAt, candidateIds: [] }] } })
    const factsRef = await store({ kind: 'facts', data: { schemaVersion: 1, evaluationId, evaluatedAt: createdAt, tracesRef, facts: [{ schemaVersion: 1, key: 'ownDomain', value: true, state: 'known', owner: 'portfolio', traceId, sourceRef, observedAt: createdAt, readStatus: 'ok' }] } })
    const body = 'Synthetic review message.\nEvery line must be visible in Caseload.\nThis proof does not send a message.'
    const messageSnapshotId = await store({ kind: 'message', data: { schemaVersion: 1, evaluationId, recipientSource: 'registration', body, allowedEvidenceRefs: [traceId], internalRationale: 'Synthetic reasoning for a browser proof.', createdAt, factsRef } })
    const versions = await em.getConnection().execute<Array<{ person_updated_at: Date; deal_updated_at: Date }>>('select person.updated_at as person_updated_at, deal.updated_at as deal_updated_at from customer_entities person cross join customer_deals deal where person.id = ? and deal.id = ? and person.tenant_id = ? and person.organization_id = ? and deal.tenant_id = ? and deal.organization_id = ?', [photographerId, dealId, scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId])
    const expectedVersions = { personUpdatedAt: new Date(versions[0].person_updated_at).toISOString(), dealUpdatedAt: new Date(versions[0].deal_updated_at).toISOString(), factsRef }
    const run = await bus.execute<Record<string, unknown>, { runId: string }>('agent_orchestrator.runs.create', { input: { ...scope, agentId: 'photographers.message_review', input: { evaluationId } }, ctx })
    runId = run.result.runId
    const proposal = await bus.execute<Record<string, unknown>, { proposalId: string }>('agent_orchestrator.proposals.create', { input: { ...scope, agentId: 'photographers.message_review', runId, payload: { options: [{ id: 'accept', label: 'Synthetic message option', actions: [{ type: 'photographers.message.accept', payload: { ...owners, evaluationId, factsRef, messageSnapshotId, expectedVersions } }] }] } }, ctx })
    proposalId = proposal.result.proposalId
    ownedIds.push(proposalId, runId)
    const versionsRows = await em.getConnection().execute<Array<{ updated_at: Date }>>('select updated_at from agent_proposals where id = ? and tenant_id = ? and organization_id = ?', [proposalId, scope.tenantId, scope.organizationId])
    async function accessEvidence() {
      const records = await container.resolve<AccessLogService>('accessLogService').list({ ...scope, actorUserId: scope.userId, resourceKind: 'photographers.proposal_material', pageSize: 100 })
      return records.items.filter((entry) => entry.resourceId === proposalId)
    }
    return { proposalId, body, sourceRef, updatedAt: new Date(versionsRows[0].updated_at).toISOString(), accessEvidence, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
