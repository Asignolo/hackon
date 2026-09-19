import { decodeMaterialSnapshot, encodeMaterialSnapshot, MAX_MATERIAL_BYTES } from '../lib/material-codec'

describe('encrypted material storage envelopes', () => {
  it('round-trips the canonical snapshot with exact UTF-8 size and checksum verification', () => {
    const data = { body: 'Zażółć 📷\n'.repeat(2000) }
    const encoded = encodeMaterialSnapshot(data)
    expect(encoded.byteLength).toBe(Buffer.byteLength(JSON.stringify(data), 'utf8'))
    expect(decodeMaterialSnapshot(encoded)).toEqual(data)
    expect(() => decodeMaterialSnapshot({ ...encoded, body: encoded.body.replace('Zażółć', 'zmiana') })).toThrow('integrity')
    expect(() => decodeMaterialSnapshot({ ...encoded, byteLength: encoded.byteLength + 1 })).toThrow('integrity')
    expect(() => decodeMaterialSnapshot({ ...encoded, checksum: '0'.repeat(64) })).toThrow('integrity')
  })

  it('caps the canonical snapshot at 128 KiB including JSON encoding overhead', () => {
    const data = 'x'.repeat(MAX_MATERIAL_BYTES - 2)
    expect(encodeMaterialSnapshot(data).byteLength).toBe(MAX_MATERIAL_BYTES)
    expect(() => encodeMaterialSnapshot(`${data}x`)).toThrow('byte limit')
  })
})
