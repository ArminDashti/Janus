import { useEffect } from 'react'
import { SettingsPage } from '@renderer/pages/SettingsPage'
import { useAppStore } from '@renderer/stores/appStore'
import { useIosModalPresence } from '@renderer/components/ios-modal-presence'

const FADE_MS = 200

/** Preferences dialog — sidebar navigation + sectioned content; fades in on open and out on close. */
export function SettingsModal() {
  const { settingsOpen, closeSettings } = useAppStore()
  const { mounted, dismissing } = useIosModalPresence(settingsOpen, FADE_MS)

  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, closeSettings])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 ${
        dismissing ? 'animate-fade-out' : 'animate-fade-in'
      }`}
      role="presentation"
      onClick={() => closeSettings()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden w-[min(1296px,92vw)] h-[min(1008px,85vh)] max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsPage embedded onClose={() => closeSettings()} />
      </div>
    </div>
  )
}
