import { Delete } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { PATTERN_MIN, PIN_LENGTH } from '../crypto/quickUnlock'
import { useI18n } from '../i18n'

// Para empezar de nuevo (tras un error) el padre cambia la "key" del componente

export function PinPad({ busy, onComplete }: { busy: boolean; onComplete: (pin: string) => void }) {
  const { t } = useI18n()
  const [pin, setPin] = useState('')

  useEffect(() => {
    if (pin.length === PIN_LENGTH) onComplete(pin)
    // Solo cuando se completa el último dígito
  }, [pin])

  const press = (digit: string) => setPin((p) => (p.length < PIN_LENGTH ? p + digit : p))
  const erase = () => setPin((p) => p.slice(0, -1))

  // También funciona con el teclado de la computadora
  useEffect(() => {
    if (busy) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') erase()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  return (
    <div className="pinpad">
      <div className="pin-dots" role="status" aria-label={t('quickUnlock.pinProgress', { n: pin.length })}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button
          type="button"
          className="pin-erase"
          onClick={erase}
          disabled={busy || !pin}
          aria-label={t('quickUnlock.erase')}
          title={t('quickUnlock.erase')}
        >
          <Delete size={22} />
        </button>
      </div>
    </div>
  )
}

// Cuadrícula de 3×3 en un espacio de 300×300; cada punto se toma al pasar a menos de HIT
const SIZE = 300
const HIT = 42
const center = (i: number) => ({ x: 50 + (i % 3) * 100, y: 50 + Math.floor(i / 3) * 100 })

// Como en Android: al saltar de un extremo al otro se toma también el punto de en medio
function between(a: number, b: number): number | null {
  const [ca, ra, cb, rb] = [a % 3, Math.floor(a / 3), b % 3, Math.floor(b / 3)]
  if ((ca + cb) % 2 || (ra + rb) % 2) return null
  return ((ra + rb) / 2) * 3 + (ca + cb) / 2
}

export function PatternPad({
  busy,
  onComplete,
  onTooShort
}: {
  busy: boolean
  onComplete: (pattern: string) => void
  onTooShort: () => void
}) {
  const { t } = useI18n()
  const svg = useRef<SVGSVGElement>(null)
  const path = useRef<number[]>([])
  const [dots, setDots] = useState<number[]>([])
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  function point(e: PointerEvent) {
    const rect = svg.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) * SIZE) / rect.width, y: ((e.clientY - rect.top) * SIZE) / rect.height }
  }

  function visit(p: { x: number; y: number }) {
    for (let i = 0; i < 9; i++) {
      const c = center(i)
      if (path.current.includes(i) || Math.hypot(c.x - p.x, c.y - p.y) > HIT) continue
      const last = path.current.at(-1)
      const mid = last === undefined ? null : between(last, i)
      if (mid !== null && !path.current.includes(mid)) path.current.push(mid)
      path.current.push(i)
      setDots([...path.current])
    }
  }

  function down(e: PointerEvent<SVGSVGElement>) {
    if (busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    path.current = []
    setDots([])
    const p = point(e)
    setCursor(p)
    visit(p)
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    if (!cursor) return
    const p = point(e)
    setCursor(p)
    visit(p)
  }

  function up() {
    if (!cursor) return
    setCursor(null)
    const done = path.current
    if (done.length >= PATTERN_MIN) onComplete(done.join('-'))
    else {
      if (done.length > 0) onTooShort()
      path.current = []
      setDots([])
    }
  }

  const line = dots.map((i) => `${center(i).x},${center(i).y}`).join(' ')
  const last = dots.length ? center(dots.at(-1)!) : null

  return (
    <svg
      ref={svg}
      className={`pattern ${busy ? 'busy' : ''}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={t('quickUnlock.patternLabel')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {dots.length > 1 && <polyline points={line} className="pattern-line" />}
      {cursor && last && <line x1={last.x} y1={last.y} x2={cursor.x} y2={cursor.y} className="pattern-line live" />}
      {Array.from({ length: 9 }, (_, i) => {
        const c = center(i)
        const on = dots.includes(i)
        return (
          <g key={i}>
            {on && <circle cx={c.x} cy={c.y} r={22} className="pattern-halo" />}
            <circle cx={c.x} cy={c.y} r={on ? 11 : 8} className={`pattern-dot ${on ? 'on' : ''}`} />
          </g>
        )
      })}
    </svg>
  )
}
