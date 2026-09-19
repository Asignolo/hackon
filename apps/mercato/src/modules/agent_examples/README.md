# Defining Agent Orchestrator agents in a new module

This module is a worked example of declaring propose-only agents from a brand-new
module. It includes tool-free support triage, delegated batch triage, and the
web-enabled O1 portfolio reader.

## What an agent is

Agent Orchestrator supports two authoring runtimes behind the same registry and
run API:

- a native agent authored in code with `defineAgent(...)`, validated against a
  Zod schema;
- a file-defined OpenCode agent authored under `agents/<folder>/` with
  `AGENT.md`, `OUTCOME.md`, and an optional `SAMPLE.json`.

Both return a typed `AgentResult`:

- **researcher** — returns `data` (this example). Nothing is proposed.
- **proposal** — returns a `proposal` (actions + confidence) that a human or a
  threshold rule disposes, then an effector applies. See
  `agent_orchestrator/ai-agents.ts` (`deals.health_check`) for the proposal
  variant.

Propose-only is structural: native agents are declared read-only, while the
file-agent loader rejects mutating or unknown tools and generates deny-by-default
OpenCode permissions. An agent can only read and propose — never write directly.

## Steps to add a native agent in your own module

1. **Result schema** — `data/validators.ts`. Wrap the payload in the AgentResult
   shape:

   ```ts
   import { z } from 'zod'
   export const ticketTriageResult = z.object({
     kind: z.literal('research'),
     data: z.object({ /* your fields, all required */ }),
   })
   ```

   For a proposal agent use `kind: z.literal('proposal')` + a `proposal`
   object (`actions`, `confidence`, `rationale`).

2. **Declare the agent** — `ai-agents.ts` (this file name is auto-discovered):

   ```ts
   import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
   import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
   import { ticketTriageResult } from './data/validators'

   export const aiAgents: AiAgentDefinition[] = [
     defineAgent({
       id: 'support.ticket_triage',     // STABLE 'group.name' contract id
       moduleId: 'agent_examples',
       label: 'Support ticket triage',
       description: '…',
       instructions: '…system prompt…',
       // tools: ['customers.get_deal'],   // optional read-only defineAiTool ids
       // skills: ['deals.stage_playbook'], // optional skill ids (see below)
       result: { kind: 'research', schema: ticketTriageResult },
     }),
   ]
   export default aiAgents
   ```

3. **Register the module** — add it to `apps/mercato/src/modules.ts`
   `enabledModules`:

   ```ts
   { id: 'agent_examples', from: '@app' },
   ```

   and add a minimal `index.ts` exporting `metadata: ModuleInfo`.

4. **Generate** — `yarn generate`. The agent now appears in
   **Backend → Agents**, is runnable from the **Playground**, and can be invoked
   from a workflow `INVOKE_AGENT` step.

## Read-only tools

List `defineAiTool` ids in `tools: [...]`. The agent runs a read-only tool loop
(`runAiAgentObject({ enableTools })` → `generateText` + `experimental_output`),
gathers data, then emits its structured result. Mutation tools are stripped by
the read-only policy. The tool runs under the caller's ACL, so the caller needs
the tool's `requiredFeatures`.

## Skills

Skills are reusable SKILL.md packs (instructions + read-only tools) authored under
`agent_orchestrator/skills/*.md`. Reference them with `skills: ['<id>']`; the
skill's instructions are injected into the prompt and its tools are unioned into
the agent's allowlist. Skills are currently registered by the `agent_orchestrator`
module — see `agent_orchestrator/lib/sdk/defineSkill.ts` and `ai-skills.ts`.

## Sub-agents (delegate to other agents, in parallel)

An agent can delegate sub-tasks to other agents. Declare `subAgents: ['<id>']` and
the agent automatically gains the read-only `agent_orchestrator.delegate_agent`
tool plus a prompt section listing the allowed sub-agents. The model calls the
tool — issuing several calls in one step to **fan out in parallel** — then
combines the results.

```ts
defineAgent({
  id: 'support.triage_batch',
  moduleId: 'agent_examples',
  // …
  subAgents: ['support.ticket_triage'], // ← auto-adds the delegate tool
  result: { kind: 'research', schema: triageBatchResult },
})
```

Safety (enforced by the delegate tool): sub-agents must be **researcher**
(they inform; only the parent proposes), may **not** themselves delegate (depth
capped at 1, no cycles), and run under the **caller's** ACL — never escalated.
The whole tree stays propose-only: no agent writes.

`support.triage_batch` is the worked example — run it with:

