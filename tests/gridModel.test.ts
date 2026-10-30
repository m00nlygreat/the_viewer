import { describe, expect, it } from 'vitest'
import { applyGridCellUpdates } from '../src/features/gridModel'

describe('grid row updates', () => {
  it('copies only changed rows and leaves the source model untouched', () => {
    const rows = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    const updated = applyGridCellUpdates(rows, [
      { row: 0, column: 1, value: 'B' },
      { row: 1, column: 0, value: 'C' }
    ])

    expect(updated).toEqual([['a', 'B'], ['C', 'd'], ['e', 'f']])
    expect(updated).not.toBe(rows)
    expect(updated[0]).not.toBe(rows[0])
    expect(updated[1]).not.toBe(rows[1])
    expect(updated[2]).toBe(rows[2])
    expect(rows).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']])
  })

  it('returns the original rows when edits do not change cell values', () => {
    const rows = [['same']]
    expect(applyGridCellUpdates(rows, [{ row: 0, column: 0, value: 'same' }])).toBe(rows)
  })

  it('extends rows for pasted cells and pads them to the grid width', () => {
    const rows = [['a']]
    expect(applyGridCellUpdates(rows, [{ row: 2, column: 2, value: 'x' }], { allowAddRows: true, minColumns: 3 }))
      .toEqual([['a'], ['', '', ''], ['', '', 'x']])
  })
})
