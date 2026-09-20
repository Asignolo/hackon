import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { PhotographerRawData, PhotographerEvaluationMaterial } from '../data/entities'
import { assessmentViewFeatures } from '../lib/assessment-read'
import { readPersonAssessment } from '../lib/person-assessment-read'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {} }))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({ WorkflowInstance: class WorkflowInstance {} }))
jest.mock('../lib/assessment-read', () => ({ assessmentViewFeatures: ['photographers.view', 'photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.pipelines.view', 'customers.interactions.view', 'workflows.instances.view'] }))

const personId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const evaluationId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'
const scope = { tenantId: personId, organizationId: registrationId }
const binding = { evaluationId, registrationId }
const permission = jest.fn()
let registrations: Array<{ id: string }>
let workflows: Array<{ context: Record<string, unknown> }>
let materials: Array<{ evaluationId: string; registrationId: string }>

function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({ em: asValue({ fork: () => ({}) }), rbacService: asValue({ userHasAllFeatures: permission }) })
  return { container, auth: { sub: personId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
}

beforeEach(() => {
  jest.clearAllMocks()
  permission.mockResolvedValue(true)
  registrations = [{ id: registrationId }]
  workflows = []
  materials = []
  jest.mocked(findOneWithDecryption).mockResolvedValue({ id: personId } as never)
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity, filter, options, encryptionScope) => {
    expect(filter).toEqual(expect.objectContaining(scope))
    expect(encryptionScope).toEqual(scope)
    if (entity === PhotographerRawData) {
      expect(filter).toEqual(expect.objectContaining({ customerEntityId: personId, deletedAt: null, isActive: true }))
      return registrations as never
    }
    expect(options).toEqual(expect.objectContaining({ orderBy: { createdAt: 'desc', id: 'desc' } }))
    if (entity === WorkflowInstance) return workflows as never
    expect(entity).toBe(PhotographerEvaluationMaterial)
    expect(filter).toEqual(expect.objectContaining({ photographerId: personId, registrationId: { $in: registrations.map((registration) => registration.id) } }))
    return materials as never
  })
})

test.each(['direct', 'demo', 'o1Preparation'])('finds %s saved workflow binding without requiring completion', async (shape) => {
  workflows = [{ context: shape === 'direct' ? binding : shape === 'demo' ? { demo: binding } : { o1Preparation: { result: binding } } }]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: binding })
  expect(permission).toHaveBeenCalledWith(personId, assessmentViewFeatures, scope)
  expect(findOneWithDecryption).toHaveBeenCalledWith(expect.anything(), CustomerEntity, { id: personId, kind: 'person', ...scope, deletedAt: null, isActive: true }, { fields: ['id'] }, scope)
})

test('chooses newest workflow across all linked registrations', async () => {
  registrations.push({ id: otherId })
  workflows = [{ context: { ...binding, registrationId: otherId } }, { context: binding }]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: { ...binding, registrationId: otherId } })
  expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), WorkflowInstance, expect.objectContaining({ $or: [
    { context: { registrationId: { $in: [registrationId, otherId] } } },
    { context: { demo: { registrationId: { $in: [registrationId, otherId] } } } },
    { context: { o1Preparation: { result: { registrationId: { $in: [registrationId, otherId] } } } } },
  ] }), expect.anything(), scope)
})

test('does not combine IDs from different context objects or use invalid identifiers', async () => {
  workflows = [{ context: { registrationId, demo: { evaluationId } } }, { context: { registrationId, evaluationId: 'invalid' } }]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: null })
})

test('rejects unrelated and conflicting registration bindings', async () => {
  workflows = [{ context: { evaluationId, registrationId: otherId } }, { context: { ...binding, demo: { ...binding, registrationId: otherId } } }]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: null })
})

test('falls back to scoped saved materials when no workflow exists', async () => {
  materials = [binding]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: binding })
})

test('does not return material rebound to an unrelated registration', async () => {
  materials = [{ evaluationId, registrationId: otherId }]
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: null })
})

test('returns empty for a linked person without assessments', async () => {
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: null })
})

test('returns empty without workflow reads when no registration is linked', async () => {
  registrations = []
  expect(await readPersonAssessment({ personId }, context())).toEqual({ assessment: null })
  expect(findWithDecryption).toHaveBeenCalledTimes(1)
})

test('missing, deleted, inactive or out-of-scope person is not found', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  await expect(readPersonAssessment({ personId }, context())).rejects.toMatchObject({ status: 404 })
  expect(findWithDecryption).not.toHaveBeenCalled()
})

test('rejects missing authorization before reading data', async () => {
  permission.mockResolvedValue(false)
  await expect(readPersonAssessment({ personId }, context())).rejects.toMatchObject({ status: 403 })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

test('rejects disallowed organization before reading data', async () => {
  const ctx = context()
  ctx.organizationIds = []
  await expect(readPersonAssessment({ personId }, ctx)).rejects.toMatchObject({ status: 403 })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

test('rejects anonymous readers', async () => {
  const ctx = context()
  ctx.auth = null
  await expect(readPersonAssessment({ personId }, ctx)).rejects.toMatchObject({ status: 401 })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})
