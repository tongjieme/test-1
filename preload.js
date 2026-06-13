const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stickiesAPI', {
  getNote:     (id)   => ipcRenderer.invoke('get-note', id),
  updateNote:  (data) => ipcRenderer.invoke('update-note', data),
  deleteNote:  (id)   => ipcRenderer.invoke('delete-note', id),
  createNote:  ()     => ipcRenderer.invoke('create-note'),
  setColor:    (data) => ipcRenderer.invoke('set-color', data),
  setCollapsed:(data) => ipcRenderer.invoke('set-collapsed', data),
  getGroups:   ()     => ipcRenderer.invoke('get-groups'),
  moveToGroup: (data) => ipcRenderer.invoke('move-to-group', data),
  onColorChanged: (cb) => {
    const handler = (_, color) => cb(color)
    ipcRenderer.on('color-changed', handler)
    return () => ipcRenderer.removeListener('color-changed', handler)
  },
})
