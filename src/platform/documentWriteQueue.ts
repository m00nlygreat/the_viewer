export class DocumentWriteQueue {
  private readonly pending = new Map<string, Promise<void>>()

  enqueue(documentId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(documentId)
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation)
    this.pending.set(documentId, current)
    void current.finally(() => {
      if (this.pending.get(documentId) === current) this.pending.delete(documentId)
    }).catch(() => undefined)
    return current
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()])
  }
}
