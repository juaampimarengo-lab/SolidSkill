import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { Database } from './persistence'
import { startMt5BridgeFromEnvironment, type Mt5Receiver } from './integrations/mt5'
import { startDevImportGateFromEnvironment, type DevImportGate } from './integrations/mt5/import/devImportGate'
import { registerStrategyIpc } from './ipc/registerStrategyIpc'
import { registerTradeIpc } from './ipc/registerTradeIpc'
import { seedDevelopmentStrategies } from './strategies/devSeed'
import { StrategyService } from './strategies/strategyService'
import { seedDevelopmentTrading } from './trading/devSeed'
import { TradingService } from './trading/tradingService'

const DATABASE_FILENAME = 'solid-skill.db'

// An unpackaged (development) run uses its own userData folder so development
// seed data can never land in the production-named database. An explicit
// --user-data-dir (used by QA scripts) always wins.
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'solid-skill-dev'))
}

// Owned by the main process only. The renderer never sees this connection;
// it reaches Strategy and Trading data only through the typed IPC in src/main/ipc.
let database: Database | null = null
let strategyService: StrategyService | null = null
let tradingService: TradingService | null = null
// MT5 read-only raw-deal bridge (spike). Opt-in via SOLID_SKILL_MT5_BRIDGE=1;
// never exposed to the renderer and never wired into the Trade repositories.
let mt5Bridge: Mt5Receiver | null = null
// DEVELOPMENT-ONLY explicit live-staging import gate (docs/MT5_IMPORT.md §14). Started only for an
// unpackaged build with SOLID_SKILL_MT5_DEV_IMPORT=1; it acts only on a fresh, confirmed request file.
let devImportGate: DevImportGate | null = null

function initializePersistence(): void {
  const path = join(app.getPath('userData'), DATABASE_FILENAME)
  try {
    database = Database.open(path)
    strategyService = new StrategyService(database)
    tradingService = new TradingService(database)
    const { schemaVersion, migrationsAppliedThisOpen, journalMode, foreignKeys } = database.health
    console.info(
      `[persistence] opened ${path} (schema v${schemaVersion}, journal=${journalMode}, ` +
        `foreign_keys=${foreignKeys ? 'on' : 'off'}, migrations applied this start: ` +
        `${migrationsAppliedThisOpen.length === 0 ? 'none' : migrationsAppliedThisOpen.join(', ')})`
    )
    // Development-only demo data: unpackaged runs only, into the separate dev database.
    if (!app.isPackaged && process.env['SOLID_SKILL_DEV_SEED'] !== '0') {
      try {
        if (seedDevelopmentStrategies(database)) console.info('[persistence] development seed applied (empty strategies table)')
      } catch (error) {
        console.error('[persistence] development seed failed; database left usable', error)
      }
      try {
        const result = seedDevelopmentTrading(database)
        if (result.status === 'seeded') console.info(`[persistence] development trading seed applied (${result.trades} trades)`)
        else if (result.status === 'skipped') console.warn(`[persistence] development trading seed skipped: ${result.reason}`)
      } catch (error) {
        console.error('[persistence] development trading seed failed; database left usable', error)
      }
    }
  } catch (error) {
    // Fail safe: the app still starts, the failure is logged, and every IPC
    // call reports PERSISTENCE_UNAVAILABLE (the renderer shows an error, it
    // does not fall back to fixtures). No recovery UI yet.
    database = null
    strategyService = null
    tradingService = null
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
  strategyService = null
  tradingService = null
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
      preload: join(__dirname, '../preload/index.mjs'),
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
  registerStrategyIpc({
    getService: () => strategyService,
    log: (message, error) => console.error(`[ipc] ${message}`, error)
  })
  registerTradeIpc({
    getService: () => tradingService,
    log: (message, error) => console.error(`[ipc] ${message}`, error)
  })
  void startMt5BridgeFromEnvironment(process.env, (message) => console.info(`[mt5] ${message}`), {
    isDevelopment: !app.isPackaged,
    baseDir: process.cwd()
  }).then((receiver) => {
    mt5Bridge = receiver
  })
  devImportGate = startDevImportGateFromEnvironment(process.env, !app.isPackaged, {
    baseDir: process.cwd(),
    getReceiver: () => mt5Bridge,
    getDatabase: () => database,
    log: (message) => console.info(`[mt5-import] ${message}`)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  devImportGate?.stop()
  devImportGate = null
  void mt5Bridge?.stop()
  mt5Bridge = null
  closePersistence()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
