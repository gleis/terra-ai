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
  const [messages, setMessages] = useState<{role: 'user' | 'assistant' | 'system', content: string}[]>([])
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, aiLoading])

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

  const submitQuery = async (queryText: string) => {
    if (!queryText.trim() || aiLoading) return

    const selectedModel = (document.getElementById('model-select') as HTMLSelectElement).value

    // Optional: Only read and inject the heavy workspace context if we are at the start of a conversation
    let systemContext: {role: 'system', content: string}[] = []
    if (cwd && messages.length === 0) {
      const res = await window.api.readWorkspaceFiles(cwd)
      if (res.success && res.data) {
        systemContext.push({
          role: 'system',
          content: `You are an expert infrastructure AI analyzing the following Terraform workspace:\n\n${res.data}\n\nIMPORTANT CODE EDITING RULES:\n1. If you propose a code edit, you MUST encapsulate it in a markdown code block AND ensure the very first line of the code block is a continuous comment indicating the target filename relative to the workspace root (e.g. # main.tf or # vpc/main.tf).\n2. You MUST output the ENTIRE contents of the file, including all existing code unchanged. DO NOT omit existing code and DO NOT use placeholder comments. Produce the full file from top to bottom so the system can safely overwrite.`
        })
      }
    }

    const newUserMsg : {role: 'user' | 'assistant' | 'system', content: string} = { role: 'user', content: queryText }
    const updatedMessages = [...messages, newUserMsg]
    
    // Add optimistic UI message
    setMessages(updatedMessages)
    setPrompt('')
    setAiLoading(true)

    try {
      const res = await window.api.queryOllama({
        model: selectedModel,
        messages: [...systemContext, ...updatedMessages],
        stream: false
      })

      if (!res.success) {
        throw new Error(res.error || 'Failed to connect to Ollama')
      }

      const aiResponse = res.data.message?.content || 'I encountered an error replying.'
      setMessages((prev) => [...prev, { role: 'assistant', content: aiResponse }])
    } catch (err: any) {
      console.error(err)
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: Ensure Ollama is running locally. ${err.message}` }])
    } finally {
      setAiLoading(false)
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
            <code key={chunkIndex} className="rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[0.8rem] text-emerald-200 ring-1 ring-white/10">
              {chunk.slice(1, -1)}
            </code>
          )
        }

        if (chunk.startsWith('**') && chunk.endsWith('**')) {
          return (
            <strong key={chunkIndex} className="font-semibold text-white">
              {chunk.slice(2, -2)}
            </strong>
          )
        }

        if (chunk.startsWith('__') && chunk.endsWith('__')) {
          return (
            <span key={chunkIndex} className="font-semibold underline decoration-indigo-400 decoration-2 underline-offset-4 text-indigo-100">
              {chunk.slice(2, -2)}
            </span>
          )
        }

        if (chunk.startsWith('==') && chunk.endsWith('==')) {
          return (
            <mark key={chunkIndex} className="rounded bg-amber-300/20 px-1 text-amber-100">
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
                  {renderInlineContent(cleaned)}
                </li>
              )
            })}
          </ul>
        )
      }

      if (trimmed.startsWith('### ')) {
        return (
          <h4 key={key} className="mt-3 mb-2 inline-block border-b border-indigo-400/60 pb-1 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-200">
            {renderInlineContent(trimmed.slice(4))}
          </h4>
        )
      }

      if (trimmed.startsWith('## ')) {
        return (
          <h3 key={key} className="mt-3 mb-2 inline-block border-b border-emerald-400/60 pb-1 text-base font-semibold text-emerald-200">
            {renderInlineContent(trimmed.slice(3))}
          </h3>
        )
      }

      if (trimmed.startsWith('# ')) {
        return (
          <h2 key={key} className="mt-3 mb-2 inline-block rounded bg-indigo-500/10 px-2 py-1 text-lg font-semibold text-white ring-1 ring-indigo-400/30">
            {renderInlineContent(trimmed.slice(2))}
          </h2>
        )
      }

      const labelMatch = trimmed.match(/^([A-Za-z][A-Za-z /-]{1,32}):\s*(.+)$/)
      if (labelMatch) {
        return (
          <div key={key} className="my-2 w-full rounded-lg border border-amber-400/20 bg-amber-300/10 px-3 py-2">
            <span className="mr-2 font-semibold text-amber-100 underline decoration-amber-300/70 underline-offset-4">
              {labelMatch[1]}:
            </span>
            <span className="text-slate-200">{renderInlineContent(labelMatch[2])}</span>
          </div>
        )
      }

      return (
        <p key={key} className="my-2 leading-7 text-slate-200">
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
              ) : (
                <div className="text-xs text-slate-500">Ready</div>
              )}
            </div>
          </div>
          <select id="model-select" className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none">
            <option value="gemma4">gemma4</option>
            <option value="llama3">llama3</option>
          </select>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-slate-500 mb-1">{m.role === 'user' ? 'You' : 'AI'}</span>
              <div 
                className={`rounded-xl p-3 text-sm flex flex-col items-start w-full shadow-inner ${
                  m.role === 'user' 
                    ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100' 
                    : 'bg-slate-800 border border-slate-700 text-slate-300'
                }`}
              >
                {m.role === 'user' ? <span className="whitespace-pre-wrap leading-7">{m.content}</span> : <div className="w-full">{renderMessageContent(m.content)}</div>}
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
            placeholder={aiLoading ? "Generating insight..." : "Ask about your infrastructure..."}
            disabled={aiLoading}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </form>
      </div>

    </div>
  )
}

export default App
