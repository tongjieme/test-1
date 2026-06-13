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

const params  = new URLSearchParams(window.location.search)
const noteId  = params.get('noteId')

export default function App() {
  const [note, setNote]             = useState(null)
  const [content, setContent]       = useState('')
  const [showPicker, setShowPicker] = useState(false)
  // initialise from URL so window size and React state are in sync from frame 1
  const [collapsed, setCollapsed]   = useState(params.get('collapsed') === 'true')


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

  const saveContent = useDebounce((text) => {
    window.stickiesAPI.updateNote({ id: noteId, content: text })
  }, 400)

  function handleChange(e) {
    const text = e.target.value
    setContent(text)
    saveContent(text)
  }

  function handleDelete() { window.stickiesAPI.deleteNote(noteId) }
  function handleNewNote() { window.stickiesAPI.createNote() }

  function handleColorPick(color) {
    window.stickiesAPI.setColor({ id: noteId, color })
    setNote(prev => ({ ...prev, color }))
    setShowPicker(false)
  }

  function handleToggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    if (next) setShowPicker(false)
    window.stickiesAPI.setCollapsed({ id: noteId, collapsed: next })
  }

  if (!note) return null

  const c     = COLORS[note.color] || COLORS.yellow
  // First non-empty line becomes the title; fall back to placeholder
  const title = content.split('\n').find(l => l.trim()) || ''

  return (
    <div className="note" style={{ '--bg': c.bg, '--header': c.header, '--text': c.text }}>
      <div className="header drag">
        <span className="tl-spacer" />

        <span className="title" title={title}>{title || 'New Note'}</span>

        <div className="actions no-drag">
          <button className="btn" title="Color"              onClick={() => setShowPicker(p => !p)}>●</button>
          <button className="btn" title="Toggle body"        onClick={handleToggleCollapse}>{collapsed ? '▾' : '▴'}</button>
          <button className="btn" title="New note"           onClick={handleNewNote}>+</button>
          <button className="btn btn-close" title="Delete"   onClick={handleDelete}>×</button>
        </div>
      </div>

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

      {!collapsed && (
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
