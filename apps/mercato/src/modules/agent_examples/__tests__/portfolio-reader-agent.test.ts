import fs from 'node:fs'
import path from 'node:path'
import { loadFileAgentDir } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineFileAgent'

const agentDir = path.join(__dirname, '..', 'agents', 'portfolio_reader_o1')
const loadedAgent = loadFileAgentDir(agentDir)
const linkTypes = ['website', 'contact', 'instagram', 'facebook', 'google_maps']
const evidence = {
  url: 'https://studio-fotograficzne.example/kontakt',
  method: 'page_read',
  evidence: 'Syntetyczna strona podaje zgodny e-mail i dane fotografa.',
}
const completeData = {
  schemaVersion: 1,
  status: 'complete',
  stopReason: 'search_exhausted',
  portfolio: {
    kind: 'website_url',
    originalValue: 'https://studio-fotograficzne.example',
    normalizedValue: 'https://studio-fotograficzne.example',
    resolvedUrl: 'https://studio-fotograficzne.example',
    status: 'resolved',
  },
  links: linkTypes.map((type) => ({
    type,
    originalUrl: `https://synthetic.example/${type}?utm_source=test`,
    url: `https://synthetic.example/${type}`,
    confidence: 'confirmed',
    approvalRequired: false,
    sources: [evidence],
  })),
  nip: [{
    originalValue: 'PL 123-456-32-18',
    value: '1234563218',
    checksumValid: true,
    confidence: 'confirmed',
    approvalRequired: false,
    sources: [evidence],
  }],
  city: [{
    value: 'Miasto Testowe',
    confidence: 'confirmed',
    approvalRequired: false,
    sources: [evidence],
  }],
  coverage: {
    website: 'found',
    contact: 'found',
    instagram: 'found',
    facebook: 'found',
    google_maps: 'found',
    nip: 'found',
  },
  approvalRequired: false,
  attempts: [{
    tool: 'web_fetch',
    target: 'https://studio-fotograficzne.example/kontakt',
    outcome: 'opened',
    detail: 'Syntetyczny odczyt strony kontaktowej.',
  }],
  summary: 'Syntetyczny kompletny wynik discovery.',
}
const uncheckedCoverage = Object.fromEntries(Object.keys(completeData.coverage).map((key) => [key, 'not_checked']))

function accepts(data: unknown): boolean {
  return loadedAgent!.entry.schema.safeParse({ kind: 'research', data }).success
}

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
}

