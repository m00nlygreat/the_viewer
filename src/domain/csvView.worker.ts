type SortSpec = { column: number; direction: 1 | -1 } | null
type Row = readonly string[]
type WorkerRequest =
  | { type: 'init'; rows: readonly Row[] }
  | { type: 'update'; length: number; changes: Array<{ index: number; row: Row }> }
  | { type: 'query'; requestId: number; query: string; sort: SortSpec }

let rows: Row[] = []
let searchCells: string[][] = []
let newestRequest = 0
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function indexRow(index: number): void {
  searchCells[index] = (rows[index] ?? []).map((value) => value.toLocaleLowerCase())
}

async function runQuery(request: Extract<WorkerRequest, { type: 'query' }>): Promise<void> {
  const { requestId, query, sort } = request
  const matches: number[] = []
  const batchSize = 4096
  for (let start = 0; start < rows.length; start += batchSize) {
    if (requestId !== newestRequest) return
    const end = Math.min(rows.length, start + batchSize)
    for (let index = start; index < end; index++) {
      if (!query || searchCells[index]?.some((cell) => cell.includes(query))) matches.push(index)
    }
    if (end < rows.length) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  if (requestId !== newestRequest) return
  if (sort) matches.sort((left, right) => collator.compare(rows[left]?.[sort.column] ?? '', rows[right]?.[sort.column] ?? '') * sort.direction || left - right)
  if (requestId === newestRequest) self.postMessage({ requestId, indices: matches })
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'init') {
    rows = request.rows.map((row) => [...row])
    searchCells = new Array(rows.length)
    for (let index = 0; index < rows.length; index++) indexRow(index)
    return
  }
  if (request.type === 'update') {
    rows.length = request.length
    searchCells.length = request.length
    for (const { index, row } of request.changes) {
      if (index < 0 || index >= request.length) continue
      rows[index] = [...row]
      indexRow(index)
    }
    newestRequest++
    return
  }
  newestRequest = request.requestId
  void runQuery(request)
}