```json
{ "tickets": [
  { "subject": "Charged twice", "body": "Two identical charges on my card." },
  { "subject": "Love the new dashboard", "body": "Just wanted to say thanks!" },
  { "subject": "Site is down", "body": "500 errors on every page right now." }
] }
```

It delegates each ticket to `support.ticket_triage` in parallel and returns an
aggregate (`total`, `urgentCount`, `items[]`).

## O1 portfolio and email discovery

`agent_examples.portfolio_reader_o1` is a file-defined OpenCode researcher. Its
input contains exactly four registration fields (synthetic contract example):

```json
{
  "originalPortfolio": "https://studio-fotograficzne.example",
  "registrationEmail": "kontakt@studio-fotograficzne.example",
  "firstName": "Osoba",
  "lastName": "Testowa"
}
```

It discovers exactly five types of starting links: **website, contact,
Instagram, Facebook, Google Maps**, plus public NIP candidates and city clues.
Each item includes source URLs, a short evidence paraphrase, discovery method,
and `confirmed | probable | unconfirmed | conflict` identity confidence.
Registration values are hints, never independently discovered facts.

`links`, `nip`, and `city` are separate arrays. Each item has `approvalRequired`;
confirmed items may continue independently, while uncertain/conflicting items
wait for the owner. These research flags are consumed by the surrounding process:
they do not create proposals or automatically invoke proposal disposition.

O1 is the single discovery researcher: it searches the exact full registration email
in quotes for every valid input and combines that evidence with the supplied portfolio.
Missing or dead portfolio continues through email and name discovery and never implies
low potential. Queries and visited URLs are deduplicated within the same run. The original
portfolio stays missing/unresolved when absent; discovered websites are returned in `links`.
The legacy `no_portfolio` status remains readable but is not emitted in new runs. Missing NIP
alone gives a partial result without requiring approval. `coverage`, `attempts`
and `stopReason` distinguish completed searches from blocked/failed/unattempted
checks. NIP checksum validation uses the pure sandboxed `validate_nip` helper;
checksum validity does not establish ownership.

The agent is read-only and uses `agent_orchestrator.web_search` plus
`agent_orchestrator.web_fetch`. The caller therefore needs the Agent
Orchestrator run permission and the default-off web-search/web-fetch grants. It
may search public business directories and quoted email plus NIP. It does not
query GUS/CEIDG/KRS/VAT, assess activity, scrape full profiles, invoke Apify or
write customer data. The next stage chooses scraping tools from confirmed or
explicitly approved links and performs deterministic registry lookups.

Agent policy caps work at 10 searches, 15 fetches, depth two, five minutes and
one agent-level transient retry within those caps. The existing runtime's default
timeout is five minutes; deployment overrides and provider transport retries
remain unchanged. No new hard per-agent egress or monetary quota is introduced.

`web_fetch` now exposes optional `links` with `url`, `originalHref`, and `text`
from source HTML, including footers/navigation, plus `linksTruncated`. Omitted
links mean unavailable extraction. Firecrawl is still an adapter behind
`web_search`; `web_fetch` does not route through Firecrawl scrape.

For missing Google Maps links, O1 reserves up to two focused queries within the
same search budget, using the full name and the observed brand/city. Organic
search does not expose Google's business panel: an unsuccessful search means
no link was found in the checked sources, not that no business listing exists.
O1 never manufactures a Maps listing URL from a name or address.

O1 is a file-defined OpenCode agent. Its source is
`agents/portfolio_reader_o1/{AGENT.md,OUTCOME.md,SAMPLE.json,tools/}`. Run
`yarn generate` after editing those files and restart the OpenCode service so it
loads the generated agent definition.

## Try it

Open **Backend → Agents → Support ticket triage → Open in playground** and run:

```json
{ "subject": "Charged twice this month", "body": "I see two identical charges on my card." }
```

Expect a researcher result like
`{ category: "billing", priority: "high", summary: "…" }`.

For O1, open **Backend → Agents → O1 — Portfolio discovery → Open in playground**,
use **Insert sample**, and run. The result is a `research` outcome whose `data`
contains the classified portfolio, source-backed links/NIP/city, coverage,
attempts, and review flags. `agents/portfolio_reader_o1/SAMPLE.json` holds the
owner-provided manual test input (updated on 2026-09-19). Preserve it for future
Playground tests; these registration hints are not verified findings. Automated
research fixtures remain synthetic and do not send this sample to web providers.

On another installation, run `yarn generate` and restart OpenCode. Configure
Firecrawl through **Settings → Web search** with that installation's own key,
then grant web-search access to the caller. Provider credentials and tenant
settings are stored locally and are not included in Git. For discovery, the
Firecrawl search adapter can return snippets without inline full-page content;
O1 reads selected pages separately with `web_fetch`.
