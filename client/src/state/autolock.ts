import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Bloquea la bóveda tras `minutes` sin actividad. Se revisa con un intervalo y al volver a la
// pestaña, porque los temporizadores se congelan cuando el teléfono suspende la PWA.
export function useAutoLock(active: boolean, minutes: number, onLock: () => void): void {
  const lastActivity = useRef(Date.now())
  const onLockRef = useRef(onLock)
  onLockRef.current = onLock

  useEffect(() => {
    if (!active) return
    lastActivity.current = Date.now()
    const limit = minutes * 60 * 1000
    const touch = () => {
      lastActivity.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActivity.current >= limit) onLockRef.current()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, touch, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(check, 5000)
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, touch)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [active, minutes])
}
