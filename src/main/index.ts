import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, resolve, sep } from 'path'
import { readdir, readFile, writeFile } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const execAsync = promisify(exec)
const OLLAMA_STREAM_EVENT = 'ollama:stream-event'
const OLLAMA_DEBUG_PREFIX = '[terra-ai:ollama]'
// Allow overriding the Ollama endpoint (e.g. OLLAMA_HOST=http://192.168.1.10:11434)
const OLLAMA_BASE_URL = process.env.OLLAMA_HOST?.replace(/\/+$/, '') || 'http://127.0.0.1:11434'

type OllamaTagResponse = {
  models?: Array<{
    name?: string
    model?: string
    size?: number
  }>
}

async function streamOllamaResponse(
  sender: Electron.WebContents,
  requestId: string,
  payload: Record<string, unknown>
): Promise<void> {
  console.log(OLLAMA_DEBUG_PREFIX, 'stream:start', requestId, {
    model: payload.model,
    stream: payload.stream,
    messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    options: payload.options
  })

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw new Error(`Ollama HTTP Error: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Ollama returned no response body')
  }

  const send = (event: Record<string, unknown>): void => {
    if (!sender.isDestroyed()) {
      sender.send(OLLAMA_STREAM_EVENT, { requestId, ...event })
    }
  }

  let doneSent = false

  const processLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: { message?: { content?: string }; done?: boolean; done_reason?: string }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      console.warn(OLLAMA_DEBUG_PREFIX, 'stream:unparseable-line', requestId, trimmed.slice(0, 200))
      return
    }

    const content = parsed.message?.content
    if (content) {
      send({ type: 'chunk', content })
    }

    if (parsed.done && !doneSent) {
      doneSent = true
      console.log(OLLAMA_DEBUG_PREFIX, 'stream:done', requestId, {
        doneReason: parsed.done_reason
      })
      send({ type: 'done', doneReason: parsed.done_reason })
    }
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(processLine)

    if (done) break
  }

  processLine(buffer)

  // Guarantee the renderer always gets a terminal event, even if the
  // stream ended without an explicit done message.
  if (!doneSent) {
    send({ type: 'done', doneReason: 'stream_end' })
  }
}

async function fetchOllamaModels(): Promise<string[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`)

  if (!response.ok) {
    throw new Error(`Ollama HTTP Error: ${response.status}`)
  }

  const data = (await response.json()) as OllamaTagResponse
  return (data.models || [])
    .map((model) => model.name || model.model)
    .filter((name): name is string => Boolean(name))
}

