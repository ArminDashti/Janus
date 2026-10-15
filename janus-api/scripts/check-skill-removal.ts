// Self-check: deleting a store skill outside the app removes its same-name copies.
// Run: npx tsx scripts/check-skill-removal.ts
import assert from 'assert'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const appRoot = mkdtempSync(join(tmpdir(), 'janus-removal-'))
process.env.JANUS_APP_ROOT = appRoot

const { getSkillsStorePath } = await import('../src/app-paths')
const { scheduleSkillRemovalFromPath } = await import('../src/services/skill-sync.service')
const { settingsStore } = await import('../src/services/settings-store')
const { importedProjectsStore } = await import('../src/services/imported-projects-store')

// Isolated project + cursor platform so allSkillsDirs() only sees temp paths.
const projectDir = join(appRoot, 'project')
const projectSkill = join(projectDir, '.cursor', 'skills', 'demo')
mkdirSync(projectSkill, { recursive: true })
writeFileSync(join(projectSkill, 'SKILL.md'), 'copy')

const storeSkill = join(getSkillsStorePath(), 'demo')
mkdirSync(storeSkill, { recursive: true })
writeFileSync(join(storeSkill, 'SKILL.md'), 'store')

importedProjectsStore.save([
  { id: 'r1', name: 'r', scanPath: appRoot, projects: [{ id: 'p1', name: 'project', path: projectDir }] }
] as Parameters<typeof importedProjectsStore.save>[0])
settingsStore.update((s) => ({
  ...s,
  platforms: [{ id: 'cursor', enabled: true, rootPath: join(appRoot, 'home'), projectDirName: '.cursor' }]
}) as ReturnType<typeof settingsStore.get>)

// Simulate deletion outside the app.
rmSync(storeSkill, { recursive: true, force: true })
scheduleSkillRemovalFromPath(join(storeSkill, 'SKILL.md'))

await new Promise((resolve) => setTimeout(resolve, 1200))
assert.equal(existsSync(join(projectSkill, 'SKILL.md')), false, 'project copy was not removed')

rmSync(appRoot, { recursive: true, force: true })
console.log('check-skill-removal: ok')