describe('O1 OpenCode portfolio discovery contract', () => {
  it('loads the unchanged agent ID as research with the exact governed web tools', () => {
    expect(loadedAgent).not.toBeNull()
    expect(loadedAgent!.entry).toMatchObject({
      id: 'agent_examples.portfolio_reader_o1',
      resultKind: 'research',
      runtime: 'opencode',
      loop: { maxSteps: 36 },
    })
    expect(loadedAgent!.entry.tools).toEqual([
      'agent_orchestrator.web_search',
      'agent_orchestrator.web_fetch',
    ])
    expect(loadedAgent!.subAgents).toEqual([])
    expect(loadedAgent!.openCodeAgentName).toBe('agent_examples_portfolio_reader_o1')
  })

  it('loads exactly the four registration fields from the maintained Playground sample', () => {
    expect(loadedAgent!.entry.sampleInput).toEqual(JSON.parse(fs.readFileSync(path.join(agentDir, 'SAMPLE.json'), 'utf8')))
    expect(loadedAgent!.entry.sampleInput).toEqual({
      originalPortfolio: expect.any(String),
      registrationEmail: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
    })
  })

  it('renders only the governed web and core tools with file, shell and task permissions denied', () => {
    const frontmatter = loadedAgent!.openCodeAgentFile.split('---')[1]
    const allowedTools = Array.from(frontmatter.matchAll(/"([^"]+)": true/g), (match) => match[1])
    expect(allowedTools).toEqual([
      'open-mercato_agent_orchestrator_web_search',
      'open-mercato_agent_orchestrator_web_fetch',
      'open-mercato_agent_orchestrator_submit_outcome',
      'open-mercato_agent_orchestrator_load_skill',
      'open-mercato_agent_orchestrator_run_skill_script',
    ])
    expect(frontmatter).toContain('"*": false')
    for (const permission of ['write', 'edit', 'bash', 'task']) {
      expect(frontmatter).toContain(`${permission}: deny`)
    }
  })

  it('carries the raw pure NIP helper under the synthetic local-tools skill', () => {
    expect(loadedAgent!.skillsContent).toEqual([{
      id: '__agent_tools__',
      instructions: '',
      examples: [],
      tools: [],
      scripts: [{
        name: 'validate_nip',
        source: fs.readFileSync(path.join(agentDir, 'tools', 'validate_nip.ts'), 'utf8'),
      }],
    }])
  })

  it('roundtrips a complete source-backed research payload through the real loader schema', () => {
    expect(loadedAgent!.entry.schema.parse({ kind: 'research', data: completeData })).toEqual({
      kind: 'research',
      data: completeData,
    })
    expect(accepts({ ...completeData, city: [] })).toBe(true)
  })

  it('accepts a partial result with a confirmed link and missing NIP without review', () => {
    expect(accepts({
      ...completeData,
      status: 'partial',
      links: completeData.links.slice(0, 1),
      nip: [],
      city: [],
      coverage: { website: 'found', contact: 'not_found', instagram: 'not_found', facebook: 'not_found', google_maps: 'not_found', nip: 'not_found' },
    })).toBe(true)
  })

  it.each(['search_exhausted', 'budget_exhausted', 'tools_unavailable'])('supports an empty discovery result with explicit stopping reason %s', (stopReason) => {
    const completed = stopReason === 'search_exhausted'
    expect(accepts({
      ...completeData,
      status: 'no_results',
      stopReason,
      portfolio: { ...completeData.portfolio, status: 'unresolved', resolvedUrl: null },
      links: [],
      nip: [],
      city: [],
      coverage: completed
        ? Object.fromEntries(Object.keys(uncheckedCoverage).map((key) => [key, 'not_found']))
        : { ...uncheckedCoverage, website: 'error' },
      attempts: [{
        tool: 'web_search',
        target: 'synthetic portfolio query',
        outcome: completed ? 'not_found' : 'unavailable',
        detail: completed ? 'Brak wyników syntetycznego zapytania.' : 'Dostawca niedostępny; brak możliwości sprawdzenia.',
      }],
    })).toBe(true)
  })

  it.each([
    { status: 'no_portfolio', kind: 'missing', originalValue: 'Nie mam' },
    { status: 'invalid_input', kind: 'invalid', originalValue: null },
  ])('accepts the no-egress $status structure with nullable unresolved values', ({ status, kind, originalValue }) => {
    expect(accepts({
      ...completeData,
      status,
      stopReason: status,
      portfolio: { kind, originalValue, normalizedValue: null, resolvedUrl: null, status: 'unresolved' },
      links: [],
      nip: [],
      city: [],
      coverage: uncheckedCoverage,
      attempts: [],
    })).toBe(true)
  })

  it('preserves competing NIP candidates and invalid-checksum evidence for review', () => {
    expect(accepts({
      ...completeData,
      status: 'partial',
      approvalRequired: true,
      nip: [
        { ...completeData.nip[0], confidence: 'probable', approvalRequired: true },
        { ...completeData.nip[0], originalValue: '1234563219', value: '1234563219', checksumValid: false, confidence: 'conflict', approvalRequired: true },
      ],
    })).toBe(true)
  })

  describe.each(['links', 'nip', 'city'] as const)('%s evidence structure', (field) => {
    it.each(['confidence', 'approvalRequired', 'sources'])('rejects an item without %s', (requiredField) => {
      expect(accepts({ ...completeData, [field]: [withoutField(completeData[field][0], requiredField)] })).toBe(false)
    })

    it('rejects an empty source list and unknown confidence', () => {
      expect(accepts({ ...completeData, [field]: [{ ...completeData[field][0], sources: [] }] })).toBe(false)
      expect(accepts({ ...completeData, [field]: [{ ...completeData[field][0], confidence: 0.99 }] })).toBe(false)
    })

    it.each(['url', 'method', 'evidence'])('rejects a source without %s', (requiredField) => {
      expect(accepts({
        ...completeData,
        [field]: [{ ...completeData[field][0], sources: [withoutField(evidence, requiredField)] }],
      })).toBe(false)
    })

    it.each(['url', 'evidence'])('rejects empty source %s', (requiredField) => {
      expect(accepts({
        ...completeData,
        [field]: [{ ...completeData[field][0], sources: [{ ...evidence, [requiredField]: '' }] }],
      })).toBe(false)
    })
  })

  it('rejects extra categories, untyped checksum flags, obsolete fields and schema versions', () => {
    expect(accepts({ ...completeData, links: [{ ...completeData.links[0], type: 'linkedin' }] })).toBe(false)
    expect(accepts({ ...completeData, nip: [withoutField(completeData.nip[0], 'checksumValid')] })).toBe(false)
    expect(accepts({ ...completeData, nip: [{ ...completeData.nip[0], checksumValid: 'false' }] })).toBe(false)
    expect(accepts({ ...completeData, input: { registrationEmail: 'synthetic@example.test' } })).toBe(false)
    expect(accepts({ ...completeData, schemaVersion: 2 })).toBe(false)
    expect(accepts({ ...completeData, coverage: withoutField(completeData.coverage, 'nip') })).toBe(false)
    expect(loadedAgent!.entry.schema.safeParse({ kind: 'proposal', proposal: completeData }).success).toBe(false)
  })

  it('ships budget and cross-field behavior as rendered guidance, not conditional schema validation', () => {
    const rendered = loadedAgent!.openCodeAgentFile
    expect(rendered).toContain('At most 10 web_search calls and 15 web_fetch calls, including failed calls and retries.')
    expect(rendered).toContain('Follow at most two edges from a')
    expect(rendered).toContain('Aim to submit within five minutes')
    expect(rendered).toContain('maxSteps is a backstop, not an egress quota.')
    expect(rendered).toContain('Retry a transient timeout/network/service failure at most once')
    expect(rendered).toContain('includeContent: false')
    expect(rendered).toContain('Only confirmed items can have\napprovalRequired false')
    expect(rendered).toContain('A NIP with checksumValid false cannot\nbe confirmed')
    expect(rendered).toContain('Missing NIP\nalone does not require approval.')
    expect(rendered).toContain('Cross-field rules above are behavioral instructions;')
    expect(rendered).toContain('create proposals, run Apify Actors, or perform GUS, CEIDG, KRS, VAT or other registry lookups.')
    expect(rendered).toContain('Finish by calling the `open-mercato_agent_orchestrator_submit_outcome` tool')
    for (const unsupported of ['oneOf', 'anyOf', 'allOf', '$ref', 'format', 'maxItems']) {
      expect(JSON.stringify(loadedAgent!.outcomeSchema)).not.toContain(`"${unsupported}"`)
    }
  })
})
