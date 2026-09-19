import type { EntityManager } from '@mikro-orm/core'
import { createWorkflowDefinitionInputCheckedSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { startWorkflow } from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import definition from '../workflow-definitions/hidden-potential.v1.json'

test('the inactive authored graph is accepted by the existing API schema', () => {
  expect(createWorkflowDefinitionInputCheckedSchema.safeParse(definition).success).toBe(true)
  expect(definition.enabled).toBe(false)
  expect(definition.definition.triggers).toEqual([])
  expect(definition.definition.transitions.filter((route) => route.trigger === 'auto').map((route) => route.fromStepId)).toEqual(['fork', 'fork', 'fork'])
})

test('the real executor refuses the disabled skeleton even with a pinned version, before writing anything', async () => {
  const em = {
    findOne: jest.fn().mockResolvedValue(definition),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(),
  }
  await expect(startWorkflow(em as unknown as EntityManager, {
    workflowId: definition.workflowId,
    version: definition.version,
    tenantId: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
  })).rejects.toMatchObject({ code: 'DEFINITION_DISABLED' })
  expect(em.create).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
})

test('proposal rejection and explicit closure remain distinct paths', () => {
  const routes = definition.definition.transitions
  expect(routes.filter((route) => route.toStepId === 'close').map((route) => route.fromStepId)).toEqual(['review'])
  expect(routes.filter((route) => route.fromStepId === 'rejected').map((route) => route.toStepId)).toEqual(['end'])
  expect(routes.filter((route) => route.fromStepId === 'skip').map((route) => route.toStepId)).toEqual(['end'])
  expect(routes.filter((route) => route.fromStepId === 'identity_review').map((route) => route.toStepId)).toEqual(['accepted', 'accepted'])
})
