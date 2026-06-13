const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')

// Dev: .env in project root. Packaged: %APPDATA%/Stickies/.env (user-writable, no admin needed)
const envPath = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(__dirname, '.env')
require('dotenv').config({ path: envPath })

const isDev = process.env.NODE_ENV === 'development'

// Hide from macOS Dock before ready so the icon never flashes
if (process.platform === 'darwin') app.dock.hide()

// ── Icon helpers ────────────────────────────────────────────────────────────

function buildTrayIcon() {
  // 16×16 thumbtack drawn as raw RGBA pixels — no file dependency
  const W = 16, H = 16
  const buf = Buffer.alloc(W * H * 4, 0) // all transparent

  function dot(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 4
    buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255
  }

  // Pin head — filled ellipse centred at (7.5, 4.5)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if ((x - 7.5) ** 2 / 20 + (y - 4.5) ** 2 / 14 <= 1) dot(x, y)

  // Pin shaft — two-pixel wide vertical line
  for (let y = 8; y <= 14; y++) { dot(7, y); dot(8, y) }

  const img = nativeImage.createFromBitmap(buf, { width: W, height: H })
  img.setTemplateImage(true) // auto light/dark on macOS menu bar
  return img
}

// ── File helpers ─────────────────────────────────────────────────────────────

function getStickiesDir() {
  const dir = process.env.STICKIES_DIR || path.join(app.getPath('userData'), 'notes')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function notePath(id) {
  return path.join(getStickiesDir(), `note-${id}.json`)
}

function readNote(id) {
  const p = notePath(id)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function writeNote(note) {
  note.updatedAt = new Date().toISOString()
  fs.writeFileSync(notePath(note.id), JSON.stringify(note, null, 2), 'utf-8')
}

function getAllNotes() {
  const dir = getStickiesDir()
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('note-') && f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) } catch { return null } })
    .filter(Boolean)
}

// ── Windows ──────────────────────────────────────────────────────────────────

const COLLAPSED_H = 32   // header-only height in px

const noteWindows = new Map()

function createNoteWindow(note) {
  const isCollapsed = note.collapsed || false

  const win = new BrowserWindow({
    x: Math.round(note.x ?? 100),
    y: Math.round(note.y ?? 100),
    width:     note.width  ?? 220,
    height:    isCollapsed ? COLLAPSED_H : (note.height ?? 220),
    minWidth:  160,
    minHeight: isCollapsed ? COLLAPSED_H : 120,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 8, y: 8 },
    transparent: true,
    alwaysOnTop: true,
    hasShadow: true,
    resizable: !isCollapsed,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const qs = `noteId=${note.id}&collapsed=${isCollapsed}`
  const url = isDev
    ? `http://localhost:5173/?${qs}`
    : `file://${path.join(__dirname, 'renderer/dist/index.html')}?${qs}`

  win.loadURL(url)

  if (isDev) win.webContents.openDevTools({ mode: 'detach' })

  noteWindows.set(note.id, win)

  win.on('focus', () => win.moveTop())

  win.on('moved', () => {
    const [x, y] = win.getPosition()
    const n = readNote(note.id)
    if (n) { n.x = x; n.y = y; writeNote(n) }
  })

  win.on('resized', () => {
    const [width, height] = win.getSize()
    const n = readNote(note.id)
    // don't overwrite the real height while the window is collapsed
    if (n && !n.collapsed) { n.width = width; n.height = height; writeNote(n) }
  })

  win.on('closed', () => noteWindows.delete(note.id))

  return win
}

function createNewNote() {
  const existing = noteWindows.size
  const note = {
    id: uuidv4(),
    content: '',
    color: 'yellow',
    x: 120 + existing * 30,
    y: 120 + existing * 30,
    width: 220,
    height: 220,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeNote(note)
  createNoteWindow(note)
  return note
}

// ── Toggle all windows (F9) ───────────────────────────────────────────────────

function toggleAllWindows() {
  const wins = [...noteWindows.values()].filter(w => !w.isDestroyed())
  if (wins.length === 0) return
  const anyVisible = wins.some(w => w.isVisible())
  if (anyVisible) {
    wins.forEach(w => w.hide())
  } else {
    wins.forEach(w => { w.show(); w.focus() })
  }
}

// ── Tray ─────────────────────────────────────────────────────────────────────

let tray = null

function buildTrayMenu() {
  const wins = [...noteWindows.values()].filter(w => !w.isDestroyed())
  const anyVisible = wins.some(w => w.isVisible())
  return Menu.buildFromTemplate([
    { label: 'New Note',               click: createNewNote },
    { type: 'separator' },
    { label: anyVisible ? 'Hide All' : 'Show All', click: toggleAllWindows },
    { type: 'separator' },
    { label: 'Quit Stickies',          click: () => app.quit() },
  ])
}

function setupTray() {
  tray = new Tray(buildTrayIcon())
  tray.setToolTip('Stickies')

  // Rebuild menu every time user opens it so Show/Hide label stays in sync
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()))
  tray.on('click',       () => tray.popUpContextMenu(buildTrayMenu()))

  // On Windows the context menu is set statically; refresh it on window events
  tray.setContextMenu(buildTrayMenu())
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  setupTray()

  globalShortcut.register('F9', toggleAllWindows)

  const notes = getAllNotes()
  if (notes.length === 0) {
    createNewNote()
  } else {
    notes.forEach(note => createNoteWindow(note))
  }
})

// Tray app — never quit when all note windows are closed
app.on('window-all-closed', () => { /* keep running in tray */ })

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-note',    (_, id)  => readNote(id))
ipcMain.handle('create-note', ()       => createNewNote())
ipcMain.handle('delete-note', (_, id) => {
  const p = notePath(id)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  const win = noteWindows.get(id)
  if (win && !win.isDestroyed()) win.close()
})
ipcMain.handle('update-note', (_, { id, content, color }) => {
  const note = readNote(id)
  if (!note) return null
  if (content !== undefined) note.content = content
  if (color !== undefined)   note.color   = color
  writeNote(note)
  return note
})
ipcMain.handle('set-collapsed', (_, { id, collapsed }) => {
  // Persist collapsed state (decouple from resize — don't let a read failure block resize)
  const note = readNote(id)
  if (note) {
    note.collapsed = collapsed
    writeNote(note)
  }

  const win = noteWindows.get(id)
  if (!win || win.isDestroyed()) return

  const [x, y] = win.getPosition()
  const [w]    = win.getSize()
  // animate only on macOS — on Windows, animate + transparent window breaks setSize
  const animate = process.platform === 'darwin'

  if (collapsed) {
    // Lower minSize FIRST, otherwise setSize is silently clamped on Windows
    win.setMinimumSize(1, 1)
    win.setResizable(false)
    win.setBounds({ x, y, width: w, height: COLLAPSED_H }, animate)
  } else {
    const expandH = (note && note.height) ? note.height : 220
    win.setMinimumSize(160, 120)
    win.setResizable(true)
    win.setBounds({ x, y, width: w, height: expandH }, animate)
  }
})

ipcMain.handle('set-color', (_, { id, color }) => {
  const note = readNote(id)
  if (!note) return
  note.color = color
  writeNote(note)
  const win = noteWindows.get(id)
  if (win && !win.isDestroyed()) win.webContents.send('color-changed', color)
})
