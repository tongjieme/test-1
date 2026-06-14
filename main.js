const { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, nativeImage, dialog, shell } = require('electron')
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
  const W = 16, H = 16
  const buf = Buffer.alloc(W * H * 4, 0)

  function dot(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 4
    buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255
  }

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if ((x - 7.5) ** 2 / 20 + (y - 4.5) ** 2 / 14 <= 1) dot(x, y)

  for (let y = 8; y <= 14; y++) { dot(7, y); dot(8, y) }

  const img = nativeImage.createFromBitmap(buf, { width: W, height: H })
  img.setTemplateImage(true)
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

// ── Groups ────────────────────────────────────────────────────────────────────

function getGroupsFile() {
  return path.join(getStickiesDir(), 'groups.json')
}

function readGroups() {
  const p = getGroupsFile()
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return [] }
}

function writeGroups(groups) {
  fs.writeFileSync(getGroupsFile(), JSON.stringify(groups, null, 2), 'utf-8')
}

// ── App state ─────────────────────────────────────────────────────────────────

function getAppStateFile() {
  return path.join(getStickiesDir(), 'app-state.json')
}

function readAppState() {
  const p = getAppStateFile()
  if (!fs.existsSync(p)) return { activeGroupId: null }
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return { activeGroupId: null } }
}

function writeAppState(state) {
  fs.writeFileSync(getAppStateFile(), JSON.stringify(state, null, 2), 'utf-8')
}

let activeGroupId = null

// ── Prompt dialog ─────────────────────────────────────────────────────────────

