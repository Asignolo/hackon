import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { authorizeRegistrationCrm } from './registration-crm'

const eventSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid(), prepareCrm: z.literal(true) })

export async function prepareRegistrationFromEvent(payload: unknown, container: AwilixContainer) {
  const parsed = eventSchema.safeParse(payload)
  if (!parsed.success) return
  const { id, userId, tenantId, organizationId } = parsed.data
  const scope = { tenantId, organizationId }
  const em = container.resolve<EntityManager>('em').fork()
  const user = await findOneWithDecryption(em, User, { id: userId, tenantId, deletedAt: null }, {}, scope)
  if (!user || !user.isConfirmed) return
  const ctx: CommandRuntimeContext = { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
  try {
    await authorizeRegistrationCrm(ctx, true)
    await container.resolve<CommandBus>('commandBus').execute('photographers.registration.prepare_crm', { input: { registrationId: id }, ctx })
  } catch (error) {
    if (isCrudHttpError(error) && [400, 403, 404, 409].includes(error.status)) return
    throw error
  }
}
