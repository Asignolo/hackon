import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseAgentMarkdown } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/agentMarkdown'
import { compileOutcome, type JsonSchemaNode } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/outcomeSchema'

const agentDirectory = path.join(__dirname, '../agents/trace_finder')
const agentMarkdown = readFileSync(path.join(agentDirectory, 'AGENT.md'), 'utf8')
const outcomeMarkdown = readFileSync(path.join(agentDirectory, 'OUTCOME.md'), 'utf8')
const schemaBlock = outcomeMarkdown.match(/```json\s*([\s\S]*?)```/)
if (!schemaBlock) throw new Error('[internal] O2 outcome schema missing')
const outcomeSchema = JSON.parse(schemaBlock[1]) as JsonSchemaNode
const { resultSchema } = compileOutcome({ kind: 'research', schema: outcomeSchema })

const candidate = {
  url: 'https://example.invalid/portfolio',
  kind: 'website',
  name: 'Przykładowe portfolio',
  evidence: 'Strona kontaktowa zawiera pełny adres anna@example.invalid.',
  sourceUrl: 'https://example.invalid/kontakt',
}

describe('O2 file-agent contract', () => {
  it('loads with only read-only web tools and inherits the configured model', () => {
    const agent = parseAgentMarkdown(agentMarkdown)
    expect(agent).toMatchObject({
      id: 'photographers.trace_finder',
      tools: ['agent_orchestrator.web_search', 'agent_orchestrator.web_fetch'],
      maxSteps: 8,
    })
    expect(agent?.provider).toBeUndefined()
    expect(agent?.model).toBeUndefined()
    expect(agent?.subAgents).toEqual([])
  })

  it('compiles the platform-supported outcome and accepts sourced candidate research', () => {
    expect(resultSchema.safeParse({
      kind: 'research',
      data: { status: 'complete', candidates: [candidate], summary: 'Znaleziono kandydata.', issues: [] },
    }).success).toBe(true)
  })

  it('rejects missing provenance, unsupported identity claims and proposal output', () => {
    const { sourceUrl: omittedSource, ...withoutSource } = candidate
    expect(omittedSource).toBeDefined()
    for (const invalidCandidate of [withoutSource, { ...candidate, identityConfirmed: true }]) {
      expect(resultSchema.safeParse({
        kind: 'research',
        data: { status: 'complete', candidates: [invalidCandidate], summary: 'Wynik.', issues: [] },
      }).success).toBe(false)
    }
    expect(resultSchema.safeParse({ kind: 'proposal', proposal: { actions: [] } }).success).toBe(false)
  })

  it.each(['partial', 'no_results', 'unavailable'])('preserves controlled %s research outcomes', (status) => {
    expect(resultSchema.safeParse({
      kind: 'research',
      data: { status, candidates: [], summary: 'Poszukiwanie zakończone.', issues: ['Ograniczenie opisane przez narzędzie.'] },
    }).success).toBe(true)
  })
})
