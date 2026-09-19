import fs from 'node:fs'
import path from 'node:path'
import { runSandboxedScript } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/sandboxedScript'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'agents', 'portfolio_reader_o1', 'tools', 'validate_nip.ts'),
  'utf8',
)

describe('O1 sandboxed NIP validation', () => {
  it.each(['1234563218', 'PL 123-456-32-18', ' pl\t123 456 32 18\n'])('normalizes a synthetic valid NIP: %s', async (originalValue) => {
    expect(await runSandboxedScript({ source, args: { value: originalValue } })).toEqual({
      ok: true,
      result: { originalValue, value: '1234563218', checksumValid: true },
    })
  })

  it.each(['1234563219', '1234567890', '0000000000', '1111111111'])('preserves a normalized candidate with invalid checksum: %s', async (value) => {
    expect(await runSandboxedScript({ source, args: { value } })).toEqual({
      ok: true,
      result: { originalValue: value, value, checksumValid: false },
    })
  })

  it.each(['', '123456321', '12345632180', 'DE1234563218', 'NIP:1234563218', '123.456.32.18', '1234563218 garbage', 'https://example.test/1234563218'])('rejects malformed strings without inventing a NIP: %s', async (originalValue) => {
    expect(await runSandboxedScript({ source, args: { value: originalValue } })).toEqual({
      ok: true,
      result: { originalValue, value: null, checksumValid: false },
    })
  })

  it.each([null, undefined, {}, [], '1234563218', { value: 1234563218 }, { value: null }])('rejects malformed tool arguments: %p', async (args) => {
    expect(await runSandboxedScript({ source, args })).toMatchObject({
      ok: false,
      code: 'script_error',
      error: expect.stringContaining('[internal] validate_nip requires an object with a string value'),
    })
  })
})
