import type { EntityManager } from '@mikro-orm/core'
import { createWorkflowDefinitionInputCheckedSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { invokeAgentConfigSchema } from '@open-mercato/core/modules/workflows/data/activity-config-schemas'
import { interpolateVariables } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { mapAgentResultToContext } from '@open-mercato/core/modules/workflows/lib/agent-result-mapping'
import { startWorkflow } from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import definition from '../workflow-definitions/hidden-potential.v1.json'

function getO1Step() {
  const parsed = createWorkflowDefinitionInputCheckedSchema.parse(definition)
  const step = parsed.definition.steps.find((candidate) => candidate.stepId === 'o1')
  if (!step) throw new Error('[internal] O1 step is missing')
  return step
}

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

test('only O1 is wired and its four input values use the real workflow interpolation', () => {
  const parsed = createWorkflowDefinitionInputCheckedSchema.parse(definition)
  expect(parsed.definition.steps.filter((step) => step.activities?.length).map((step) => step.stepId)).toEqual(['o1'])
  expect(parsed.definition.contextSchema).toBeUndefined()
  const step = getO1Step()
  expect(step.stepType).toBe('AUTOMATED')
  expect(step.signalConfig).toEqual({ signalName: 'agent_orchestrator.proposal.ready' })
  expect(step.activities).toHaveLength(1)
  const activity = step.activities?.[0]
  expect(activity?.activityType).toBe('INVOKE_AGENT')
  expect(activity?.async).not.toBe(true)
  const input = {
    originalPortfolio: 'https://synthetic-studio.example/portfolio',
    registrationEmail: 'photographer@example.test',
    firstName: 'Alicja',
    lastName: 'Testowa',
  }
  const config = invokeAgentConfigSchema.parse(interpolateVariables(activity?.config, {
    ...input,
    registrationId: '00000000-0000-4000-8000-000000000003',
  }))
  expect(config.agentId).toBe('agent_examples.portfolio_reader_o1')
  expect(config.input).toEqual(input)
  expect(config.onResult).toEqual({ alwaysAsk: true })
  expect(config.outputMapping).toEqual({ o1: 'data' })
})

test('O1 research maps into its own context key without losing source or approval evidence', () => {
  const config = invokeAgentConfigSchema.parse(getO1Step().activities?.[0]?.config)
  const research = {
    schemaVersion: 1,
    status: 'partial',
    approvalRequired: true,
    links: [{
      type: 'website',
      originalUrl: 'https://synthetic-studio.example/',
      url: 'https://synthetic-studio.example/',
      confidence: 'probable',
      approvalRequired: true,
      sources: [{ url: 'https://synthetic-directory.example/studio', method: 'search_result', evidence: 'Syntetyczny kandydat wymagający potwierdzenia.' }],
    }],
  }
  const mapped = mapAgentResultToContext({ kind: 'research', agentId: config.agentId, data: research }, config.outputMapping)
  expect(mapped).toEqual({ o1: research })
  expect(mapped).not.toHaveProperty('proposalPayload')
  expect(mapped).not.toHaveProperty('disposition')
})
