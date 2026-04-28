import { useState, useEffect, useRef } from 'react'
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { parseDotToReactFlow } from './utils/dotParser'
import { getLayoutedElements } from './utils/layout'

// Use a robust custom node to prevent text spilling on long resource names
const TerraformNodeComponent = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-[0_4px_12px_rgba(0,0,0,0.5)] rounded-lg bg-slate-800 border border-slate-600 hover:border-indigo-500 text-slate-200 text-xs font-mono max-w-[280px] break-words text-center transition-colors cursor-pointer">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-indigo-400 border-none" />
      {data.label}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-indigo-400 border-none" />
    </div>
  )
}

const nodeTypes = {
  terraform: TerraformNodeComponent,
}

const MIN_SIDEBAR_WIDTH = 320
const MAX_SIDEBAR_WIDTH = 720
const MAX_CONTEXT_CHARS = 12000
const MAX_FILE_SNIPPET_CHARS = 3000
const OLLAMA_DEBUG_PREFIX = '[terra-ai:renderer]'

type ChatRole = 'user' | 'assistant' | 'system'
type ChatMessage = {
  id: string
  role: ChatRole
  content: string
}

type OllamaStatus = 'checking' | 'ready' | 'offline'

const INSIGHT_RESPONSE_INSTRUCTION =
  'Respond with practical markdown sections and bullets. Cover the direct answer, security considerations, cost considerations, and concrete next steps. Keep each section concise enough to finish the full response without trailing off.'
const INSIGHT_MAX_TOKENS = 900
const CONTINUATION_MAX_TOKENS = 700

function scoreModelSpeed(modelName: string): number {
  const name = modelName.toLowerCase()

  if (name.includes('gemma4')) return 95
  if (name.includes('llama3')) return 90
  if (name.includes('qwen') && name.includes('coding')) return 15
  if (name.includes('nvfp4')) return 10
  if (name.includes('30b') || name.includes('31b') || name.includes('32b') || name.includes('35b')) return 5
  if (name.includes('0.5b') || name.includes('1b')) return 100
  if (name.includes('1.5b') || name.includes('2b')) return 90
  if (name.includes('3b')) return 80
  if (name.includes('mini') || name.includes('small')) return 75
  if (name.includes('7b') || name.includes('8b')) return 60
  if (name.includes('llama3')) return 55
  if (name.includes('gemma')) return 45
  if (name.includes('13b') || name.includes('14b')) return 35
  if (name.includes('32b') || name.includes('34b')) return 20

  return 50
}

function isPreferredChatModel(modelName: string): boolean {
  const name = modelName.toLowerCase()

  if (name.includes(':cloud')) return false
  if (name.includes('llava')) return false
  if (name.includes('vision')) return false
  if (name.includes('embed')) return false

  return true
}

function pickFastestModel(models: string[]): string {
  if (models.length === 0) return 'llama3'

  const preferredModels = models.filter(isPreferredChatModel)
  const candidates = preferredModels.length > 0 ? preferredModels : models

  return [...candidates].sort((a, b) => scoreModelSpeed(b) - scoreModelSpeed(a))[0]
}

function pickBackupChatModel(models: string[], currentModel: string): string | null {
  const candidates = models
    .filter(isPreferredChatModel)
    .filter((model) => model !== currentModel)
    .sort((a, b) => scoreModelSpeed(b) - scoreModelSpeed(a))

  return candidates[0] || null
}

function extractOllamaTextResponse(data: any): string {
  if (!data) return ''
  if (typeof data.message?.content === 'string') return data.message.content
  if (typeof data.message?.thinking === 'string') return data.message.thinking
  if (typeof data.response === 'string') return data.response
  if (typeof data.content === 'string') return data.content
  if (typeof data.thinking === 'string') return data.thinking
  return ''
}

