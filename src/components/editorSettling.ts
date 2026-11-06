interface EditorSettlementTarget {
  isComposing: () => boolean
  blur: () => void
}

const editorTargets = new Set<EditorSettlementTarget>()

export function registerEditorSettlementTarget(target: EditorSettlementTarget): () => void {
  editorTargets.add(target)
  return () => editorTargets.delete(target)
}

export async function settleCodeEditors(): Promise<void> {
  const targets = [...editorTargets]
  for (const target of targets) target.blur()
  const deadline = performance.now() + 2000
  while (targets.some((target) => target.isComposing())) {
    if (performance.now() >= deadline) throw new Error('입력 조합이 끝나지 않아 폴더 전환을 멈췄습니다. 입력을 마친 뒤 다시 시도하세요.')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
