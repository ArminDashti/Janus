import { settingsStore } from './settings-store'
import {
  API_PROVIDER_LABELS,
  type ApiProviderConfig,
  type ApiProviderId
} from '../shared/types'

export type RefactorResourceType = 'skill' | 'subAgent'

const TYPE_LABELS: Record<RefactorResourceType, string> = {
  skill: 'Skills',
  subAgent: 'Sub-agent'
}

export interface RefactorRequest {
  resourceType: RefactorResourceType
  content: string
  userPrompt: string
}

export interface RefactorResult {
  content: string
  model: string
  provider: ApiProviderId
}

/** Base URLs for providers that speak the OpenAI chat-completions format. */
const OPENAI_COMPATIBLE_BASE_URLS: Record<
  Exclude<ApiProviderId, 'anthropic' | 'openAiCompatible'>,
  string
> = {
  openAi: 'https://api.openai.com/v1',
  openRouter: 'https://openrouter.ai/api/v1',
  opencodeZen: 'https://opencode.ai/zen/v1',
  opencodeGo: 'https://opencode.ai/zen/go/v1'
}

function loadInstructionTemplate(): string {
  return [
    '# Edit Instruction',
    '',
    'Edit ONLY the lines that need to change based on the user request.',
    'Return a unified diff in the following format:',
    '',
    '```',
    '--- a',
    '+++ b',
    '@@ -LINE,COUNT +LINE,COUNT @@',
    ' context line',
    '-removed line',
    '+added line',
    ' context line',
    '```',
    '',
    'Rules:',
    '- Return ONLY the unified diff block. No prose, no explanation.',
    '- Use 3 lines of context before and after each change.',
    '- Do not rewrite unchanged sections.',
    '- Preserve indentation and formatting exactly.',
    '- If the entire file needs replacing, output a full replacement diff.',
  ].join('\n')
}

function buildPrompt(resourceType: RefactorResourceType, content: string, userPrompt: string): string {
  const label = TYPE_LABELS[resourceType]
  const instruction = loadInstructionTemplate()
  return [
    instruction,
    '',
    `## ${label} content to edit:`,
    '```',
    content,
    '```',
    '',
    `## User request:`,
    userPrompt,
  ].join('\n')
}

/**
 * Apply a unified diff to original content.
 * Returns the patched string, or the original if the diff cannot be applied cleanly.
 */
function applyUnifiedDiff(original: string, diffText: string): string {
  const lines = original.split('\n')
  const diffLines = diffText.split('\n')

  let result = [...lines]
  let offset = 0

  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

  let i = 0
  while (i < diffLines.length) {
    const line = diffLines[i]
    const m = hunkHeaderRe.exec(line)
    if (!m) { i++; continue }

    const origStart = parseInt(m[1], 10) - 1
    i++

    const hunkOrig: string[] = []
    const hunkNew: string[] = []

    while (i < diffLines.length && !hunkHeaderRe.test(diffLines[i])) {
      const dl = diffLines[i]
      if (dl.startsWith('-')) {
        hunkOrig.push(dl.slice(1))
      } else if (dl.startsWith('+')) {
        hunkNew.push(dl.slice(1))
      } else {
        const ctx = dl.startsWith(' ') ? dl.slice(1) : dl
        hunkOrig.push(ctx)
        hunkNew.push(ctx)
      }
      i++
    }

    const pos = origStart + offset
    result.splice(pos, hunkOrig.length, ...hunkNew)
    offset += hunkNew.length - hunkOrig.length
  }

  return result.join('\n')
}

function extractDiffBlock(text: string): string {
  const fenceMatch = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trimEnd()
  const hunks = text.split('\n').filter(
    (l) => l.startsWith('---') || l.startsWith('+++') || l.startsWith('@@') ||
           l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')
  )
  return hunks.length > 3 ? hunks.join('\n') : text.trim()
}

function baseUrlFor(
  provider: Exclude<ApiProviderId, 'anthropic'>,
  config: ApiProviderConfig
): string {
  if (provider !== 'openAiCompatible') return OPENAI_COMPATIBLE_BASE_URLS[provider]
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error('OpenAI-Compatible base URL is not configured. Set it in Settings → Providers.')
  }
  return baseUrl
}

interface ProviderCall {
  url: string
  headers: Record<string, string>
  body: unknown
}

function buildCall(provider: ApiProviderId, config: ApiProviderConfig, prompt: string): ProviderCall {
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: config.model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] }
    }
  }
  return {
    url: `${baseUrlFor(provider, config)}/chat/completions`,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: { model: config.model, messages: [{ role: 'user', content: prompt }] }
  }
}

function extractText(provider: ApiProviderId, parsed: unknown): string | undefined {
  if (provider === 'anthropic') {
    const blocks = (parsed as { content?: Array<{ type?: string; text?: string }> }).content ?? []
    return blocks.find((b) => b.type === 'text')?.text
  }
  return (parsed as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content
}

async function complete(provider: ApiProviderId, config: ApiProviderConfig, prompt: string): Promise<string> {
  const label = API_PROVIDER_LABELS[provider]
  const call = buildCall(provider, config, prompt)
  const response = await fetch(call.url, {
    method: 'POST',
    headers: { ...call.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(call.body)
  })
  const body = await response.text()

  if (!response.ok) {
    let message = `${label} request failed (${response.status})`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string }
      const errorMessage = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
      if (errorMessage) message = errorMessage
    } catch {
      if (body.trim()) message = body.trim().slice(0, 300)
    }
    throw new Error(message)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }

  const content = extractText(provider, parsed)
  if (!content?.trim()) {
    throw new Error(`${label} returned an empty response`)
  }
  return content
}

export async function refactorWithActiveProvider(request: RefactorRequest): Promise<RefactorResult> {
  const settings = settingsStore.get()
  const provider = settings.activeApiProvider
  const label = API_PROVIDER_LABELS[provider]
  const config: ApiProviderConfig = {
    apiKey: settings.providers[provider].apiKey.trim(),
    model: settings.providers[provider].model.trim(),
    baseUrl: settings.providers[provider].baseUrl.trim()
  }

  if (!config.apiKey) {
    throw new Error(`${label} API key is not configured. Set it in Settings → Providers.`)
  }
  if (!config.model) {
    throw new Error(`${label} model is not configured. Set it in Settings → Providers.`)
  }
  if (!request.userPrompt.trim()) {
    throw new Error('A user prompt is required')
  }
  if (!request.content.trim()) {
    throw new Error('Resource content is empty')
  }

  const prompt = buildPrompt(request.resourceType, request.content, request.userPrompt.trim())
  const rawContent = await complete(provider, config, prompt)

  const diffBlock = extractDiffBlock(rawContent)
  const hasDiffMarkers = diffBlock.includes('@@') && (diffBlock.includes('---') || diffBlock.includes('+++'))
  const patchedContent = hasDiffMarkers
    ? applyUnifiedDiff(request.content, diffBlock)
    : rawContent.trim()

  return {
    content: patchedContent,
    model: config.model,
    provider
  }
}
