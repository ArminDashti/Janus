import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { Group, Panel, ResizeHandle } from './ResizablePanels'

const COLLAPSED_PX = 40
const RIGHT_MIN_PX = 400
const FILES_MIN_PX = 180

type PanelId = 'left' | 'middle' | 'files' | 'right'

interface ThreePanelLayoutProps {
  /** Receives the collapse toggle so the panel can place it in its own header row. */
  left: (collapseToggle: ReactNode) => ReactNode
  middle: (collapseToggle: ReactNode) => ReactNode
  /** Optional section between middle and right. Omit to get the 3-panel layout. */
  files?: (collapseToggle: ReactNode) => ReactNode
  right: (collapseToggle: ReactNode) => ReactNode
  /** Heading shown vertically on each panel's collapsed strip. */
  titles: Record<'left' | 'middle' | 'right', string> & Partial<Record<'files', string>>
  autoSaveId?: string
  /** Percent (0-100). Numbers are converted to "%" — v4 treats bare numbers as pixels. */
  defaultLeftSize?: number
  /** Percent (0-100). Numbers are converted to "%" — v4 treats bare numbers as pixels. */
  defaultMiddleSize?: number
  /** Pixels (bare numbers = px in v4). Guarantees usable min width. */
  minLeftSize?: number
  /** Percent (0-100). Numbers are converted to "%". */
  maxLeftSize?: number
  /** Pixels (bare numbers = px in v4). Guarantees usable min width. */
  minMiddleSize?: number
  /** Percent (0-100). Numbers are converted to "%". */
  maxMiddleSize?: number
}

export function ThreePanelLayout({
  left,
  middle,
  files,
  right,
  titles,
  autoSaveId,
  defaultLeftSize = 20,
  defaultMiddleSize = 20,
  minLeftSize = 220,
  maxLeftSize = 35,
  minMiddleSize = 260,
  maxMiddleSize = 35
}: ThreePanelLayoutProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId ?? 'three-panel-default-v2',
    panelIds: files ? ['left', 'middle', 'files', 'right'] : ['left', 'middle', 'right'],
    storage: localStorage
  })
  const leftRef = usePanelRef()
  const middleRef = usePanelRef()
  const filesRef = usePanelRef()
  const rightRef = usePanelRef()
  const [collapsed, setCollapsed] = useState<Record<PanelId, boolean>>({
    left: false,
    middle: false,
    files: false,
    right: false
  })

  const refs = { left: leftRef, middle: middleRef, files: filesRef, right: rightRef }

  const syncCollapsed = (id: PanelId) =>
    setCollapsed((prev) => ({ ...prev, [id]: refs[id].current?.isCollapsed() ?? false }))

  // expand() only works when size === collapsedSize exactly, but isCollapsed() is tolerant.
  // A size restored from the autosaved layout can be off by a fraction, so expand() silently
  // no-ops. resize() to the panel's minimum width avoids that check.
  const expandPx: Record<PanelId, number> = {
    left: minLeftSize,
    middle: minMiddleSize,
    files: FILES_MIN_PX,
    right: RIGHT_MIN_PX
  }

  const toggle = (id: PanelId) => {
    const panel = refs[id].current
    if (!panel) return
    if (panel.isCollapsed()) panel.resize(expandPx[id])
    else panel.collapse()
  }

  // Left/middle collapse toward the left edge; right collapses toward the right edge.
  const renderCollapseToggle = (id: PanelId) => {
    const isCollapsed = collapsed[id]
    const Icon = (id === 'right') === isCollapsed ? ChevronLeft : ChevronRight
    return (
      <button
        type="button"
        onClick={() => toggle(id)}
        className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 shrink-0"
        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <Icon size={16} />
      </button>
    )
  }

  const renderPanel = (id: PanelId, render: (toggle: ReactNode) => ReactNode) => {
    const toggleButton = renderCollapseToggle(id)
    return collapsed[id] ? (
      <div className="flex shrink-0 flex-col items-center gap-3 px-2 py-2 border-b border-zinc-800">
        {toggleButton}
        <h2 className="text-xs font-medium text-zinc-400 whitespace-nowrap [writing-mode:vertical-rl]">
          {titles[id]}
        </h2>
      </div>
    ) : (
      <div className="flex-1 min-h-0 overflow-hidden">{render(toggleButton)}</div>
    )
  }

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="flex-1 min-h-0"
    >
      <Panel
        id="left"
        panelRef={leftRef}
        collapsible
        collapsedSize={COLLAPSED_PX}
        defaultSize={`${defaultLeftSize}%`}
        minSize={minLeftSize}
        maxSize={`${maxLeftSize}%`}
        onResize={() => syncCollapsed('left')}
      >
        <div className="h-full min-w-0 overflow-hidden border-r border-zinc-800 flex flex-col">
          {renderPanel('left', left)}
        </div>
      </Panel>
      <ResizeHandle />
      <Panel
        id="middle"
        panelRef={middleRef}
        collapsible
        collapsedSize={COLLAPSED_PX}
        defaultSize={`${defaultMiddleSize}%`}
        minSize={minMiddleSize}
        maxSize={`${maxMiddleSize}%`}
        onResize={() => syncCollapsed('middle')}
      >
        <div className="h-full min-w-0 overflow-hidden border-r border-zinc-800 flex flex-col">
          {renderPanel('middle', middle)}
        </div>
      </Panel>
      <ResizeHandle />
      {files && (
        <>
          <Panel
            id="files"
            panelRef={filesRef}
            collapsible
            collapsedSize={COLLAPSED_PX}
            defaultSize="18%"
            minSize={FILES_MIN_PX}
            maxSize="30%"
            onResize={() => syncCollapsed('files')}
          >
            <div className="h-full min-w-0 overflow-hidden border-r border-zinc-800 flex flex-col">
              {renderPanel('files', files)}
            </div>
          </Panel>
          <ResizeHandle />
        </>
      )}
      <Panel
        id="right"
        panelRef={rightRef}
        collapsible
        collapsedSize={COLLAPSED_PX}
        minSize={RIGHT_MIN_PX}
        onResize={() => syncCollapsed('right')}
      >
        <div className="h-full min-w-0 overflow-hidden flex flex-col">
          {renderPanel('right', right)}
        </div>
      </Panel>
    </Group>
  )
}
