import { useState, useEffect, useRef, useCallback } from 'react'

const COLORS = {
  yellow: { bg: '#FFF9A3', header: '#F5E53A', text: '#5C4A00' },
  blue:   { bg: '#BFD9FF', header: '#7AB8FF', text: '#002B66' },
  green:  { bg: '#C8F5C8', header: '#82DD82', text: '#1A421A' },
  pink:   { bg: '#FFD0E0', header: '#FF96B8', text: '#550030' },
  gray:   { bg: '#E5E5E5', header: '#BBBBBB', text: '#282828' },
  purple: { bg: '#E2D0FF', header: '#B894FF', text: '#2A0060' },
}

function useDebounce(fn, delay) {
  const timer = useRef(null)
  return useCallback((...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

const params = new URLSearchParams(window.location.search)
const noteId = params.get('noteId')

export default function App() {
  const [note, setNote]               = useState(null)
  const [content, setContent]         = useState('')
  const [showPicker, setShowPicker]   = useState(false)
  const [collapsed, setCollapsed]     = useState(params.get('collapsed') === 'true')
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [showTypePicker, setShowTypePicker]   = useState(false)
  const [groups, setGroups]           = useState([])
  const [groupError, setGroupError]   = useState(false)
  const [pathEditing, setPathEditing] = useState(false)

  const groupBtnRef    = useRef(null)
  const groupPickerRef = useRef(null)
  const typeBtnRef     = useRef(null)
  const typePickerRef  = useRef(null)

  useEffect(() => {
    if (!noteId) return
    window.stickiesAPI.getNote(noteId).then(n => {
      if (n) { setNote(n); setContent(n.content) }
    })
    const cleanup = window.stickiesAPI.onColorChanged(color => {
      setNote(prev => prev ? { ...prev, color } : prev)
    })
    return cleanup
  }, [])

  // Close group picker when clicking outside
  useEffect(() => {
    if (!showGroupPicker) return
    function handleClick(e) {
      if (
        groupPickerRef.current && !groupPickerRef.current.contains(e.target) &&
        groupBtnRef.current   && !groupBtnRef.current.contains(e.target)
      ) setShowGroupPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showGroupPicker])

  // Close type picker when clicking outside
  useEffect(() => {
    if (!showTypePicker) return
    function handleClick(e) {
      if (
        typePickerRef.current && !typePickerRef.current.contains(e.target) &&
        typeBtnRef.current    && !typeBtnRef.current.contains(e.target)
      ) setShowTypePicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTypePicker])

  const saveContent = useDebounce((text) => {
    window.stickiesAPI.updateNote({ id: noteId, content: text })
  }, 400)

  function handleChange(e) {
    const text = e.target.value
    setContent(text)
    saveContent(text)
  }

  async function handleDelete() {
    const result = await window.stickiesAPI.deleteNote(noteId)
    if (result?.error === 'last-in-group') {
      setGroupError(true)
      setTimeout(() => setGroupError(false), 600)
    }
  }

  function handleNewNote(type) {
    setShowTypePicker(false)
    window.stickiesAPI.createNote(type)
  }

  function handleColorPick(color) {
    window.stickiesAPI.setColor({ id: noteId, color })
    setNote(prev => ({ ...prev, color }))
    setShowPicker(false)
  }

  function handleToggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    if (next) { setShowPicker(false); setShowGroupPicker(false); setShowTypePicker(false) }
    window.stickiesAPI.setCollapsed({ id: noteId, collapsed: next })
  }

  async function handleOpenGroupPicker() {
    if (showGroupPicker) { setShowGroupPicker(false); return }
    const list = await window.stickiesAPI.getGroups()
    setGroups(list)
    setShowGroupPicker(true)
    setShowPicker(false)
    setShowTypePicker(false)
  }

  async function handleMoveToGroup(targetGroupId) {
    setShowGroupPicker(false)
    const result = await window.stickiesAPI.moveToGroup({ id: noteId, targetGroupId })
    if (result?.error === 'last-in-group') {
      setGroupError(true)
      setTimeout(() => setGroupError(false), 600)
    } else if (result?.ok) {
      setNote(prev => ({ ...prev, groupId: targetGroupId }))
    }
  }

  function handlePathBlur() {
    setPathEditing(false)
  }

  function handleOpenPath(filePath) {
    window.stickiesAPI.openPath(filePath)
  }

  if (!note) return null

  const c     = COLORS[note.color] || COLORS.yellow
  const title = content.split('\n').find(l => l.trim()) || ''
  const currentGroupId = note.groupId ?? null
  const isPath = note.type === 'path'

  return (
    <div className="note" style={{ '--bg': c.bg, '--header': c.header, '--text': c.text }}>
      <div className="header drag">
        <span className="tl-spacer" />

        <span className="title" title={title}>{title || (isPath ? 'Path Note' : 'New Note')}</span>

        <div className="actions no-drag">
          <button className="btn" title="Color"       onClick={() => { setShowPicker(p => !p); setShowGroupPicker(false); setShowTypePicker(false) }}>●</button>
          <button
            ref={groupBtnRef}
            className={`btn${groupError ? ' btn-error' : ''}`}
            title="Move to group"
            onClick={handleOpenGroupPicker}
          >⊞</button>
          <button className="btn" title="Toggle body" onClick={handleToggleCollapse}>{collapsed ? '▾' : '▴'}</button>
          <button
            ref={typeBtnRef}
            className="btn"
            title="New note"
            onClick={() => { setShowTypePicker(p => !p); setShowPicker(false); setShowGroupPicker(false) }}
          >+</button>
          <button className={`btn btn-close${groupError ? ' btn-error' : ''}`} title="Delete" onClick={handleDelete}>×</button>
        </div>
      </div>

      {!collapsed && showGroupPicker && (
        <div className="group-picker no-drag" ref={groupPickerRef}>
          <button
            className={`group-item${currentGroupId === null ? ' active' : ''}`}
            onClick={() => handleMoveToGroup(null)}
          >Ungrouped</button>
          {groups.map(g => (
            <button
              key={g.id}
              className={`group-item${currentGroupId === g.id ? ' active' : ''}`}
              onClick={() => handleMoveToGroup(g.id)}
            >{g.name}</button>
          ))}
        </div>
      )}

      {!collapsed && showTypePicker && (
        <div className="type-picker no-drag" ref={typePickerRef}>
          <button className="type-item" onClick={() => handleNewNote('text')}>Text Note</button>
          <button className="type-item" onClick={() => handleNewNote('path')}>Path Note</button>
        </div>
      )}

      {!collapsed && showPicker && (
        <div className="picker no-drag">
          {Object.entries(COLORS).map(([name, col]) => (
            <button
              key={name}
              className={`dot${note.color === name ? ' active' : ''}`}
              style={{ background: col.header }}
              onClick={() => handleColorPick(name)}
            />
          ))}
        </div>
      )}

      {!collapsed && isPath && !pathEditing && (
        <div
          className="path-list no-drag"
          onDoubleClick={() => setPathEditing(true)}
        >
          {content.split('\n').filter(l => l.trim()).length === 0 ? (
            <div className="path-empty">Double-click to add paths…</div>
          ) : (
            content.split('\n').filter(l => l.trim()).map((line, i) => (
              <button
                key={i}
                className="path-item"
                title={line.trim()}
                onClick={() => handleOpenPath(line.trim())}
              >{line.trim()}</button>
            ))
          )}
        </div>
      )}

      {!collapsed && isPath && pathEditing && (
        <textarea
          className="body no-drag"
          value={content}
          onChange={handleChange}
          placeholder="One path per line…"
          autoFocus
          onBlur={handlePathBlur}
        />
      )}

      {!collapsed && !isPath && (
        <textarea
          className="body no-drag"
          value={content}
          onChange={handleChange}
          placeholder="Type a note…"
          autoFocus
        />
      )}
    </div>
  )
}
