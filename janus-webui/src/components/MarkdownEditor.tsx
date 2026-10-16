import { useCallback, useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@renderer/lib/utils'
import { CopyButton } from '@renderer/components/CopyButton'
import { Group, Panel, ResizeHandle } from '@renderer/components/layout/ResizablePanels'

type EditorMode = 'edit' | 'preview' | 'split'

interface MarkdownEditorProps {
  filePath?: string
  value: string
  onChange?: (value: string) => void
  onSave?: (value: string) => Promise<void>
  onDiscard?: () => void
  dirty?: boolean
  readOnly?: boolean
  className?: string
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

function stripFrontmatter(content: string): string {
  // Handle both LF and CRLF; match the closing --- on its own line
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/)
  return match ? content.slice(match[0].length) : content
}

function MarkdownPreview({ content }: { content: string }) {
  const rendered = stripFrontmatter(content)
  return (
    <div className="markdown-preview h-full overflow-auto max-w-full min-w-0">
      <div className="markdown-prose max-w-3xl mx-auto break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className ?? '')
              const isBlock = className?.includes('language-')
              if (isBlock && match) {
                return (
                  <div className="code-block-wrapper">
                    <div className="code-block-lang">{match[1]}</div>
                    <pre>
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  </div>
                )
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
          }}
        >
          {rendered}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export function MarkdownEditor({
  filePath,
  value,
  onChange,
  onSave,
  onDiscard,
  dirty = false,
  readOnly = false,
  className
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>('edit')
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const previewContent = useDebouncedValue(draft, 150)

  useEffect(() => {
    setDraft(value)
  }, [value, filePath])

  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(draft)
      onChange?.(draft)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, onChange])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const modeButtons = useMemo(
    () =>
      [
        { id: 'edit' as const, label: 'Edit (.md)' },
        { id: 'preview' as const, label: 'Preview (.md)' },
        { id: 'split' as const, label: 'Split' }
      ] as const,
    []
  )

  const editorPane = (
    <CodeMirror
      value={draft}
      height="100%"
      theme={oneDark}
      extensions={[markdown()]}
      editable={!readOnly}
      onChange={(v) => {
        setDraft(v)
        onChange?.(v)
      }}
      className="h-full"
    />
  )

  return (
    <div className={cn('flex flex-col h-full border border-zinc-800 rounded-lg overflow-hidden', className)}>
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex rounded-md overflow-hidden border border-zinc-700">
          {modeButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setMode(btn.id)}
              className={cn(
                'px-3 py-1 text-xs',
                mode === btn.id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {filePath && <span className="text-xs text-zinc-500 truncate flex-1">{filePath}</span>}
        <div className={cn('flex items-center gap-2', !filePath && 'ml-auto')}>
          <CopyButton text={() => draft} />
          {!readOnly && onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={!dirty}
              className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded disabled:opacity-50"
            >
              Discard
            </button>
          )}
          {!readOnly && onSave && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 rounded disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'edit' && <div className="h-full">{editorPane}</div>}
        {mode === 'preview' && <MarkdownPreview content={previewContent} />}
        {mode === 'split' && (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={50} minSize={25}>
              <div className="h-full border-r border-zinc-800">{editorPane}</div>
            </Panel>
            <ResizeHandle />
            <Panel defaultSize={50} minSize={25}>
              <MarkdownPreview content={previewContent} />
            </Panel>
          </Group>
        )}
      </div>
    </div>
  )
}