async function generateOllamaResponse(payload: Record<string, unknown>): Promise<any> {
  console.log(OLLAMA_DEBUG_PREFIX, 'generate:start', {
    model: payload.model,
    messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    options: payload.options
  })
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      stream: false
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama HTTP Error: ${response.status}`)
  }

  const data = await response.json()
  console.log(OLLAMA_DEBUG_PREFIX, 'generate:done', {
    model: data?.model,
    hasMessage: Boolean(data?.message),
    contentLength: typeof data?.message?.content === 'string' ? data.message.content.length : 0,
    preview: typeof data?.message?.content === 'string' ? data.message.content.slice(0, 120) : ''
  })

  return data
}

const SKIP_DIRS = new Set(['.terraform', '.git', 'node_modules'])
const MAX_TF_FILES = 200

// Recursively collect .tf / .tfvars / terragrunt.hcl files, returning
// workspace-relative paths. Skips vendored/hidden directories.
async function collectTerraformFiles(cwd: string, subdir = '', depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const results: string[] = []
  const entries = await readdir(join(cwd, subdir), { withFileTypes: true })

  for (const entry of entries) {
    if (results.length >= MAX_TF_FILES) break
    const relPath = subdir ? join(subdir, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      results.push(...(await collectTerraformFiles(cwd, relPath, depth + 1)))
    } else if (
      extname(entry.name) === '.tf' ||
      extname(entry.name) === '.tfvars' ||
      entry.name === 'terragrunt.hcl'
    ) {
      results.push(relPath)
    }
  }
  return results
}

// Resolve an untrusted relative filename inside the workspace, or null if it escapes.
function resolveInsideWorkspace(cwd: string, filename: string): string | null {
  const safeFilename = String(filename).replace(/^(\/|\\)+/, '')
  const workspaceRoot = resolve(cwd)
  const targetPath = resolve(workspaceRoot, safeFilename)
  if (targetPath !== workspaceRoot && !targetPath.startsWith(workspaceRoot + sep)) {
    return null
  }
  return targetPath
}

// Extract the HCL block for a graph node label like "aws_vpc.main",
// "data.aws_ami.ubuntu", or "module.network" by brace matching.
function extractHclBlock(content: string, label: string): string | null {
  let headerRegex: RegExp
  const dataMatch = label.match(/^data\.([\w-]+)\.([\w-]+)$/)
  const moduleMatch = label.match(/^module\.([\w-]+)/)
  const resourceMatch = label.match(/^([\w-]+)\.([\w-]+)$/)

  if (dataMatch) {
    headerRegex = new RegExp(`^\\s*data\\s+"${dataMatch[1]}"\\s+"${dataMatch[2]}"\\s*\\{`, 'm')
  } else if (moduleMatch) {
    headerRegex = new RegExp(`^\\s*module\\s+"${moduleMatch[1]}"\\s*\\{`, 'm')
  } else if (resourceMatch) {
    headerRegex = new RegExp(`^\\s*resource\\s+"${resourceMatch[1]}"\\s+"${resourceMatch[2]}"\\s*\\{`, 'm')
  } else {
    return null
  }

  const match = headerRegex.exec(content)
  if (!match) return null

  const start = match.index
  let depth = 0
  let inString = false
  for (let i = content.indexOf('{', start); i < content.length; i += 1) {
    const char = content[i]
    if (char === '"' && content[i - 1] !== '\\') inString = !inString
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return content.slice(start, i + 1).trim()
    }
  }
  return null
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.terra-ai.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled) { return null }
    return filePaths[0]
  })

  ipcMain.handle('terraform:graph', async (_, cwd) => {
    // Ensure brew path is loaded in electron environments
    const pathPrefix = process.platform === 'darwin' 
      ? 'export PATH=$PATH:/opt/homebrew/bin:/usr/local/bin && ' 
      : ''
      
    try {
      const { stdout } = await execAsync(`${pathPrefix}terraform graph`, { cwd })
      return { success: true, data: stdout }
    } catch (e: any) {
      // If terraform graph fails, it's frequently due to uninitialized modules or backends.
      // We will attempt to automatically run `terraform init -reconfigure` once and retry.
      try {
        console.log('Terraform graph failed, attempting auto-init...', e.message)
        await execAsync(`${pathPrefix}terraform init -reconfigure`, { cwd })
        const { stdout } = await execAsync(`${pathPrefix}terraform graph`, { cwd })
        return { success: true, data: stdout }
      } catch (retryError: any) {
        // If it still fails, bubble up the original or retry error
        return { success: false, error: e.message + '\n\nAuto-Init Retry Error: ' + retryError.message }
      }
    }
  })

  ipcMain.handle('workspace:readFiles', async (_, cwd) => {
    try {
      const tfFiles = await collectTerraformFiles(cwd)

      let contextStr = ''
      for (const relPath of tfFiles) {
        const content = await readFile(join(cwd, relPath), 'utf-8')
        contextStr += `\n--- ${relPath} ---\n${content}\n`
      }
      return { success: true, data: contextStr }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workspace:readFile', async (_, { cwd, filename }) => {
    try {
      const targetPath = resolveInsideWorkspace(cwd, filename)
      if (!targetPath) {
        return { success: false, error: `Refusing to read outside the workspace: ${filename}` }
      }
      const content = await readFile(targetPath, 'utf-8')
      return { success: true, data: content }
    } catch (e: any) {
      // Missing file is a normal case (AI proposing a brand-new file)
      if (e.code === 'ENOENT') return { success: true, data: '' }
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workspace:findResource', async (_, { cwd, label }) => {
    try {
      const tfFiles = await collectTerraformFiles(cwd)
      for (const relPath of tfFiles) {
        const content = await readFile(join(cwd, relPath), 'utf-8')
        const snippet = extractHclBlock(content, label)
        if (snippet) {
          return { success: true, data: { file: relPath, snippet } }
        }
      }
      return { success: true, data: null }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('terraform:plan', async (_, { cwd, refreshOnly }) => {
    const pathPrefix = process.platform === 'darwin'
      ? 'export PATH=$PATH:/opt/homebrew/bin:/usr/local/bin && '
      : ''
    const flags = refreshOnly ? ' -refresh-only' : ''
    const cmd = `${pathPrefix}terraform plan -input=false -lock=false -no-color -json${flags}`

    const runPlan = async (): Promise<{ stdout: string }> =>
      execAsync(cmd, { cwd, maxBuffer: 64 * 1024 * 1024 })

    try {
      let stdout: string
      try {
        ;({ stdout } = await runPlan())
      } catch (e: any) {
        // terraform plan exits non-zero on errors; try an init once, then retry
        await execAsync(`${pathPrefix}terraform init -reconfigure -input=false`, { cwd })
        ;({ stdout } = await runPlan())
      }

      const changes: Array<{ address: string; action: string }> = []
      let summary = ''
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: any
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (parsed.type === 'planned_change' && parsed.change?.resource?.addr) {
          changes.push({ address: parsed.change.resource.addr, action: parsed.change.action })
        }
        if (parsed.type === 'resource_drift' && parsed.change?.resource?.addr) {
          changes.push({ address: parsed.change.resource.addr, action: 'drift' })
        }
        if (parsed.type === 'change_summary' && typeof parsed['@message'] === 'string') {
          summary = parsed['@message']
        }
      }
      return { success: true, data: { changes, summary } }
    } catch (e: any) {
      return { success: false, error: e.stderr || e.message }
    }
  })

  ipcMain.handle('terraform:validate', async (_, { cwd, filename }) => {
    const pathPrefix = process.platform === 'darwin'
      ? 'export PATH=$PATH:/opt/homebrew/bin:/usr/local/bin && '
      : ''
    const result: { formatted: boolean; valid: boolean; diagnostics: string[] } = {
      formatted: false,
      valid: true,
      diagnostics: []
    }

    if (filename) {
      const targetPath = resolveInsideWorkspace(cwd, filename)
      if (targetPath) {
        try {
          await execAsync(`${pathPrefix}terraform fmt "${targetPath.replace(/"/g, '')}"`, { cwd })
          result.formatted = true
        } catch {
          // fmt failing (e.g. syntax error) is reported by validate below
        }
      }
    }

    try {
      const { stdout } = await execAsync(`${pathPrefix}terraform validate -json`, { cwd })
      const parsed = JSON.parse(stdout)
      result.valid = Boolean(parsed.valid)
      result.diagnostics = (parsed.diagnostics || []).map((d: any) => {
        const where = d.range?.filename ? ` [${d.range.filename}:${d.range.start?.line || '?'}]` : ''
        return `${d.severity}: ${d.summary}${d.detail ? ` — ${d.detail}` : ''}${where}`
      })
    } catch (e: any) {
      // validate also exits non-zero with JSON diagnostics on stdout
      try {
        const parsed = JSON.parse(e.stdout || '{}')
        result.valid = Boolean(parsed.valid)
        result.diagnostics = (parsed.diagnostics || []).map((d: any) => {
          const where = d.range?.filename ? ` [${d.range.filename}:${d.range.start?.line || '?'}]` : ''
          return `${d.severity}: ${d.summary}${d.detail ? ` — ${d.detail}` : ''}${where}`
        })
      } catch {
        return { success: false, error: e.stderr || e.message }
      }
    }
    return { success: true, data: result }
  })

  ipcMain.handle('security:scan', async (_, cwd) => {
    const pathPrefix = process.platform === 'darwin'
      ? 'export PATH=$PATH:/opt/homebrew/bin:/usr/local/bin && '
      : ''
    try {
      let stdout = ''
      try {
        ;({ stdout } = await execAsync(`${pathPrefix}tfsec . --format json --no-color`, {
          cwd,
          maxBuffer: 32 * 1024 * 1024
        }))
      } catch (e: any) {
        // tfsec exits 1 when it finds issues but still prints JSON
        if (e.stdout && e.stdout.trim().startsWith('{')) {
          stdout = e.stdout
        } else if (/not found|command not found/i.test(e.stderr || e.message)) {
          return { success: false, error: 'tfsec is not installed. Install it with: brew install tfsec' }
        } else {
          throw e
        }
      }
      const parsed = JSON.parse(stdout)
      const findings = (parsed.results || []).map((r: any) => ({
        ruleId: r.rule_id || r.long_id || 'unknown',
        severity: r.severity || 'UNKNOWN',
        description: r.description || r.rule_description || '',
        resource: r.resource || '',
        file: r.location?.filename || '',
        line: r.location?.start_line || 0
      }))
      return { success: true, data: findings }
    } catch (e: any) {
      return { success: false, error: e.stderr || e.message }
    }
  })

  ipcMain.handle('workspace:writeFile', async (_, { cwd, filename, content }) => {
    try {
      // The filename comes from AI output, so treat it as untrusted.
      const targetPath = resolveInsideWorkspace(cwd, filename)
      if (!targetPath) {
        return { success: false, error: `Refusing to write outside the workspace: ${filename}` }
      }

      await writeFile(targetPath, content, 'utf-8')
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('ollama:stream', async (event, payload) => {
    try {
      const { requestId, ...ollamaPayload } = payload
      await streamOllamaResponse(event.sender, requestId, ollamaPayload)
      return { success: true }
    } catch (e: any) {
      event.sender.send(OLLAMA_STREAM_EVENT, {
        requestId: payload.requestId,
        type: 'error',
        error: e.message
      })
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('ollama:listModels', async () => {
    try {
      const models = await fetchOllamaModels()
      console.log(OLLAMA_DEBUG_PREFIX, 'models:list', models)
      return { success: true, data: models }
    } catch (e: any) {
      console.error(OLLAMA_DEBUG_PREFIX, 'models:error', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('ollama:generate', async (_, payload) => {
    try {
      const data = await generateOllamaResponse(payload)
      return { success: true, data }
    } catch (e: any) {
      console.error(OLLAMA_DEBUG_PREFIX, 'generate:error', e.message)
      return { success: false, error: e.message }
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
