import { demoWorkflowJobSchema } from '../data/demo-workflow-validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const job = { kind: 'sweep', tenantId, organizationId }

test('accepts the scheduler transport envelope and returns only demo job fields', () => {
  expect(demoWorkflowJobSchema.parse({ ...job, scope: { tenantId, organizationId }, _idempotencyKey: 'scheduler-execution-1', _jobOrigin: 'scheduler' })).toEqual(job)
  expect(demoWorkflowJobSchema.parse(job)).toEqual(job)
})

test('rejects conflicting scheduler scope and unknown domain fields', () => {
  expect(demoWorkflowJobSchema.safeParse({ ...job, scope: { tenantId: organizationId, organizationId } }).success).toBe(false)
  expect(demoWorkflowJobSchema.safeParse({ ...job, afterID: organizationId }).success).toBe(false)
  expect(demoWorkflowJobSchema.safeParse({ ...job, _jobOrigin: 'inbound-webhook' }).success).toBe(false)
})
