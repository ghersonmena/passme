import { useRef, type ReactNode, type PointerEvent } from 'react'

// Distancia que hay que deslizar para que la acción se ejecute al soltar
const THRESHOLD = 88
// Antes de esto no se sabe si el gesto es horizontal (deslizar) o vertical (desplazar la lista)
const DECIDE = 10

interface Action {
  icon: ReactNode
  label: string
  className: string
  run: () => void
}

interface Props {
  // Deslizar hacia la derecha descubre la acción de la izquierda, y al revés
  right?: Action
  left?: Action
  children: ReactNode
}

// Fila que se desliza con el dedo (o el mouse). El desplazamiento se aplica directo al estilo del
// elemento, sin pasar por React, para que siga al dedo sin saltos.
export function SwipeRow({ right, left, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null; armed: boolean } | null>(null)
  // Tras deslizar, el clic que genera el navegador al soltar no debe abrir el elemento
  const swallowClick = useRef(false)

  function move(dx: number, animate: boolean) {
    const row = ref.current
    if (!row) return
    const content = row.querySelector<HTMLElement>('.swipe-content')!
    content.style.transition = animate ? 'transform 0.2s ease' : 'none'
    content.style.transform = dx ? `translateX(${dx}px)` : ''
    row.dataset.dir = dx > 0 ? 'right' : dx < 0 ? 'left' : ''
    row.classList.toggle('armed', Math.abs(dx) >= THRESHOLD)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || (!right && !left)) return
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, horizontal: null, armed: false }
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.horizontal === null) {
      if (Math.abs(dx) < DECIDE && Math.abs(dy) < DECIDE) return
      d.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5
      if (!d.horizontal) {
        drag.current = null
        return
      }
      ref.current?.setPointerCapture(e.pointerId)
    }
    // Sin acción para ese lado, la fila apenas se mueve
    let next = (dx > 0 && !right) || (dx < 0 && !left) ? dx / 6 : dx
    // Pasado el umbral cuesta más moverla
    if (Math.abs(next) > THRESHOLD) next = Math.sign(next) * (THRESHOLD + (Math.abs(next) - THRESHOLD) / 3)
    d.dx = next
    const armed = Math.abs(next) >= THRESHOLD && (next > 0 ? !!right : !!left)
    if (armed && !d.armed) navigator.vibrate?.(10)
    d.armed = armed
    move(next, false)
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d || !d.horizontal) return
    swallowClick.current = Math.abs(d.dx) > DECIDE
    const action = d.armed ? (d.dx > 0 ? right : left) : undefined
    move(0, true)
    action?.run()
  }

  return (
    <div
      ref={ref}
      className="swipe"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        move(0, true)
      }}
      onClickCapture={(e) => {
        if (!swallowClick.current) return
        swallowClick.current = false
        e.stopPropagation()
        e.preventDefault()
      }}
    >
      {right && (
        <div className={`swipe-bg from-left ${right.className}`} aria-hidden>
          {right.icon}
          <span>{right.label}</span>
        </div>
      )}
      {left && (
        <div className={`swipe-bg from-right ${left.className}`} aria-hidden>
          <span>{left.label}</span>
          {left.icon}
        </div>
      )}
      <div className="swipe-content">{children}</div>
    </div>
  )
}
