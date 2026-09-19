import { existsSync } from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/core'
import { createWorkflowDefinitionInputCheckedSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { interpolateVariables } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { startWorkflow } from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import definition from '../workflow-definitions/hidden-potential.v1.json'

function getO1Step() {
  const parsed = createWorkflowDefinitionInputCheckedSchema.parse(definition)
  const step = parsed.definition.steps.find((candidate) => candidate.stepId === 'o1')
  if (!step) throw new Error('[internal] O1 step is missing')
  return step
}

test('O1 hands only its run reference to the material adapter before identity', () => {
  const route = definition.definition.transitions.find((transition) => transition.fromStepId === 'o1' && transition.toStepId === 'identity')
  expect(route?.activities).toEqual([{
    activityId: 'store_o1_result', activityName: 'o1Result', activityType: 'EXECUTE_FUNCTION', async: false,
    config: { functionName: 'photographers.o1.store_result', args: { runId: '{{context.o1RunId}}' } },
  }])
})

test('the inactive authored graph is accepted by the existing API schema', () => {
  expect(createWorkflowDefinitionInputCheckedSchema.safeParse(definition).success).toBe(true)
  expect(definition.enabled).toBe(false)
  expect(definition.definition.triggers).toEqual([])
  expect(definition.definition.transitions.filter((route) => route.trigger === 'auto').map((route) => route.fromStepId)).toEqual(['start', 'prepare', 'o1', 'fork', 'fork', 'fork', 'score'])
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

test('O1 waits for a durable reference and does not map private research into workflow context', () => {
  const step = getO1Step()
  expect(step.stepType).toBe('WAIT_FOR_SIGNAL')
  expect(step.signalConfig).toEqual({ signalName: 'photographers.o1.ready' })
  expect(step.activities ?? []).toHaveLength(0)
  const transition = definition.definition.transitions.find((route) => route.fromStepId === 'o1')
  const config = interpolateVariables(transition?.activities?.[0].config, { o1RunId: '00000000-0000-4000-8000-000000000003' })
  expect(config).toEqual({ functionName: 'photographers.o1.store_result', args: { runId: '00000000-0000-4000-8000-000000000003' } })
})

test('discovery has only O1 and no remaining O2 routes or agent definition', () => {
  expect(definition.definition.steps.map((step) => step.stepId)).not.toContain('o2')
  expect(definition.definition.transitions.some((route) => route.fromStepId === 'o2' || route.toStepId === 'o2')).toBe(false)
  expect(existsSync(path.join(__dirname, '../agents/trace_finder/AGENT.md'))).toBe(false)
})
