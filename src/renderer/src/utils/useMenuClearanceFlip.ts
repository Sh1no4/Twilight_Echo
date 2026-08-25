import { nextTick, watch, type Ref } from 'vue'

/** The layout property a given surface uses to clear the open side menu. */
export type MenuClearanceProperty = 'paddingLeft' | 'left'

/**
 * FLIP for the side-menu clearance.
 *
 * The clearance property itself (`padding-left` on the content root, `left` on
 * the player bar shell) lands instantly — one layout pass — and this composable
 * pays that pass back by translating the surface to where it used to be and
 * letting the CSS `transform` transition carry it home. Nothing else animates,
 * so the 0.32s slide costs zero further layout on a subtree that holds the
 * virtualized track list and every glass surface in the app.
 *
 * The shift distance is *measured* rather than declared. It is a derived value —
 * the open clearance minus the collapsed one — and each preset layout writes
 * those two halves in separate rules, sometimes with different responsive
 * branches for the content root and the bar (aurora-reference floats both as
 * islands with unequal air gaps). A hand-maintained token has to restate that
 * subtraction for every preset and every branch, with nothing to catch it when
 * one side drifts; measuring is correct for presets that do not exist yet.
 *
 * `getComputedStyle` is deliberate: `padding-left` moves an element's children,
 * not its own box, so `getBoundingClientRect` reports no change at all for the
 * content root and would silently yield a zero shift.
 */
export function useMenuClearanceFlip(
  target: Ref<HTMLElement | null>,
  property: MenuClearanceProperty,
  trigger: () => boolean
): void {
  function readClearance(element: HTMLElement): number {
    return Number.parseFloat(getComputedStyle(element)[property])
  }

  watch(trigger, async () => {
    const element = target.value
    if (!element) return

    // Watchers flush before the render effect, so this still sees the outgoing
    // layout; the matching class arrives with the DOM update below.
    const before = readClearance(element)
    await nextTick()
    if (target.value !== element) return
    const after = readClearance(element)

    const delta = after - before
    // A custom shell hands clearance to its grid template and pins the bar with
    // `inset: auto`, which parses to NaN. That layout — like any other whose
    // clearance does not actually change — has no distance to give back.
    if (!Number.isFinite(delta) || delta === 0) return

    element.style.transition = 'none'
    element.style.transform = `translate3d(${-delta}px, 0, 0)`
    /**
     * Force the offset to be committed as the transition's start value before
     * clearing it again. Both writes land in this one task, so without a layout
     * read between them the browser only ever computes the final style, sees no
     * start-to-end difference, and plays nothing at all. Reading `offsetWidth`
     * is what makes the first write observable — it is load-bearing, not a
     * leftover debug line.
     */
    void element.offsetWidth
    element.style.transition = ''
    element.style.transform = ''
  })
}
