import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommandBus, commandRegistry, registerCommand, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

const commandId = 'photographers.test_material_history'
const tenantId = 'd4c39a9f-552c-4390-afb6-8934917a3500'
const homeOrganizationId = 'd4c39a9f-552c-4390-afb6-8934917a3501'
const otherOrganizationId = 'd4c39a9f-552c-4390-afb6-8934917a3502'
const actorId = 'd4c39a9f-552c-4390-afb6-8934917a3503'

function context(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: createContainer(),
    auth: { sub: actorId, tenantId, orgId: homeOrganizationId },
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    ...overrides,
  }
}

describe('material history platform contracts', () => {
  afterEach(() => {
    commandRegistry.clear()
    registerCommandInterceptors([])
  })

  it('does not preserve all-organization selection in the execute interceptor context', async () => {
    const captured: CommandInterceptorContext[] = []
    registerCommand({ id: commandId, execute: async () => ({ ok: true }) })
    registerCommandInterceptors([{ moduleId: 'photographers', interceptors: [{
      id: 'photographers.history_contract_probe',
      targetCommand: commandId,
      beforeExecute: async (_input, ctx) => { captured.push(ctx) },
    }] }])
    const ctx = context({
      organizationIds: [homeOrganizationId, otherOrganizationId],
      organizationScope: {
        tenantId,
        selectedId: null,
        allowedIds: [homeOrganizationId, otherOrganizationId],
        filterIds: [homeOrganizationId, otherOrganizationId],
      },
    })

    await new CommandBus().execute(commandId, { input: { id: otherOrganizationId }, ctx })

    expect(captured[0]).toEqual({ commandId, container: ctx.container, auth: ctx.auth, selectedOrganizationId: homeOrganizationId })
    expect(captured[0]).not.toHaveProperty('organizationScope')
    expect(captured[0]).not.toHaveProperty('organizationIds')
  })

  it('does not expose the trusted system actor or tenant scope to execute interceptors', async () => {
    const captured: CommandInterceptorContext[] = []
    registerCommand({ id: commandId, execute: async () => ({ ok: true }) })
    registerCommandInterceptors([{ moduleId: 'photographers', interceptors: [{
      id: 'photographers.history_contract_probe',
      targetCommand: commandId,
      beforeExecute: async (_input, ctx) => { captured.push(ctx) },
    }] }])
    const ctx = context({
      auth: null,
      systemActor: true,
      organizationScope: { tenantId, selectedId: null, allowedIds: null, filterIds: null },
    })

    await new CommandBus().execute(commandId, { input: { id: otherOrganizationId }, ctx })

    expect(captured[0]).toEqual({ commandId, container: ctx.container, auth: null, selectedOrganizationId: null })
    expect(captured[0]).not.toHaveProperty('systemActor')
    expect(captured[0]).not.toHaveProperty('organizationScope')
  })

  it('allows a completed command without an audit service, so durable material storage must require one explicitly', async () => {
    const execute = jest.fn(async () => ({ id: otherOrganizationId }))
    registerCommand({
      id: commandId,
      execute,
      captureAfter: async () => ({ immutableContent: 'reviewed synthetic material' }),
      buildLog: async () => ({ resourceKind: 'photographers:evaluation_material', resourceId: otherOrganizationId }),
    })

    const result = await new CommandBus().execute(commandId, { input: {}, ctx: context() })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.logEntry).toBeNull()
    expect(result.result).toEqual({ id: otherOrganizationId })
  })

  it('persists audit metadata after command effects and propagates persistence failure', async () => {
    const operations: string[] = []
    registerCommand({
      id: commandId,
      execute: async () => { operations.push('effect committed'); return { id: otherOrganizationId } },
      buildLog: async () => ({ resourceKind: 'photographers:evaluation_material', resourceId: otherOrganizationId }),
    })
    const ctx = context()
    ctx.container.register({ actionLogService: asValue({ log: async () => { operations.push('audit failed'); throw new Error('[internal] Synthetic audit failure') } }) })

    await expect(new CommandBus().execute(commandId, { input: {}, ctx })).rejects.toThrow('[internal] Synthetic audit failure')
    expect(operations).toEqual(['effect committed', 'audit failed'])
  })

  it('preserves original action snapshots when marking a command undone and redone', async () => {
    const originalSnapshot = { interaction: { id: otherOrganizationId, body: 'synthetic original material' } }
    const originalPayload = { undo: { after: originalSnapshot } }
    const log = Object.assign(new ActionLog(), {
      id: actorId,
      tenantId,
      organizationId: homeOrganizationId,
      snapshotAfter: structuredClone(originalSnapshot),
      commandPayload: structuredClone(originalPayload),
      undoToken: 'synthetic-undo-token',
    })
    const em = {
      fork: () => em,
      findOne: jest.fn(async () => log),
      flush: jest.fn(async () => undefined),
    }
    const service = new ActionLogService(em as unknown as EntityManager)

    await service.markUndone(log.id)
    expect(log.executionState).toBe('undone')
    expect(log.undoToken).toBeNull()
    expect(log.snapshotAfter).toEqual(originalSnapshot)
    expect(log.commandPayload).toEqual(originalPayload)

    await service.markRedone(log.id)
    expect(log.executionState).toBe('redone')
    expect(log.snapshotAfter).toEqual(originalSnapshot)
    expect(log.commandPayload).toEqual(originalPayload)
  })
})
