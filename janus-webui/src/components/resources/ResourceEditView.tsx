import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ResourceType, SkillResource, SubAgentResource } from '@shared/types'
import { isMarkdownFile } from '@shared/utils.browser'
import { FileTree } from '@renderer/components/FileTree'
import { MarkdownEditor } from '@renderer/components/MarkdownEditor'
import { JsonEditor } from '@renderer/components/JsonEditor'
import { TwoPanelLayout } from '@renderer/components/layout/TwoPanelLayout'
import { ResourceSubViewHeader } from './ResourceListView'
import { showMessage } from '@renderer/stores/messageStore'

function fileBaseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

async function confirmSave(filePath: string): Promise<boolean> {
  return showMessage({
    message: `Save changes to ${fileBaseName(filePath)}?`,
    confirm: true
  })
}

async function confirmDiscard(filePath: string): Promise<boolean> {
  return showMessage({
    message: `Discard unsaved changes to ${fileBaseName(filePath)}?`,
    confirm: true
  })
}

type ListableResourceType = Exclude<ResourceType, 'mcp'>
type CanonicalResource = SkillResource | SubAgentResource

interface ResourceEditViewProps {
  resourceType: ListableResourceType
  resourceName: string
  onBack: () => void
}

function getFiles(resource: CanonicalResource, resourceType: ListableResourceType): string[] {
  switch (resourceType) {
    case 'skill':
      return (resource as SkillResource).files
    case 'subAgent':
      return [(resource as SubAgentResource).filePath]
    default:
      return []
  }
}

function getRootPath(resource: CanonicalResource, resourceType: ListableResourceType): string | undefined {
  switch (resourceType) {
    case 'skill':
      return (resource as SkillResource).rootPath
    default:
      return undefined
  }
}

function getDefaultFile(resource: CanonicalResource, resourceType: ListableResourceType): string {
  switch (resourceType) {
    case 'skill':
      return (resource as SkillResource).skillMdPath
    case 'subAgent':
      return (resource as SubAgentResource).filePath
    default:
      return ''
  }
}

export function ResourceEditView({ resourceType, resourceName, onBack }: ResourceEditViewProps) {
  const [resource, setResource] = useState<CanonicalResource | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const canonical = await window.agentManager.getCanonicalResource(resourceType, resourceName)
      if (!canonical) {
        setResource(null)
        return
      }
      setResource(canonical)
      const file = getDefaultFile(canonical, resourceType)
      setSelectedFile(file)
      const text = await window.agentManager.readFile(file)
      setContent(text)
      setSavedContent(text)
    } finally {
      setLoading(false)
    }
  }, [resourceType, resourceName])

  useEffect(() => {
    void load()
  }, [load])

  const files = useMemo(
    () => (resource ? getFiles(resource, resourceType) : []),
    [resource, resourceType]
  )

  const openFile = async (path: string) => {
    setSelectedFile(path)
    const text = await window.agentManager.readFile(path)
    setContent(text)
    setSavedContent(text)
  }

  const isDirty = content !== savedContent

  const discardChanges = async () => {
    if (!(await confirmDiscard(selectedFile ?? resourceName))) return
    setContent(savedContent)
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <ResourceSubViewHeader title={`Edit: ${resourceName}`} onBack={onBack} />
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="flex flex-col h-full">
        <ResourceSubViewHeader title={`Edit: ${resourceName}`} onBack={onBack} />
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          Resource not found
        </div>
      </div>
    )
  }

  const showTree = resourceType !== 'subAgent' && files.length > 1

  return (
    <div className="flex flex-col h-full">
      <ResourceSubViewHeader
        title={`Edit: ${resource.name}`}
        onBack={onBack}
      />
      <div className="flex-1 min-h-0">
        {showTree ? (
          <TwoPanelLayout
            autoSaveId={`edit-${resourceType}-panels-v2`}
            left={
              <FileTree
                files={files}
                selected={selectedFile ?? undefined}
                onSelect={(p) => void openFile(p)}
                rootPath={getRootPath(resource, resourceType)}
              />
            }
            right={
              selectedFile ? (
                <EditorPane
                  filePath={selectedFile}
                  content={content}
                  onChange={setContent}
                  dirty={isDirty}
                  onDiscard={() => void discardChanges()}
                  onSaved={setSavedContent}
                  resourceType={resourceType}
                  resourceName={resourceName}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                  Select a file
                </div>
              )
            }
          />
        ) : (
          <div className="h-full p-2">
            {selectedFile && (
              <EditorPane
                filePath={selectedFile}
                content={content}
                onChange={setContent}
                dirty={isDirty}
                onDiscard={() => void discardChanges()}
                onSaved={setSavedContent}
                resourceType={resourceType}
                resourceName={resourceName}
                onFilePathChange={setSelectedFile}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EditorPane({
  filePath,
  content,
  onChange,
  dirty,
  onDiscard,
  onSaved,
  resourceType,
  resourceName,
  onFilePathChange
}: {
  filePath: string
  content: string
  onChange: (v: string) => void
  dirty: boolean
  onDiscard: () => void
  onSaved: (v: string) => void
  resourceType?: ListableResourceType
  resourceName?: string
  onFilePathChange?: (path: string) => void
}) {
  const isMd = isMarkdownFile(filePath) || filePath.endsWith('.py')
  const isSkillMd = resourceType === 'skill' && fileBaseName(filePath) === 'SKILL.md'
  if (isMd) {
    return (
      <MarkdownEditor
        filePath={filePath}
        value={content}
        onChange={onChange}
        dirty={dirty}
        onDiscard={onDiscard}
        onSave={async (v) => {
          if (!(await confirmSave(filePath))) return
          if (isSkillMd && resourceName) {
            const { filePath: savedPath } = await window.agentManager.writeSkillMd(
              filePath,
              v,
              resourceName
            )
            if (savedPath !== filePath) onFilePathChange?.(savedPath)
          } else {
            await window.agentManager.writeFile(filePath, v)
          }
          onSaved(v)
        }}
      />
    )
  }
  return (
    <JsonEditor
      value={content}
      onChange={onChange}
      dirty={dirty}
      onDiscard={onDiscard}
      onSave={async (v) => {
        if (!(await confirmSave(filePath))) return
        await window.agentManager.writeFile(filePath, v)
        onSaved(v)
      }}
    />
  )
}
