import { describe, expect, it } from 'vitest'
import { transitionFolderPhase } from '../src/domain/folderTransition'

describe('folder transition phases', () => {
  it('requires an explicit pick after dirty documents are handled', () => {
    expect(transitionFolderPhase('idle', { type: 'begin' })).toBe('settling')
    expect(transitionFolderPhase('settling', { type: 'settled', dirtyCount: 2 })).toBe('confirming')
    expect(transitionFolderPhase('confirming', { type: 'save' })).toBe('saving')
    expect(transitionFolderPhase('saving', { type: 'saved' })).toBe('ready-to-pick')
    expect(transitionFolderPhase('ready-to-pick', { type: 'pick' })).toBe('picking')
    expect(transitionFolderPhase('picking', { type: 'picked' })).toBe('committing')
    expect(transitionFolderPhase('committing', { type: 'cancel' })).toBe('idle')
  })

  it('skips confirmation when there are no dirty documents and ignores invalid events', () => {
    expect(transitionFolderPhase('settling', { type: 'settled', dirtyCount: 0 })).toBe('ready-to-pick')
    expect(transitionFolderPhase('idle', { type: 'pick' })).toBe('idle')
    expect(transitionFolderPhase('saving', { type: 'pick' })).toBe('saving')
    expect(transitionFolderPhase('confirming', { type: 'discard' })).toBe('ready-to-pick')
  })
})
