import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { apifyResearchPayloadSchema } from '../data/apify-research-validators'
import { readEvaluationMaterial } from './material-store'

export async function readApifyResearchResult(researchRef: string, ctx: CommandRuntimeContext) {
  z.string().uuid().parse(researchRef)
  const manifest = await readEvaluationMaterial(researchRef, ctx)
  if (manifest.kind !== 'apify_research') throw new Error('[internal] Expected Apify research material')
  if (manifest.data.state !== 'finished') return { ...manifest, payload: null }
  const content: string[] = []
  for (const [index, ref] of manifest.data.payloadRefs.entries()) {
    const part = await readEvaluationMaterial(ref, ctx)
    if (part.kind !== 'apify_research_part' || part.data.index !== index || part.data.invocationId !== manifest.data.invocationId
      || part.evaluationId !== manifest.evaluationId || part.photographerId !== manifest.photographerId
      || part.personId !== manifest.personId || part.dealId !== manifest.dealId || part.registrationId !== manifest.registrationId) {
      throw new Error('[internal] Apify research part binding mismatch')
    }
    content.push(part.data.content)
  }
  return { ...manifest, payload: apifyResearchPayloadSchema.parse(JSON.parse(content.join(''))) }
}
