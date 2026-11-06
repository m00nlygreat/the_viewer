export type FolderTransitionPhase = 'idle' | 'settling' | 'confirming' | 'saving' | 'ready-to-pick' | 'picking' | 'committing'
export type FolderTransitionEvent =
  | { type: 'begin' }
  | { type: 'begin-pick' }
  | { type: 'settled'; dirtyCount: number }
  | { type: 'save' }
  | { type: 'discard' }
  | { type: 'saved' }
  | { type: 'pick' }
  | { type: 'settle' }
  | { type: 'picked' }
  | { type: 'commit' }
  | { type: 'reconfirm' }
  | { type: 'cancel' }
  | { type: 'fail' }

const transitions: Record<FolderTransitionPhase, Partial<Record<FolderTransitionEvent['type'], FolderTransitionPhase>>> = {
  idle: { begin: 'settling', 'begin-pick': 'picking' },
  settling: { settled: 'confirming', cancel: 'idle', fail: 'idle' },
  confirming: { save: 'saving', discard: 'ready-to-pick', cancel: 'idle', fail: 'idle', reconfirm: 'confirming' },
  saving: { saved: 'ready-to-pick', cancel: 'idle', fail: 'idle', reconfirm: 'confirming' },
  'ready-to-pick': { pick: 'picking', commit: 'committing', cancel: 'idle', fail: 'idle' },
  picking: { settle: 'settling', picked: 'committing', cancel: 'idle', fail: 'idle' },
  committing: { cancel: 'idle', fail: 'idle', reconfirm: 'confirming' }
}

export function transitionFolderPhase(phase: FolderTransitionPhase, event: FolderTransitionEvent): FolderTransitionPhase {
  if (phase === 'settling' && event.type === 'settled') return event.dirtyCount > 0 ? 'confirming' : 'ready-to-pick'
  return transitions[phase][event.type] ?? phase
}
