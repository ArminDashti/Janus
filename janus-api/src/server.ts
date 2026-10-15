import { existsSync, mkdirSync } from 'fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { ensurePortableLayout, getBrandingPath, getLogosPath } from './app-paths'
import { addSseClient, onScanChanged } from './events'
import { registerRoutes } from './routes/index'
import { rescanProjectRoots } from './services/project-root-rescan.service'
import { resourceService } from './services/resource.service'
import { syncEnabledPlatformsToProjects } from './services/platform-sync.service'
import { applyStartupSetting } from './services/startup.service'
import { importedProjectsStore } from './services/imported-projects-store'
import { scannerService } from './services/scanner.service'
import { settingsStore } from './services/settings-store'
import { startFileWatcher } from './services/watcher.service'
import { checkForUpdates } from './services/update.service'

function parseBind(bind: string): { host: string; port: number } {
  if (bind.startsWith('[')) {
    const end = bind.indexOf(']')
    const host = bind.slice(0, end + 1)
    const port = parseInt(bind.slice(end + 2), 10)
    return { host, port }
  }
  const colon = bind.lastIndexOf(':')
  if (colon === -1) {
    return { host: '127.0.0.1', port: parseInt(bind, 10) }
  }
  return { host: bind.slice(0, colon), port: parseInt(bind.slice(colon + 1), 10) }
}

export async function startServer(): Promise<void> {
  ensurePortableLayout()
  importedProjectsStore.pruneMissingOnDisk()
  // Projects are defined by their `.git` folder: re-walk every scan root so
  // repos cloned into a browsed folder after import are loaded automatically.
  try {
    const added = await rescanProjectRoots()
    if (added.length > 0) {
      await resourceService.syncMandatoryForNewProjects(added.map((p) => p.id))
      console.log(`Janus API: auto-loaded ${added.length} new project(s) from scan roots`)
    }
  } catch (err) {
    console.error('startup: project roots rescan failed:', err)
  }
  // Janus store -> platform/project copies, same routine as the Sync button.
  try {
    await syncEnabledPlatformsToProjects()
  } catch (err) {
    console.error('startup: skill sync failed:', err)
  }
  startFileWatcher()
  // Keep the scan cache warm: refresh on watcher events (in-process) and on a
  // fixed interval, so page reads serve the latest background update instantly.
  onScanChanged(() => scannerService.scheduleBackgroundRefresh(settingsStore.get()))
  scannerService.startBackgroundUpdates(() => settingsStore.get())
  // Re-apply the login autostart entry on every boot so the HKCU Run value
  // stays in sync with settings.json (manual edits, reinstalls, drift).
  const bootSettings = settingsStore.get()
  applyStartupSetting(bootSettings.startup?.runOnLogin ?? false)

  if (bootSettings.updates?.checkOnStartup) {
    void checkForUpdates()
      .then((check) => {
        if (check.hasUpdate) {
          console.log(
            `Updates: ${check.behind} commit(s) behind origin/${check.branch} — open Settings → Updates to install.`
          )
        } else if (check.error) {
          console.log(`Updates: startup check failed — ${check.error}`)
        }
      })
      .catch((err) => console.error('Updates: startup check threw:', err))
  }

  const bind = process.env.JANUS_API_BIND || '127.0.0.1:47911'
  const { host, port } = parseBind(bind)

  const app = Fastify({ logger: false })

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true)
        return
      }
      try {
        const url = new URL(origin)
        if (
          url.hostname === '127.0.0.1' ||
          url.hostname === 'localhost' ||
          url.hostname === 'janus.local' ||
          url.hostname === 'janus-api.local' ||
          url.hostname.endsWith('.janus.local')
        ) {
          cb(null, true)
          return
        }
      } catch {}
      cb(null, true)
    },
    credentials: true
  })

  const logosPath = getLogosPath()
  if (!existsSync(logosPath)) {
    mkdirSync(logosPath, { recursive: true })
  }
  await app.register(fastifyStatic, {
    root: logosPath,
    prefix: '/logos/',
    decorateReply: false
  })

  const brandingPath = getBrandingPath()
  if (!existsSync(brandingPath)) {
    mkdirSync(brandingPath, { recursive: true })
  }
  await app.register(fastifyStatic, {
    root: brandingPath,
    prefix: '/branding/',
    decorateReply: false
  })

  await registerRoutes(app)

  app.get('/api/health', async () => ({ ok: true }))

  app.get('/api/events', async (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    reply.raw.write(': connected\n\n')

    const client = {
      write: (chunk: string) => {
        reply.raw.write(chunk)
      },
      close: () => {
        reply.raw.end()
      }
    }
    const remove = addSseClient(client)

    request.raw.on('close', () => {
      remove()
    })
  })

  await app.listen({ host, port })
  console.log(`Janus API listening at http://${host}:${port}`)
}
