import { createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { storeMaterialCommand } from '../commands/materials'

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

test('material command is append-only and excludes source data from redo/audit payload', async () => {
  const ctx: CommandRuntimeContext = {
    container: createContainer(), auth: { sub: 'user', tenantId: 'tenant', orgId: 'org' },
    selectedOrganizationId: 'org', organizationIds: ['org'], organizationScope: null,
  }
  const log = await storeMaterialCommand.buildLog?.({ result: { id: 'material' }, ctx, input: { secret: 'sensitive-input' }, snapshots: {} })
  expect(storeMaterialCommand.id).toBe('photographers.evaluation.store_material')
  expect(storeMaterialCommand.isUndoable).toBe(false)
  expect(log).toMatchObject({ resourceId: 'material', payload: { __redoInput: {} }, tenantId: 'tenant', organizationId: 'org' })
  expect(JSON.stringify(log)).not.toContain('sensitive-input')
})