function showPromptDialog({ title, defaultValue = '', placeholder = '' }) {
  return new Promise((resolve) => {
    const safe = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:14px;background:#f5f5f5}
label{font-size:13px;display:block;margin-bottom:8px;color:#333}
input{width:100%;font-size:13px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;outline:none}
input:focus{border-color:#007aff;box-shadow:0 0 0 2px rgba(0,122,255,.2)}
.btns{margin-top:10px;display:flex;gap:6px;justify-content:flex-end}
button{font-size:12px;padding:4px 14px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer}
.ok{background:#007aff;color:#fff;border-color:#007aff}
</style></head><body>
<label>${safe(title)}</label>
<input id="v" type="text" placeholder="${safe(placeholder)}" value="${safe(defaultValue)}" />
<div class="btns">
  <button id="cancel">Cancel</button>
  <button class="ok" id="ok">OK</button>
</div>
<script>
const inp=document.getElementById('v')
inp.select();inp.focus()
function submit(){window.promptAPI.submit(inp.value)}
function cancel(){window.promptAPI.cancel()}
document.getElementById('ok').addEventListener('click',submit)
document.getElementById('cancel').addEventListener('click',cancel)
inp.addEventListener('keydown',e=>{if(e.key==='Enter')submit();if(e.key==='Escape')cancel()})
</script></body></html>`

    const promptWin = new BrowserWindow({
      width: 300,
      height: 112,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      title,
      webPreferences: {
        preload: path.join(__dirname, 'prompt-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    promptWin.setMenuBarVisibility(false)
    promptWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    let resolved = false
    const done = (value) => {
      if (resolved) return
      resolved = true
      resolve(value)
      if (!promptWin.isDestroyed()) promptWin.close()
    }

    ipcMain.once('prompt-submit', (_, value) => done(value.trim() || null))
    ipcMain.once('prompt-cancel', () => done(null))
    promptWin.on('closed', () => done(null))
  })
}

// ── Active group switch ───────────────────────────────────────────────────────

function switchActiveGroup(groupId) {
  activeGroupId = groupId
  writeAppState({ activeGroupId })

  for (const [id, win] of noteWindows) {
    if (win.isDestroyed()) continue
    const note = readNote(id)
    if (!note) continue
    const belongs = (note.groupId ?? null) === groupId
    if (belongs) win.show()
    else win.hide()
  }

  if (tray) tray.setContextMenu(buildTrayMenu())
}

// ── Windows ──────────────────────────────────────────────────────────────────

const COLLAPSED_H = 32

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
    show: false,
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

  win.once('ready-to-show', () => {
    if ((note.groupId ?? null) === activeGroupId) win.show()
  })

  win.on('focus', () => win.moveTop())

  win.on('moved', () => {
    const [x, y] = win.getPosition()
    const n = readNote(note.id)
    if (n) { n.x = x; n.y = y; writeNote(n) }
  })

  win.on('resized', () => {
    const [width, height] = win.getSize()
    const n = readNote(note.id)
    if (n && !n.collapsed) { n.width = width; n.height = height; writeNote(n) }
  })

  win.on('closed', () => noteWindows.delete(note.id))

  return win
}

function createNewNote(type = 'text') {
  const existing = noteWindows.size
  const note = {
    id: uuidv4(),
    type,
    content: '',
    color: 'yellow',
    groupId: activeGroupId,
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
  const wins = [...noteWindows.entries()]
    .filter(([id, w]) => {
      if (w.isDestroyed()) return false
      const n = readNote(id)
      return n && (n.groupId ?? null) === activeGroupId
    })
    .map(([_, w]) => w)

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
  const groups = readGroups()
  const activeWins = [...noteWindows.entries()]
    .filter(([id, w]) => {
      if (w.isDestroyed()) return false
      const n = readNote(id)
      return n && (n.groupId ?? null) === activeGroupId
    })
    .map(([_, w]) => w)
  const anyVisible = activeWins.some(w => w.isVisible())

  const groupRadios = [
    {
      label: 'Ungrouped',
      type: 'radio',
      checked: activeGroupId === null,
      click: () => switchActiveGroup(null),
    },
    ...groups.map(g => ({
      label: g.name,
      type: 'radio',
      checked: activeGroupId === g.id,
      click: () => switchActiveGroup(g.id),
    })),
  ]

  return Menu.buildFromTemplate([
    { label: 'New Note', click: createNewNote },
    { type: 'separator' },
    ...groupRadios,
    { type: 'separator' },
    {
      label: 'New Group…',
      click: async () => {
        const name = await showPromptDialog({ title: 'New Group', placeholder: 'Group name' })
        if (!name) return
        const group = { id: uuidv4(), name, createdAt: new Date().toISOString() }
        const all = readGroups()
        all.push(group)
        writeGroups(all)
        switchActiveGroup(group.id)
        createNewNote()
      },
    },
    {
      label: 'Rename Group…',
      enabled: activeGroupId !== null,
      click: async () => {
        if (!activeGroupId) return
        const group = readGroups().find(g => g.id === activeGroupId)
        if (!group) return
        const name = await showPromptDialog({ title: 'Rename Group', defaultValue: group.name })
        if (!name || name === group.name) return
        const all = readGroups()
        const target = all.find(g => g.id === activeGroupId)
        if (target) { target.name = name; writeGroups(all) }
        if (tray) tray.setContextMenu(buildTrayMenu())
      },
    },
    {
      label: 'Delete Group…',
      enabled: activeGroupId !== null,
      click: () => {
        if (!activeGroupId) return
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0,
          message: 'Are you sure you want to delete this group?',
        })
        if (choice !== 1) return

        const notes = getAllNotes().filter(n => (n.groupId ?? null) === activeGroupId)
        for (const note of notes) {
          const p = notePath(note.id)
          if (fs.existsSync(p)) fs.unlinkSync(p)
          const win = noteWindows.get(note.id)
          if (win && !win.isDestroyed()) win.close()
          noteWindows.delete(note.id)
        }

        const remaining = readGroups().filter(g => g.id !== activeGroupId)
        writeGroups(remaining)
        switchActiveGroup(null)
      },
    },
    { type: 'separator' },
    { label: anyVisible ? 'Hide All' : 'Show All', click: toggleAllWindows },
    { type: 'separator' },
    { label: 'Quit Stickies', click: () => app.quit() },
  ])
}

function setupTray() {
  tray = new Tray(buildTrayIcon())
  tray.setToolTip('Stickies')

  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()))
  tray.on('click',       () => tray.popUpContextMenu(buildTrayMenu()))

  tray.setContextMenu(buildTrayMenu())
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const state = readAppState()
  const savedGroupId = state.activeGroupId ?? null

  // Validate: fall back to null if saved group no longer exists
  if (savedGroupId !== null) {
    const groups = readGroups()
    activeGroupId = groups.find(g => g.id === savedGroupId) ? savedGroupId : null
  }

  setupTray()
  globalShortcut.register('F9', toggleAllWindows)

  const notes = getAllNotes()
  if (notes.length === 0) {
    createNewNote()
  } else {
    notes.forEach(note => createNoteWindow(note))
  }
})

app.on('window-all-closed', () => { /* keep running in tray */ })

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-note', (_, id) => readNote(id))

ipcMain.handle('get-groups', () => readGroups())

ipcMain.handle('create-note', (_, type = 'text') => createNewNote(type))

ipcMain.handle('open-path', (_, filePath) => shell.openPath(filePath))

ipcMain.handle('delete-note', (_, id) => {
  const note = readNote(id)
  if (note) {
    const groupId = note.groupId ?? null
    const count = getAllNotes().filter(n => (n.groupId ?? null) === groupId).length
    if (count <= 1) return { error: 'last-in-group' }
  }
  const p = notePath(id)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  const win = noteWindows.get(id)
  if (win && !win.isDestroyed()) win.close()
  return { ok: true }
})

ipcMain.handle('update-note', (_, { id, content, color }) => {
  const note = readNote(id)
  if (!note) return null
  if (content !== undefined) note.content = content
  if (color   !== undefined) note.color   = color
  writeNote(note)
  return note
})

ipcMain.handle('move-to-group', (_, { id, targetGroupId }) => {
  const note = readNote(id)
  if (!note) return { error: 'not-found' }

  const currentGroupId = note.groupId ?? null
  const target = targetGroupId ?? null
  if (currentGroupId === target) return { ok: true }

  const count = getAllNotes().filter(n => (n.groupId ?? null) === currentGroupId).length
  if (count <= 1) return { error: 'last-in-group' }

  note.groupId = target
  writeNote(note)

  const win = noteWindows.get(id)
  if (win && !win.isDestroyed() && target !== activeGroupId) win.hide()

  return { ok: true }
})

ipcMain.handle('set-collapsed', (_, { id, collapsed }) => {
  const note = readNote(id)
  if (note) {
    note.collapsed = collapsed
    writeNote(note)
  }

  const win = noteWindows.get(id)
  if (!win || win.isDestroyed()) return

  const [x, y] = win.getPosition()
  const [w]    = win.getSize()
  const animate = process.platform === 'darwin'

  if (collapsed) {
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
