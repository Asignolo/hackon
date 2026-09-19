import { createHash } from 'node:crypto'
import { MAX_SNAPSHOT_BYTES } from '../data/evaluation-validators'

export const MAX_MATERIAL_BYTES = MAX_SNAPSHOT_BYTES

export function materialOperationId(operationId: string, part: string): string {
  const digest = createHash('sha256').update(`photographers:material:${operationId}:${part}`).digest()
  digest[6] = (digest[6] & 0x0f) | 0x80
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function encodeMaterialSnapshot(data: unknown) {
  const body = JSON.stringify(data)
  if (body === undefined) throw new Error('[internal] Material must be JSON serializable')
  const bytes = Buffer.from(body, 'utf8')
  if (bytes.length > MAX_MATERIAL_BYTES) throw new Error('[internal] Material exceeds byte limit')
  return { body, byteLength: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') }
}

export function decodeMaterialSnapshot(input: { body: string; byteLength: number; checksum: string }): unknown {
  const bytes = Buffer.from(input.body, 'utf8')
  if (bytes.length > MAX_MATERIAL_BYTES || bytes.length !== input.byteLength || createHash('sha256').update(bytes).digest('hex') !== input.checksum) {
    throw new Error('[internal] Material integrity check failed')
  }
  return JSON.parse(input.body) as unknown
}
