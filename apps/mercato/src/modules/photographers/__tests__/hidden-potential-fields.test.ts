import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { entities } from '../ce'

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({ CustomFieldDef: class CustomFieldDef {} }))

it('installs photographer field definitions twice without duplicate fields or extra writes', async () => {
  const rows: Record<string, unknown>[] = []
  const em = {
    find: jest.fn(async () => rows),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn((row: Record<string, unknown>) => { if (!rows.includes(row)) rows.push(row) }),
    flush: jest.fn(),
  }
  const sets = entities.map((entity) => ({ entity: entity.id, fields: entity.fields ?? [], source: 'photographers' }))
  const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: null }
  const first = await ensureCustomFieldDefinitions(em as unknown as EntityManager, sets, scope)
  const repeated = await ensureCustomFieldDefinitions(em as unknown as EntityManager, sets, scope)
  expect(first).toEqual({ created: 12, updated: 0, unchanged: 0 })
  expect(repeated).toEqual({ created: 0, updated: 0, unchanged: 12 })
  expect(rows).toHaveLength(12)
  expect(em.flush).toHaveBeenCalledTimes(1)
})
