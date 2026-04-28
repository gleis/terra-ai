import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import { readdir, readFile, writeFile } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const execAsync = promisify(exec)

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
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

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
      // Ensure we have an absolute path targeting the workspace directory
      // If the AI returns an absolute path, join might just append it so we should 
      // check if filename is absolute, but joining safely usually strips leading slashes in path.join if intended, 
      // actually path.join('/my/cwd', '/my/target.tf') resolves to '/my/target.tf' in posix.
      // So we will just strip leading slashes and force it to be relative to cwd.
      const safeFilename = filename.replace(/^(\/|\\)+/, '')
      const targetPath = join(cwd, safeFilename)

      await writeFile(targetPath, content, 'utf-8')
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('ollama:generate', async (_, payload) => {
    try {
      // Use Node's built in fetch in the main process to completely bypass CORS 
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        throw new Error(`Ollama HTTP Error: ${response.status}`)
      }
      const data = await response.json()
      return { success: true, data }
    } catch (e: any) {
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