function clampWorkspaceContext(rawContext: string): string {
  const fileSections = rawContext.split(/\n--- /).filter(Boolean)
  let remaining = MAX_CONTEXT_CHARS
  const selectedSections: string[] = []

  for (const section of fileSections) {
    if (remaining <= 0) break

    const normalizedSection = section.startsWith('--- ') ? section : `--- ${section}`
    const [headerLine = 'unknown', ...contentLines] = normalizedSection.split('\n')
    const fileHeader = headerLine.trim()
    const fullContent = contentLines.join('\n').trim()
    const trimmedContent = fullContent.slice(0, Math.min(MAX_FILE_SNIPPET_CHARS, remaining))
    const suffix = fullContent.length > trimmedContent.length ? '\n# ... truncated for speed ...' : ''
    const finalSection = `${fileHeader}\n${trimmedContent}${suffix}\n`

    selectedSections.push(finalSection)
    remaining -= finalSection.length
  }

  return selectedSections.join('\n')
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  
  // Future state for AI Sidebar
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel, setSelectedModel] = useState('llama3')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('checking')
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const activeRequestIdRef = useRef<string | null>(null)
  const receivedChunkRef = useRef(false)
  const requestPayloadRef = useRef<Record<string, unknown> | null>(null)
  const fallbackRetryRef = useRef(false)
  const truncatedAssistantIdsRef = useRef<Set<string>>(new Set())
  const activeResponseContentRef = useRef('')

  // Magic Add Modal State
  const [showAddModal, setShowAddModal] = useState(false)
  const [magicQuery, setMagicQuery] = useState('')

  useEffect(() => {
    const lastWorkspace = localStorage.getItem('terra-ai-last-workspace')
    if (lastWorkspace) {
      loadWorkspace(lastWorkspace)
    }
  }, [])

  useEffect(() => {
    void refreshOllamaStatus()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, aiLoading])

  useEffect(() => {
    const unsubscribe = window.api.onOllamaStreamEvent((event) => {
      console.log(OLLAMA_DEBUG_PREFIX, 'stream:event', event)
      if (!event.requestId || event.requestId !== activeRequestIdRef.current) return

      if (event.type === 'chunk') {
        receivedChunkRef.current = true
        fallbackRetryRef.current = false
        activeResponseContentRef.current = `${activeResponseContentRef.current}${event.content || ''}`
        setMessages((prev) =>
          prev.map((message) =>
            message.id === event.requestId
              ? { ...message, content: `${message.content}${event.content || ''}` }
              : message
          )
        )
        return
      }

      if (event.type === 'done' && !receivedChunkRef.current) {
        const fallbackPayload = requestPayloadRef.current

        if (!fallbackPayload) {
          console.warn(OLLAMA_DEBUG_PREFIX, 'stream:done-without-payload', event.requestId)
          setMessages((prev) =>
            prev.map((message) =>
              message.id === event.requestId
                ? { ...message, content: 'No response tokens were received from Ollama. Check the selected model and local Ollama logs.' }
                : message
            )
          )
        } else {
          void (async () => {
            console.warn(OLLAMA_DEBUG_PREFIX, 'stream:empty-fallback', event.requestId, fallbackPayload)
            const fallbackRes = await window.api.generateOllama(fallbackPayload)
            console.log(OLLAMA_DEBUG_PREFIX, 'fallback:response', fallbackRes)

            if (!fallbackRes.success) {
              await refreshOllamaStatus()
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === event.requestId
                    ? { ...message, content: `Error: Ensure Ollama is running locally. ${fallbackRes.error || 'Fallback request failed.'}` }
                    : message
                )
              )
              return
            }

            const fallbackContent = extractOllamaTextResponse(fallbackRes.data)
            const backupModel = pickBackupChatModel(availableModels, String(fallbackPayload.model || ''))

            if (!fallbackContent && backupModel && !fallbackRetryRef.current) {
              fallbackRetryRef.current = true
              console.warn(OLLAMA_DEBUG_PREFIX, 'fallback:retry-backup-model', {
                requestId: event.requestId,
                currentModel: fallbackPayload.model,
                backupModel
              })

              const retryPayload = {
                ...fallbackPayload,
                model: backupModel
              }

              const retryRes = await window.api.generateOllama(retryPayload)
              console.log(OLLAMA_DEBUG_PREFIX, 'fallback:backup-response', retryRes)

              if (retryRes.success) {
                const retryContent = extractOllamaTextResponse(retryRes.data)
                if (retryContent) {
                  setSelectedModel(backupModel)
                  setMessages((prev) =>
                    prev.map((message) =>
                      message.id === event.requestId
                        ? { ...message, content: retryContent }
                        : message
                    )
                  )
                  return
                }
              }
            }

            setMessages((prev) =>
              prev.map((message) =>
                message.id === event.requestId
                  ? {
                      ...message,
                      content: fallbackContent || 'Ollama returned an empty response. Confirm the selected model can answer chat requests and that Ollama is still running.'
                    }
                  : message
              )
            )
          })()
        }
      }

      if (event.type === 'error') {
        setOllamaStatus('offline')
        setMessages((prev) =>
          prev.map((message) =>
            message.id === event.requestId
              ? { ...message, content: `Error: Ensure Ollama is running locally. ${event.error || 'Unknown error.'}` }
              : message
          )
        )
      }

      if (event.type === 'done' && event.doneReason === 'length' && activeResponseContentRef.current.trim() && requestPayloadRef.current) {
        truncatedAssistantIdsRef.current.add(event.requestId)
        void (async () => {
          let continuationBase = activeResponseContentRef.current
          let appendedContent = ''

          for (let attempt = 0; attempt < 2; attempt += 1) {
            const continuationPayload = {
              ...requestPayloadRef.current,
              stream: false,
              messages: [
                ...((requestPayloadRef.current?.messages as Array<{ role: string; content: string }>) || []),
                { role: 'assistant', content: continuationBase },
                {
                  role: 'user',
                  content:
                    'Continue exactly where you left off. Do not repeat earlier text. Finish the remaining sections and end cleanly.'
                }
              ],
              options: {
                ...((requestPayloadRef.current?.options as Record<string, unknown>) || {}),
                num_predict: CONTINUATION_MAX_TOKENS
              }
            }

            const continuationRes = await window.api.generateOllama(continuationPayload)
            console.log(OLLAMA_DEBUG_PREFIX, 'continuation:response', continuationRes)

            if (!continuationRes.success) break

            const continuationText = extractOllamaTextResponse(continuationRes.data)
            if (!continuationText) break

            appendedContent = `${appendedContent}${continuationText}`
            continuationBase = `${continuationBase}${continuationText}`

            if (continuationRes.data?.done_reason !== 'length') break
          }

          if (appendedContent) {
            activeResponseContentRef.current = `${activeResponseContentRef.current}${appendedContent}`
            setMessages((prev) =>
              prev.map((message) =>
                message.id === event.requestId
                  ? { ...message, content: `${message.content}${appendedContent}` }
                  : message
              )
            )
          }

          setAiLoading(false)
          activeRequestIdRef.current = null
          receivedChunkRef.current = false
          requestPayloadRef.current = null
          fallbackRetryRef.current = false
        })()
        return
      }

      if (event.type === 'done' || event.type === 'error') {
        setAiLoading(false)
        activeRequestIdRef.current = null
        receivedChunkRef.current = false
        requestPayloadRef.current = null
        fallbackRetryRef.current = false
        activeResponseContentRef.current = ''
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingSidebar) return
      const nextWidth = window.innerWidth - event.clientX
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth)))
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
    }

    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingSidebar])

  const loadWorkspace = async (path: string) => {
    try {
      setLoading(true)
      setError(null)

      const res = await window.api.getTerraformGraph(path)
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to generate graph')

      // Parse DOT
      const { nodes: initialNodes, edges: initialEdges } = parseDotToReactFlow(res.data)
      // Auto-layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges)

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
      setCwd(path)
      localStorage.setItem('terra-ai-last-workspace', path)

    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTerraform = async () => {
    const path = await window.api.selectDirectory()
    if (path) {
      await loadWorkspace(path)
    }
  }

  const handleApplyEdit = async (filename: string, content: string) => {
    try {
      if (!cwd) throw new Error("No workspace loaded")
      setLoading(true)
      const res = await window.api.writeWorkspaceFile(cwd, filename, content)
      if (!res.success) throw new Error(res.error)
      await loadWorkspace(cwd)
    } catch (err: any) {
      setError(`Failed to save file: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const clearConversation = () => {
    if (aiLoading) return
    setMessages([])
    setPrompt('')
    activeRequestIdRef.current = null
    receivedChunkRef.current = false
    requestPayloadRef.current = null
    fallbackRetryRef.current = false
    truncatedAssistantIdsRef.current = new Set()
    activeResponseContentRef.current = ''
  }

  const refreshOllamaStatus = async (): Promise<boolean> => {
    setOllamaStatus('checking')
    setOllamaError(null)

    const res = await window.api.listOllamaModels()
    console.log(OLLAMA_DEBUG_PREFIX, 'models:status', res)
    if (!res.success || !res.data) {
      setAvailableModels([])
      setOllamaStatus('offline')
      setOllamaError(res.error || 'Unable to reach Ollama')
      return false
    }

    const models = res.data
    setAvailableModels(models)
    setSelectedModel((current) => {
      if (models.includes(current)) return current
      return pickFastestModel(models)
    })

    if (models.length === 0) {
      setOllamaStatus('offline')
      setOllamaError('No Ollama models are installed.')
      return false
    }

    setOllamaStatus('ready')
    return true
  }

  const submitQuery = async (queryText: string) => {
    if (!queryText.trim() || aiLoading) return

    const ollamaReady = await refreshOllamaStatus()
    if (!ollamaReady) return

    // Optional: Only read and inject the heavy workspace context if we are at the start of a conversation
    let systemContext: ChatMessage[] = []
    if (cwd && messages.length === 0) {
      const res = await window.api.readWorkspaceFiles(cwd)
      if (res.success && res.data) {
        const trimmedContext = clampWorkspaceContext(res.data)
        systemContext.push({
          id: 'workspace-context',
          role: 'system',
          content: `You are an expert infrastructure AI analyzing the following Terraform workspace snapshot:\n\n${trimmedContext}\n\nRESPONSE STYLE:\n- Use markdown with short headings and bullets.\n- Use **bold** for key findings.\n- Use __underlines__ only for warnings or high-risk items.\n- Use ==highlights== for concrete actions.\n- Finish all major sections without trailing off.\n\nIMPORTANT CODE EDITING RULES:\n1. If you propose a code edit, you MUST encapsulate it in a markdown code block AND ensure the very first line of the code block is a continuous comment indicating the target filename relative to the workspace root (e.g. # main.tf or # vpc/main.tf).\n2. You MUST output the ENTIRE contents of the file, including all existing code unchanged. DO NOT omit existing code and DO NOT use placeholder comments. Produce the full file from top to bottom so the system can safely overwrite.`
        })
      }
    }

    systemContext.push({
      id: 'response-mode',
      role: 'system',
      content: INSIGHT_RESPONSE_INSTRUCTION
    })

    const requestId = `assistant-${Date.now()}`
    const newUserMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: queryText }
    const pendingAssistantMsg: ChatMessage = { id: requestId, role: 'assistant', content: '' }
    const updatedMessages = [...messages, newUserMsg, pendingAssistantMsg]
    const safeHistoryMessages = messages.filter((message) => {
      if (message.role !== 'assistant') return true
      return !truncatedAssistantIdsRef.current.has(message.id)
    })
    const ollamaMessages = [...systemContext, ...safeHistoryMessages, newUserMsg].map(({ role, content }) => ({ role, content }))
    
    // Add optimistic UI message
    setMessages(updatedMessages)
    setPrompt('')
    setAiLoading(true)
    activeRequestIdRef.current = requestId
    receivedChunkRef.current = false
    activeResponseContentRef.current = ''

    try {
      const ollamaPayload = {
        model: selectedModel,
        messages: ollamaMessages,
        stream: true,
        think: false,
        options: {
          num_predict: INSIGHT_MAX_TOKENS,
          temperature: 0.3
        }
      }
      console.log(OLLAMA_DEBUG_PREFIX, 'submit:payload', {
        requestId,
        model: selectedModel,
        messageCount: ollamaMessages.length,
        lastMessage: ollamaMessages[ollamaMessages.length - 1],
        options: ollamaPayload.options
      })
      requestPayloadRef.current = ollamaPayload

      const res = await window.api.streamOllama({
        requestId,
        ...ollamaPayload
      })
      console.log(OLLAMA_DEBUG_PREFIX, 'submit:stream-result', { requestId, res })

      if (!res.success) {
        throw new Error(res.error || 'Failed to connect to Ollama')
      }
      setOllamaStatus('ready')
    } catch (err: any) {
      console.error(err)
      setOllamaStatus('offline')
      setOllamaError(err.message)
      setAiLoading(false)
      activeRequestIdRef.current = null
      receivedChunkRef.current = false
      requestPayloadRef.current = null
      setMessages((prev) =>
        prev.map((message) =>
          message.id === requestId
            ? { ...message, content: `Error: Ensure Ollama is running locally. ${err.message}` }
            : message
        )
      )
    }
  }

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitQuery(prompt)
  }

  const onNodeClick = async (_: React.MouseEvent, node: any) => {
    const query = `Explain what ${node.data.label} is used for in this architecture and point out any potential security or cost optimization best practices.`
    await submitQuery(query)
  }

  const renderMessageContent = (content: string) => {
    const renderInlineContent = (text: string) => {
      const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|==[^=]+==)/g)

      return chunks.map((chunk, chunkIndex) => {
        if (chunk.startsWith('`') && chunk.endsWith('`')) {
          return (
            <code key={chunkIndex} className="rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[0.8rem] text-emerald-200 ring-1 ring-white/10 break-all [overflow-wrap:anywhere]">
              {chunk.slice(1, -1)}
            </code>
          )
        }

        if (chunk.startsWith('**') && chunk.endsWith('**')) {
          return (
            <strong key={chunkIndex} className="font-semibold text-white break-words [overflow-wrap:anywhere]">
              {chunk.slice(2, -2)}
            </strong>
          )
        }

        if (chunk.startsWith('__') && chunk.endsWith('__')) {
          return (
            <span key={chunkIndex} className="font-semibold underline decoration-indigo-400 decoration-2 underline-offset-4 text-indigo-100 break-words [overflow-wrap:anywhere]">
              {chunk.slice(2, -2)}
            </span>
          )
        }

        if (chunk.startsWith('==') && chunk.endsWith('==')) {
          return (
            <mark key={chunkIndex} className="rounded bg-amber-300/20 px-1 text-amber-100 break-words [overflow-wrap:anywhere]">
              {chunk.slice(2, -2)}
            </mark>
          )
        }

        return chunk
      })
    }

    const renderTextBlock = (text: string, key: string) => {
      const trimmed = text.trim()
      if (!trimmed) return null

      const lines = trimmed.split('\n').filter((line) => line.trim().length > 0)
      const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
      const isList = bulletLines.length === lines.length && lines.length > 0

      if (isList) {
        return (
          <ul key={key} className="my-3 space-y-2 w-full">
            {lines.map((line, index) => {
              const cleaned = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
              return (
                <li key={index} className="rounded-lg border border-indigo-500/20 bg-slate-900/70 px-3 py-2 text-slate-200">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-semibold text-indigo-200">
                    {index + 1}
                  </span>
                  <span className="break-words [overflow-wrap:anywhere]">{renderInlineContent(cleaned)}</span>
                </li>
              )
            })}
          </ul>
        )
      }

      if (trimmed.startsWith('### ')) {
        return (
          <h4 key={key} className="mt-3 mb-2 block w-full border-b border-indigo-400/60 pb-1 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-200 break-words [overflow-wrap:anywhere]">
            {renderInlineContent(trimmed.slice(4))}
          </h4>
        )
      }

      if (trimmed.startsWith('## ')) {
        return (
          <h3 key={key} className="mt-3 mb-2 block w-full border-b border-emerald-400/60 pb-1 text-base font-semibold text-emerald-200 break-words [overflow-wrap:anywhere]">
            {renderInlineContent(trimmed.slice(3))}
          </h3>
        )
      }

      if (trimmed.startsWith('# ')) {
        return (
          <h2 key={key} className="mt-3 mb-2 block w-full rounded bg-indigo-500/10 px-2 py-1 text-lg font-semibold text-white ring-1 ring-indigo-400/30 break-words [overflow-wrap:anywhere]">
            {renderInlineContent(trimmed.slice(2))}
          </h2>
        )
      }

      const labelMatch = trimmed.match(/^([A-Za-z][A-Za-z /-]{1,32}):\s*(.+)$/)
      if (labelMatch) {
        return (
          <div key={key} className="my-2 w-full rounded-lg border border-amber-400/20 bg-amber-300/10 px-3 py-2">
            <span className="mr-2 font-semibold text-amber-100 underline decoration-amber-300/70 underline-offset-4 break-words [overflow-wrap:anywhere]">
              {labelMatch[1]}:
            </span>
            <span className="text-slate-200 break-words [overflow-wrap:anywhere]">{renderInlineContent(labelMatch[2])}</span>
          </div>
        )
      }

      return (
        <p key={key} className="my-2 leading-7 text-slate-200 break-words [overflow-wrap:anywhere]">
          {renderInlineContent(trimmed)}
        </p>
      )
    }

    const parts = content.split(/(```[\s\S]*?```)/g)

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.split('\n')
        const langInfo = lines[0] || '```'
        const code = lines.slice(1, -1).join('\n')
        
        // Extract filepath from first line comment (e.g. # /workspace/main.tf )
        const firstLineMatch = code.match(/^#\s*(.+)$/m)
        const codeFilePath = firstLineMatch ? firstLineMatch[1].trim() : null

        return (
          <div key={index} className="my-3 rounded-xl overflow-hidden shadow-lg border border-slate-700 bg-slate-900 w-full">
            <div className="flex justify-between items-center bg-slate-950 px-3 py-2 border-b border-slate-700">
              <span className="text-xs text-slate-400 font-mono truncate">{codeFilePath || langInfo.replace('```', '') || 'code'}</span>
              {codeFilePath && (
                <button 
                  onClick={() => handleApplyEdit(codeFilePath, code)}
                  disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1 rounded transition-colors disabled:opacity-50 font-medium"
                >
                  Apply Edit
                </button>
              )}
            </div>
            <pre className="p-3 text-xs overflow-x-auto text-slate-300 font-mono leading-relaxed whitespace-pre bg-slate-900">
              {code}
            </pre>
          </div>
        )
      }

      const textBlocks = part.split(/\n\s*\n/)
      return (
        <div key={index} className="w-full">
          {textBlocks.map((block, blockIndex) => renderTextBlock(block, `${index}-${blockIndex}`))}
        </div>
      )
    })
  }

  return (
    <div className="flex h-screen w-screen bg-slate-900 border-t border-slate-800">
      
      {/* Primary Area - React Flow */}
      <div className="flex-1 flex flex-col relative h-full">
        {/* TopBar */}
        <header className="h-14 border-b border-white/5 bg-slate-900/50 backdrop-blur-md flex items-center px-4 justify-between z-10">
          <div className="flex items-center space-x-3">
            <div className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
            <h1 className="text-slate-200 font-medium tracking-wide">Terra-AI</h1>
          </div>
          <div className="flex items-center space-x-2">
            {cwd && (
              <button 
                onClick={() => loadWorkspace(cwd)} 
                disabled={loading}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus:ring-2 focus:ring-slate-500/50 disabled:opacity-50 flex items-center gap-2"
                title="Reload architecture graph from disk"
              >
                Refresh
              </button>
            )}
            <button 
              onClick={loadTerraform} 
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Load Workspace'}
            </button>
          </div>
        </header>

        {/* Canvas */}
        <main className="flex-1 relative">
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/80 border border-red-500/50 text-red-200 px-4 py-2 rounded shadow-lg backdrop-blur text-sm">
              {error}
            </div>
          )}
          
          {nodes.length === 0 && !loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-slate-500 text-center">
                <div className="text-4xl mb-3">🏔️</div>
                <p>Select a Terraform workspace to visualize</p>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-slate-950"
          >
            <Background color="#334155" gap={16} />
            <Controls className="bg-slate-800 border-slate-700 fill-slate-300!" />
            <MiniMap 
              nodeColor="#475569" 
              maskColor="rgba(15, 23, 42, 0.7)"
              className="bg-slate-900 border-slate-800 rounded-lg overflow-hidden shadow-2xl" 
            />
          </ReactFlow>

          {cwd && (
             <button 
               onClick={() => setShowAddModal(true)}
               className="absolute bottom-6 right-6 z-40 bg-indigo-600 hover:bg-indigo-500 text-white w-12 h-12 rounded-full shadow-[0_0_20px_rgba(79,70,229,0.5)] flex items-center justify-center text-3xl font-light transition-transform hover:scale-110"
               title="Magic Add Resource"
             >
               +
             </button>
          )}

          {showAddModal && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
              <div className="bg-slate-900 border border-slate-700 w-96 rounded-xl shadow-2xl overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                  <h3 className="text-slate-100 font-medium flex items-center gap-2">
                    <span className="text-indigo-400">✨</span> Magic Add Resource
                  </h3>
                  <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200">✕</button>
                </div>
                <div className="p-4 space-y-5">
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block uppercase tracking-wider font-semibold">Quick Presets</label>
                    <div className="flex flex-wrap gap-2">
                      {['S3 Bucket', 'EC2 Instance', 'RDS Database', 'VPC', 'IAM Role'].map(preset => (
                  <button 
                          key={preset}
                          onClick={() => {
                            if (aiLoading) return
                            setShowAddModal(false)
                            submitQuery(`Create a standard AWS ${preset} block and append it to main.tf. Please generate the full main.tf file with the modification.`)
                          }}
                          disabled={aiLoading}
                          className="bg-slate-800 hover:bg-indigo-500/20 hover:border-indigo-500/50 hover:text-indigo-200 border border-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-2 block uppercase tracking-wider font-semibold">Custom Request</label>
                    <form onSubmit={(e) => {
                      e.preventDefault()
                      if (!magicQuery.trim()) return
                      setShowAddModal(false)
                      submitQuery(`Create a standard ${magicQuery} block and append it to main.tf. Please generate the full main.tf file with the modification.`)
                      setMagicQuery('')
                    }}>
                      <input 
                        type="text"
                        placeholder="e.g. DynamoDB table"
                        value={magicQuery}
                        onChange={e => setMagicQuery(e.target.value)}
                        disabled={aiLoading}
                        className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600 shadow-inner"
                        autoFocus
                      />
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <div
        onMouseDown={() => setIsResizingSidebar(true)}
        className="w-2 cursor-col-resize bg-slate-950/80 transition-colors hover:bg-indigo-500/40 active:bg-indigo-400/50"
        title="Drag to resize AI Insights"
      >
        <div className="mx-auto mt-24 h-20 w-[3px] rounded-full bg-slate-700" />
      </div>

      {/* Sidebar - AI Integration Workspace (Scaffolded for Phase 3) */}
      <div
        className="border-l border-white/5 bg-slate-900 flex flex-col shadow-2xl z-20"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="p-4 border-b border-white/5 flex justify-between items-center">
          <div>
            <h2 className="text-slate-200 font-medium">AI Insights</h2>
            <div className="h-5 mt-1">
              {aiLoading ? (
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <span className="inline-block h-2 w-2 rounded-full bg-indigo-400 animate-pulse"></span>
                  Generating insight...
                </div>
              ) : ollamaStatus === 'checking' ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-slate-500 animate-pulse"></span>
                  Checking Ollama...
                </div>
              ) : ollamaStatus === 'offline' ? (
                <div className="text-xs text-amber-300">
                  Ollama unavailable
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Ready with {selectedModel}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button
              onClick={clearConversation}
              disabled={aiLoading || messages.length === 0}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear Chat
            </button>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={aiLoading || availableModels.length === 0}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-60"
            >
              {availableModels.length > 0 ? (
                availableModels
                  .slice()
                  .sort((a, b) => {
                    const preferredDelta = Number(isPreferredChatModel(b)) - Number(isPreferredChatModel(a))
                    if (preferredDelta !== 0) return preferredDelta
                    return scoreModelSpeed(b) - scoreModelSpeed(a)
                  })
                  .map((model, index) => (
                    <option key={model} value={model}>
                      {index === 0 ? `${model} (fastest installed)` : model}
                    </option>
                  ))
              ) : (
                <option value="llama3">No models found</option>
              )}
            </select>
          </div>
        </div>

        {ollamaError && !aiLoading && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {ollamaError}
          </div>
        )}
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-slate-500 mb-1">{m.role === 'user' ? 'You' : 'AI'}</span>
              <div 
                className={`rounded-xl p-3 text-sm flex flex-col items-start w-full min-w-0 break-words [overflow-wrap:anywhere] shadow-inner ${
                  m.role === 'user' 
                    ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100' 
                    : 'bg-slate-800 border border-slate-700 text-slate-300'
                }`}
              >
                {m.role === 'user' ? <span className="whitespace-pre-wrap leading-7 break-words [overflow-wrap:anywhere]">{m.content}</span> : <div className="w-full min-w-0 break-words [overflow-wrap:anywhere]">{m.content ? renderMessageContent(m.content) : <span className="text-slate-500">Waiting for first tokens...</span>}</div>}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-slate-500 text-xs text-center mt-10">
              Select a workspace and ask questions to diagnose issues.
            </p>
          )}
          {aiLoading && (
            <div className="flex flex-col items-start">
              <span className="text-xs text-slate-500 mb-1">AI</span>
              <div className="rounded-md p-3 text-sm flex items-center gap-2 w-full shadow-inner bg-slate-800 border border-slate-700 text-slate-300">
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.2s]"></span>
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.1s]"></span>
                <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce"></span>
                <span className="ml-1 text-slate-400">Thinking through your Terraform workspace...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleAskAI} className="p-3 border-t border-white/5">
          <input 
            type="text" 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              aiLoading
                ? 'Generating insight...'
                : ollamaStatus === 'ready'
                  ? 'Ask about your infrastructure...'
                  : 'Start Ollama and install a model to enable AI insights...'
            }
            disabled={aiLoading || ollamaStatus !== 'ready'}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </form>
      </div>

    </div>
  )
}

export default App
