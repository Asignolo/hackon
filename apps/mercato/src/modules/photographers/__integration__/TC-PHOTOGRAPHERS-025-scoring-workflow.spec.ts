import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { asValue } from 'awilix'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { DEFAULT_HIDDEN_POTENTIAL_RULES } from '../lib/rules-config'
import { materialResponseSchema } from '../data/material-validators'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows'] }
const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const targetRequire = createRequire(path.join(appRoot, 'package.json'))
const skeleton: typeof import('../workflow-definitions/hidden-potential.v1.json') = targetRequire('./src/modules/photographers/workflow-definitions/hidden-potential.v1.json')

test.describe('TC-PHOTOGRAPHERS-025: native scoring step', () => {
  for (const scenario of ['qualified', 'flagged', 'unconfirmed'] as const) {
    test(`scores only confirmed facts through the authored workflow: ${scenario}`, async ({ request }) => {
      const { bootstrapFromAppRoot } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const { createRequestContainer } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
      await bootstrapFromAppRoot(appRoot)
      const fixture = await registrationCrmFixture(request, ['workflows.*'])
      const container = await createRequestContainer()
      try {
        const admin = await getAuthToken(request, 'superadmin')
        const encryption = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: admin, selectedOrgId: fixture.organizationId, data: { entityId: 'photographers:photographer_evaluation_material', fields: [{ field: 'body' }], isActive: true } })
        expect(encryption.status(), await encryption.text()).toBe(200)
        const registration = await apiRequest(request, 'POST', '/api/photographers/raw-data', { token: fixture.token, data: { firstName: 'Scoring', lastName: 'Fixture', email: `score-${randomUUID()}@example.invalid`, portfolioRaw: 'brak' } })
        expect(registration.status(), await registration.text()).toBe(201)
        const registrationId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(registration)).id
        const crm = await apiRequest(request, 'POST', `/api/photographers/registrations/${registrationId}/crm`, { token: fixture.token, data: {} })
        expect(crm.status(), await crm.text()).toBe(200)
        const owners = z.object({ photographerId: z.string().uuid(), personId: z.string().uuid(), dealId: z.string().uuid() }).parse(await readJsonSafe(crm))
        const evaluationId = randomUUID()
        const evaluatedAt = '2026-09-19T12:00:00Z'
        const sourceRef = `https://example.invalid/registry/${randomUUID()}`
        const traceId = randomUUID()
        const commandBus = container.resolve<CommandBus>('commandBus')
        const ctx: CommandRuntimeContext = { container, auth: { sub: fixture.userId, tenantId: fixture.tenantId, orgId: fixture.organizationId }, selectedOrganizationId: fixture.organizationId, organizationIds: [fixture.organizationId], organizationScope: null }
        const store = async (material: unknown) => {
          const saved = await commandBus.execute<unknown, { id: string }>('photographers.evaluation.store_material', { input: { operationId: randomUUID(), snapshot: { ...owners, registrationId, material } }, ctx })
          return saved.result.id
        }
        const tracesRef = await store({ kind: 'traces', data: { schemaVersion: 1, evaluationId, evaluatedAt, discoveryStatus: 'complete', traces: [{ schemaVersion: 1, id: traceId, kind: 'registry', value: sourceRef, status: scenario === 'unconfirmed' ? 'unconfirmed' : 'confirmed', provenance: [{ value: 'Owned test evidence', sourceRef, observedAt: evaluatedAt }], observedAt: evaluatedAt, candidateIds: [] }] } })
        const factsRef = await store({ kind: 'facts', data: { schemaVersion: 1, evaluationId, evaluatedAt, tracesRef, facts: [
          { key: 'nipConfirmed', value: true }, { key: 'businessStartedAt', value: '2020-01-01T00:00:00Z' },
          { key: 'vatStatus', value: 'active' }, { key: 'photographicPkd', value: true },
          { key: 'businessStatus', value: scenario === 'flagged' ? 'suspended' : 'active' },
        ].map((fact) => ({ ...fact, schemaVersion: 1, state: 'known', traceId, sourceRef, observedAt: evaluatedAt, readStatus: 'ok', owner: 'registry' })) } })
        const scoreRoute = skeleton.definition.transitions.find((route) => route.transitionId === 'score_disposition_18')
        if (!scoreRoute) throw new Error('[internal] Missing scoring transition')
        const definition = { ...skeleton, enabled: true, version: Math.floor(Date.now() / 1000), workflowName: 'QA scoring slice', definition: { ...skeleton.definition,
          steps: skeleton.definition.steps.filter((step) => ['start', 'score', 'disposition'].includes(step.stepId)).map((step) => step.stepId === 'disposition' ? { ...step, stepType: 'END' } : step),
          transitions: [{ transitionId: 'start_score_test', fromStepId: 'start', toStepId: 'score', trigger: 'auto' }, scoreRoute],
        } }
        const { createWorkflowDefinitionInputCheckedSchema } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/core/modules/workflows/data/validators')).href) as typeof import('@open-mercato/core/modules/workflows/data/validators')
        createWorkflowDefinitionInputCheckedSchema.parse(definition)
        await withClient(async (db) => {
          await db.query('insert into workflow_definitions (id,workflow_id,workflow_name,version,definition,enabled,tenant_id,organization_id,created_at,updated_at) values ($1,$2,$3,$4,$5::jsonb,true,$6,$7,now(),now())', [randomUUID(), definition.workflowId, definition.workflowName, definition.version, JSON.stringify(definition.definition), fixture.tenantId, fixture.organizationId])
        })
        const scoreFunctionKey = 'workflowFunction:photographers.evaluation.score'
        const scoreFunction = container.resolve<(args: unknown, context: ActivityContext) => Promise<unknown>>(scoreFunctionKey)
        let calls = 0
        container.register({ [scoreFunctionKey]: asValue(async (args: unknown, context: ActivityContext) => {
          calls += 1
          const first = await scoreFunction(args, context)
          expect(await scoreFunction(args, context)).toEqual(first)
          return first
        }) })
        const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
        const em = container.resolve<EntityManager>('em').fork()
        const instance = await executor.startWorkflow(em, { workflowId: skeleton.workflowId, version: definition.version, tenantId: fixture.tenantId, organizationId: fixture.organizationId, metadata: { initiatedBy: fixture.userId }, initialContext: { ...owners, registrationId, evaluationId, evaluatedAt, factsRef, rulesVersion: '2026-09-19.1', rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES } })
        await executor.executeWorkflow(em, container, instance.id, { userId: fixture.userId })
        expect(calls).toBe(1)
        const rows = await withClient(async (db) => (await db.query<{ id: string; body: string }>('select id,body from photographers_evaluation_materials where evaluation_id=$1 and tenant_id=$2 and organization_id=$3 and kind=$4', [evaluationId, fixture.tenantId, fixture.organizationId, 'score'])).rows)
        if (scenario === 'unconfirmed') {
          expect(rows).toHaveLength(0)
          const failed = await withClient(async (db) => (await db.query<{ status: string; current_step_id: string }>('select status,current_step_id from workflow_instances where id=$1', [instance.id])).rows[0])
          expect(failed.current_step_id).toBe('score')
          expect(failed.status).toBe('FAILED')
          return
        }
        const executionState = await withClient(async (db) => (await db.query('select status,current_step_id,error_message,error_details from workflow_instances where id=$1', [instance.id])).rows[0])
        expect(rows, JSON.stringify(executionState)).toHaveLength(1)
        expect(rows[0].body).toMatch(/:v1$/)
        expect(rows[0].body).not.toContain(sourceRef)
        const response = await apiRequest(request, 'GET', `/api/photographers/evaluation-materials/${rows[0].id}`, { token: fixture.token })
        expect(response.status(), await response.text()).toBe(200)
        const material = materialResponseSchema.parse(await readJsonSafe(response))
        expect(material).toMatchObject({ kind: 'score', ...owners, registrationId, data: { score: 60, factsRef, rulesVersion: '2026-09-19.1', suggestedAction: scenario === 'flagged' ? 'review' : 'qualify_contact', flags: scenario === 'flagged' ? ['business_suspended'] : [] } })
        if (material.kind !== 'score') throw new Error('[internal] Expected score material')
        expect(material.data.matchedRules).toHaveLength(4)
        expect(material.data.matchedRules.every((rule) => rule.sourceRef === sourceRef)).toBe(true)
        await withClient(async (db) => {
          const workflow = (await db.query<{ current_step_id: string; context: { scoreResult: { result: unknown } } }>('select current_step_id,context from workflow_instances where id=$1', [instance.id])).rows[0]
          expect(workflow.current_step_id).toBe('disposition')
          expect(workflow.context.scoreResult.result).toEqual({ scoreRef: rows[0].id, factsRef, rulesVersion: '2026-09-19.1', reviewRequired: scenario === 'flagged' })
          for (const table of ['workflow_instances', 'step_instances', 'workflow_events']) {
            const owner = table === 'workflow_instances' ? 'id' : 'workflow_instance_id'
            const state = await db.query(`select * from ${table} where ${owner}=$1 and tenant_id=$2 and organization_id=$3`, [instance.id, fixture.tenantId, fixture.organizationId])
            expect(JSON.stringify(state.rows)).not.toContain(sourceRef)
          }
          const deal = (await db.query<{ pipeline_stage_id: string }>('select pipeline_stage_id from customer_deals where id=$1', [owners.dealId])).rows[0]
          expect(deal.pipeline_stage_id).toBe(fixture.stageId)
        })
      } finally {
        await container.dispose()
        await withClient(async (db) => {
          for (const table of ['workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'workflow_definitions', 'photographers_evaluation_materials']) await db.query(`delete from ${table} where tenant_id=$1 and organization_id=$2`, [fixture.tenantId, fixture.organizationId])
        })
        await fixture.cleanup()
      }
    })
  }
})
