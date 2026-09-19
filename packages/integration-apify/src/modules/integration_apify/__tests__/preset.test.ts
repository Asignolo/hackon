import { applyApifyEnvPreset, readApifyEnvPreset } from '../lib/preset'

describe('Apify environment preset', () => {
  it('is absent without a token and defaults enabled to false', () => {
    expect(readApifyEnvPreset({})).toBeNull()
    expect(readApifyEnvPreset({ OM_INTEGRATION_APIFY_API_TOKEN: 'token' })).toEqual({
      apiToken: 'token',
      enabled: false,
    })
  })

  it('rejects an invalid enabled token', () => {
    expect(() => readApifyEnvPreset({
      OM_INTEGRATION_APIFY_API_TOKEN: 'token',
      OM_INTEGRATION_APIFY_ENABLED: 'sometimes',
    })).toThrow('OM_INTEGRATION_APIFY_ENABLED')
  })

  it('stores tenant-wide credentials and state without logging the secret', async () => {
    const getRaw = jest.fn(async () => null)
    const save = jest.fn(async () => undefined)
    const upsert = jest.fn(async () => ({}))
    const info = jest.fn(async () => undefined)
    const result = await applyApifyEnvPreset({
      credentialsService: { getRaw, save } as never,
      stateService: { upsert } as never,
      integrationLogService: { scoped: () => ({ info }) } as never,
      scope: { tenantId: 'tenant-a', organizationId: 'org-a' },
      env: {
        OM_INTEGRATION_APIFY_API_TOKEN: 'secret-token',
        OM_INTEGRATION_APIFY_ENABLED: 'true',
      },
    })

    expect(result).toEqual({ status: 'configured', enabled: true })
    const scope = { tenantId: 'tenant-a', organizationId: 'org-a', userId: null }
    expect(save).toHaveBeenCalledWith('integration_apify', { apiToken: 'secret-token' }, scope)
    expect(upsert).toHaveBeenCalledWith('integration_apify', { isEnabled: true }, scope)
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret-token')
  })

  it('does not overwrite existing credentials unless forced', async () => {
    const save = jest.fn(async () => undefined)
    const result = await applyApifyEnvPreset({
      credentialsService: {
        getRaw: jest.fn(async () => ({ apiToken: 'existing' })),
        save,
      } as never,
      stateService: { upsert: jest.fn(async () => ({})) } as never,
      scope: { tenantId: 'tenant-a', organizationId: 'org-a' },
      env: { OM_INTEGRATION_APIFY_API_TOKEN: 'replacement' },
    })

    expect(result.status).toBe('skipped')
    expect(save).not.toHaveBeenCalled()
  })
})
