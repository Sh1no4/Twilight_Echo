const AUTO_SCROLLBAR_CLASS = 'te-auto-scrollbar'
const NEAR_SCROLLBAR_CLASS = 'is-scrollbar-near'
const ACTIVE_SCROLLBAR_CLASS = 'is-scrollbar-active'
const SCROLLBAR_PROXIMITY_PX = 28
const SCROLLBAR_HIDE_DELAY_MS = 900

interface ScrollbarAxes {
  horizontal: boolean
  vertical: boolean
}

let activeScroller: HTMLElement | null = null
let hideTimer: number | null = null
let pointerFrame: number | null = null
let pendingPointerEvent: PointerEvent | null = null

function getScrollbarAxes(element: HTMLElement): ScrollbarAxes {
  const style = window.getComputedStyle(element)
  const canScrollVertical = /(auto|scroll|overlay)/.test(style.overflowY)
  const canScrollHorizontal = /(auto|scroll|overlay)/.test(style.overflowX)
  return {
    vertical: canScrollVertical && element.scrollHeight > element.clientHeight + 1,
    horizontal: canScrollHorizontal && element.scrollWidth > element.clientWidth + 1
  }
}

function findScrollableAncestor(start: Element | null): HTMLElement | null {
  let current = start instanceof HTMLElement ? start : (start?.parentElement ?? null)
  while (current) {
    const axes = getScrollbarAxes(current)
    if (axes.vertical || axes.horizontal) return current
    current = current.parentElement
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function clearHideTimer(): void {
  if (hideTimer === null) return
  window.clearTimeout(hideTimer)
  hideTimer = null
}

function clearScroller(element: HTMLElement | null, clearActive = true): void {
  if (!element) return
  element.classList.remove(NEAR_SCROLLBAR_CLASS)
  if (clearActive) element.classList.remove(ACTIVE_SCROLLBAR_CLASS)
  if (activeScroller === element && clearActive) activeScroller = null
}

function scheduleHide(element: HTMLElement): void {
  clearHideTimer()
  hideTimer = window.setTimeout(() => {
    element.classList.remove(ACTIVE_SCROLLBAR_CLASS)
    hideTimer = null
    if (!element.classList.contains(NEAR_SCROLLBAR_CLASS) && activeScroller === element) {
      activeScroller = null
    }
  }, SCROLLBAR_HIDE_DELAY_MS)
}

function revealWhileScrolling(element: HTMLElement): void {
  if (activeScroller && activeScroller !== element) clearScroller(activeScroller)
  activeScroller = element
  element.classList.add(AUTO_SCROLLBAR_CLASS, ACTIVE_SCROLLBAR_CLASS)
  scheduleHide(element)
}

function updatePointerProximity(event: PointerEvent): void {
  const element = findScrollableAncestor(event.target instanceof Element ? event.target : null)
  if (!element) {
    clearScroller(activeScroller, false)
    return
  }

  const axes = getScrollbarAxes(element)
  const rect = element.getBoundingClientRect()
  const nearVertical =
    axes.vertical &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom &&
    rect.right - event.clientX >= 0 &&
    rect.right - event.clientX <= SCROLLBAR_PROXIMITY_PX
  const nearHorizontal =
    axes.horizontal &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    rect.bottom - event.clientY >= 0 &&
    rect.bottom - event.clientY <= SCROLLBAR_PROXIMITY_PX
  const isNear = nearVertical || nearHorizontal

  if (activeScroller && activeScroller !== element) clearScroller(activeScroller, false)
  element.classList.add(AUTO_SCROLLBAR_CLASS)
  element.classList.toggle(NEAR_SCROLLBAR_CLASS, isNear)
  if (isNear) activeScroller = element
  else if (!element.classList.contains(ACTIVE_SCROLLBAR_CLASS) && activeScroller === element) {
    activeScroller = null
  }
}

function onPointerMove(event: PointerEvent): void {
  pendingPointerEvent = event
  if (pointerFrame !== null) return
  pointerFrame = window.requestAnimationFrame(() => {
    pointerFrame = null
    if (pendingPointerEvent) updatePointerProximity(pendingPointerEvent)
    pendingPointerEvent = null
  })
}

function onPointerLeaveDocument(): void {
  clearScroller(activeScroller, false)
}

function onScroll(event: Event): void {
  const element =
    event.target instanceof HTMLElement
      ? event.target
      : document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : null
  if (element) revealWhileScrolling(element)
}

export function installAutoHideScrollbars(): () => void {
  document.documentElement.classList.add(AUTO_SCROLLBAR_CLASS)
  document.body.classList.add(AUTO_SCROLLBAR_CLASS)
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerleave', onPointerLeaveDocument, { passive: true })
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerleave', onPointerLeaveDocument)
    document.removeEventListener('scroll', onScroll, true)
    clearHideTimer()
    if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame)
    pointerFrame = null
    pendingPointerEvent = null
    clearScroller(activeScroller)
  }
}
