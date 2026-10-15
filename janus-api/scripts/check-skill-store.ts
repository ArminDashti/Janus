// Self-check: importNewestSkillsIntoStore imports missing skills and keeps the newest same-name copy.
// Run: npx tsx scripts/check-skill-store.ts
import assert from 'assert'
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const appRoot = mkdtempSync(join(tmpdir(), 'janus-check-'))
process.env.JANUS_APP_ROOT = appRoot

const { getSkillsStorePath } = await import('../src/app-paths')
const { importNewestSkillsIntoStore } = await import('../src/services/platform-sync.service')

const at = (seconds: number) => new Date(seconds * 1000)
const projectSkill = join(appRoot, 'project', '.cursor', 'skills', 'demo')
mkdirSync(projectSkill, { recursive: true })
const projectFile = join(projectSkill, 'SKILL.md')
writeFileSync(projectFile, 'copy from project')
utimesSync(projectFile, at(1000), at(1000))

const scan = {
  skills: [{ name: 'demo', rootPath: projectSkill, source: { type: 'project', id: 'p1', label: 'P' } }],
  mcps: [],
  subAgents: []
} as unknown as Parameters<typeof importNewestSkillsIntoStore>[0]

const storeFile = join(getSkillsStorePath(), 'demo', 'SKILL.md')

// Missing store copy is imported.
await importNewestSkillsIntoStore(scan)
assert.equal(readFileSync(storeFile, 'utf-8'), 'copy from project', 'missing skill was not imported')

// Store copy newer than the project copy is kept.
writeFileSync(storeFile, 'store edit wins')
utimesSync(storeFile, at(2000), at(2000))
await importNewestSkillsIntoStore(scan)
assert.equal(readFileSync(storeFile, 'utf-8'), 'store edit wins', 'older project copy overwrote the store')

// Project copy newer than the store copy replaces it.
writeFileSync(projectFile, 'newer project edit')
utimesSync(projectFile, at(3000), at(3000))
await importNewestSkillsIntoStore(scan)
assert.equal(readFileSync(storeFile, 'utf-8'), 'newer project edit', 'newer project copy did not win')

console.log('check-skill-store: ok')
