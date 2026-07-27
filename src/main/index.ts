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
      const files = await readdir(cwd)
      const tfFiles = files.filter(f => extname(f) === '.tf' || f === 'terragrunt.hcl')
      
      let contextStr = ''
      for (const file of tfFiles) {
        const content = await readFile(join(cwd, file), 'utf-8')
        contextStr += `\n--- ${file} ---\n${content}\n`
      }
      return { success: true, data: contextStr }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('workspace:writeFile', async (_, { cwd, filename, content }) => {
    try {
      // The filename comes from AI output, so treat it as untrusted. Strip any
      // leading slashes, then resolve and verify the final path stays inside
      // the workspace (blocks absolute paths and ../ traversal).
      const safeFilename = String(filename).replace(/^(\/|\\)+/, '')
      const workspaceRoot = resolve(cwd)
      const targetPath = resolve(workspaceRoot, safeFilename)

      if (targetPath !== workspaceRoot && !targetPath.startsWith(workspaceRoot + sep)) {
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
