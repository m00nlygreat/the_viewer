export interface GridCellUpdate { row: number; column: number; value: string }
interface GridCellUpdateOptions { allowAddRows?: boolean; minColumns?: number; materializeBlankCells?: boolean }

export function applyGridCellUpdates(rows: string[][], updates: readonly GridCellUpdate[], options: GridCellUpdateOptions = {}): string[][] {
  if (!updates.length) return rows
  const next = [...rows]
  const changedRows = new Map<number, string[]>()
  let changed = false
  for (const update of updates) {
    if (update.row < 0 || update.column < 0) continue
    if (update.row >= next.length && !options.allowAddRows) continue
    while (next.length <= update.row) {
      next.push(Array(options.minColumns ?? 0).fill(''))
      changed = true
    }

    let row = changedRows.get(update.row)
    if (!row) {
      row = [...next[update.row]!]
      changedRows.set(update.row, row)
      next[update.row] = row
    }
    while (row.length <= update.column) {
      row.push('')
      if (options.materializeBlankCells) changed = true
    }
    if (row[update.column] !== update.value) {
      row[update.column] = update.value
      changed = true
    }
  }
  return changed ? next : rows
}
