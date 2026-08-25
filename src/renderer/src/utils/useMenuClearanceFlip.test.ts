import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import { useMenuClearanceFlip, type MenuClearanceProperty } from './useMenuClearanceFlip.ts'

/**
 * The shift distance is measured, not declared, so the thing worth testing is
 * exactly that: whichever clearance the layout happens to apply, the inline
 * transform must give back the same distance. These fakes let a test state a
 * clearance sequence and read back what the composable wrote, in order.
 */
interface FakeElement {
  style: { transition: string; transform: string }
  offsetWidth: number
  /** Every value written to `style.transform`, in order. */
  writes: string[]
  /** Writes and layout reads interleaved, so ordering can be asserted. */
  journal: string[]
}

function installComputedStyle(read: () => Record<string, string>): void {
  ;(globalThis as Record<string, unknown>).getComputedStyle = () => read()
}

function createElement(): FakeElement {
  const writes: string[] = []
  const journal: string[] = []
  const element = {
    style: {
      transition: '',
      get transform() {
        return writes.at(-1) ?? ''
      },
      set transform(value: string) {
        writes.push(value)
        journal.push(value === '' ? 'clear' : `write:${value}`)
      }
    },
    get offsetWidth() {
      journal.push('reflow')
      return 0
    },
    writes,
    journal
  }
  return element as unknown as FakeElement
}

function withScope(fn: () => void): () => void {
  const scope = effectScope()
  scope.run(fn)
  return () => scope.stop()
}

function mount(
  element: FakeElement,
  property: MenuClearanceProperty,
  trigger: () => boolean
): () => void {
  return withScope(() => {
    useMenuClearanceFlip(
      ref(element) as unknown as Parameters<typeof useMenuClearanceFlip>[0],
      property,
      trigger
    )
  })
}

/**
 * Runs one toggle and returns what landed on the element. `clearances` is read
 * in order: the first value is the outgoing layout, the second is the layout
 * after the class lands.
 */
async function toggle(
  property: MenuClearanceProperty,
  clearances: string[],
  from = false
): Promise<{ element: FakeElement; dispose: () => void }> {
  let call = 0
  installComputedStyle(() => ({ [property]: clearances[Math.min(call++, clearances.length - 1)] }))
  const element = createElement()
  const open = ref(from)
  const dispose = mount(element, property, () => open.value)
  open.value = !from
  await nextTick()
  await nextTick()
  return { element, dispose }
}

test('gives back exactly the measured padding-left delta', async () => {
  const { element, dispose } = await toggle('paddingLeft', ['0px', '180px'])
  assert.equal(element.writes[0], 'translate3d(-180px, 0, 0)')
  // Cleared in the same task so the CSS transition owns the trip home.
  assert.equal(element.style.transform, '')
  assert.equal(element.style.transition, '')
  dispose()
})

test('subtracts a non-zero collapsed offset instead of assuming zero', async () => {
  // aurora-reference floats the bar as an island: collapsed `left` is not 0, so
  // the shift is the difference, not the open value. This is the case a
  // hand-maintained token got wrong by up to 44px.
  const { element, dispose } = await toggle('left', ['44px', '260px'])
  assert.equal(element.writes[0], 'translate3d(-216px, 0, 0)')
  dispose()
})

test('commits the offset with a layout read before clearing it', async () => {
  // Without a forced layout between the two writes the browser computes only the
  // final style, finds no start-to-end difference, and plays no animation at all
  // — a silent failure that renders as an instant jump. Order is the contract.
  const { element, dispose } = await toggle('paddingLeft', ['0px', '180px'])
  assert.deepEqual(element.journal, ['write:translate3d(-180px, 0, 0)', 'reflow', 'clear'])
  dispose()
})

test('writes nothing when the clearance does not change', async () => {
  // A custom shell hands clearance to its grid template and pins both halves.
  const { element, dispose } = await toggle('paddingLeft', ['0px', '0px'])
  assert.deepEqual(element.writes, [])
  assert.deepEqual(element.journal, [])
  dispose()
})

test('writes nothing when the clearance is not a length', async () => {
  // `inset: auto` on the shell parses to NaN; a NaN transform would be dropped
  // by the parser anyway, but it must not clobber `transition` on the way.
  const { element, dispose } = await toggle('left', ['auto', 'auto'])
  assert.deepEqual(element.writes, [])
  assert.equal(element.style.transition, '')
  dispose()
})

test('closing gives back the distance in the opposite direction', async () => {
  const { element, dispose } = await toggle('paddingLeft', ['180px', '0px'], true)
  assert.equal(element.writes[0], 'translate3d(180px, 0, 0)')
  dispose()
})

test('ignores a toggle whose element was swapped out mid-tick', async () => {
  // The player bar unmounts with the last track, and the measurement straddles a
  // nextTick, so the element it started on can be gone by the time the second
  // read happens. The swap therefore has to land *during* that window: doing it
  // before the watcher runs would only exercise the null check. The clearance
  // must also really change, or the zero-delta guard would return first and the
  // test would pass without ever reaching the swap check.
  const element = createElement()
  const target = ref<FakeElement | null>(element)
  let call = 0
  const clearances = ['0px', '180px']
  installComputedStyle(() => {
    // Drop the element during the outgoing read. The composable captures it into a
    // local before reading, so the capture still succeeds and the swap is only
    // observable at the guard after `nextTick` — which is the branch under test.
    if (call === 0) target.value = null
    return { paddingLeft: clearances[Math.min(call++, clearances.length - 1)] }
  })
  const open = ref(false)
  const dispose = withScope(() => {
    useMenuClearanceFlip(
      target as unknown as Parameters<typeof useMenuClearanceFlip>[0],
      'paddingLeft',
      () => open.value
    )
  })
  open.value = true
  await nextTick()
  await nextTick()
  assert.deepEqual(element.writes, [])
  dispose()
})
