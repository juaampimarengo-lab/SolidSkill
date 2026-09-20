import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { Database } from './persistence'

const DATABASE_FILENAME = 'solid-skill.db'

// Owned by the main process only. The renderer never sees this connection;
// a narrow IPC boundary will be added in a later checkpoint.
let database: Database | null = null

function initializePersistence(): void {
  const path = join(app.getPath('userData'), DATABASE_FILENAME)
  try {
    database = Database.open(path)
    const { schemaVersion, migrationsAppliedThisOpen, journalMode, foreignKeys } = database.health
    console.info(
      `[persistence] opened ${path} (schema v${schemaVersion}, journal=${journalMode}, ` +
        `foreign_keys=${foreignKeys ? 'on' : 'off'}, migrations applied this start: ` +
        `${migrationsAppliedThisOpen.length === 0 ? 'none' : migrationsAppliedThisOpen.join(', ')})`
    )
  } catch (error) {
    // Fail safe: the app keeps running on its existing renderer data, and the
    // failure is visible in the log. No recovery UI at this checkpoint.
    database = null
    console.error(`[persistence] failed to initialize database at ${path}`, error)
  }
}

function closePersistence(): void {
  if (database === null) return
  try {
    database.close()
    console.info('[persistence] database closed')
  } catch (error) {
    console.error('[persistence] error while closing database', error)
  }
  database = null
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B0C0E',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initializePersistence()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', closePersistence)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
