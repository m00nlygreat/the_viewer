import { describe, expect, it } from 'vitest'
import { nextRevisions, type CsvViewDefinition } from '../src/domain/csv-views/model'
import { validateBackup, validateViewBundle, validateViewDefinition } from '../src/domain/csv-views/validate'
import { createDefaultColumn } from '../src/domain/csv-views/typing'
import type { CsvFileIdentity } from '../src/domain/csv-views/model'
import { isCsvFileIdentity, matchIdentity } from '../src/platform/csv/fileIdentity'

const column = createDefaultColumn('text', { id: 'c1', sourceIndex: 0, sourceHeader: 'name', label: 'name', typeSource: 'inferred', nullMarkers: [], allowSurroundingSpace: false }, null)
const view: CsvViewDefinition = { id: 'v1', name: '목록', layout: { kind: 'grid' }, columnIds: ['c1'], filter: null, sort: [], displayOverrides: {}, updatedAt: '2026-11-16T00:00:00Z' }

function bundle() {
  return {
    kind: 'csv-view-bundle', schemaVersion: 1, exportedAt: '2026-11-16T00:00:00Z', appVersion: '0.4.0',
    source: { fileName: 'data.csv', headers: ['name'], columnCount: 1 },
    profile: { schemaVersion: 1, fileId: 'source-reference', parser: { encoding: 'utf-8', bom: 'auto', hasHeader: true, delimiter: ',', quote: '"', escape: 'double-quote', newline: 'auto' }, columns: [column], schemaRevision: 1, profileRevision: 1, updatedAt: '2026-11-16T00:00:00Z' },
    viewOrder: ['v1'], views: [{ ...view }]
  }
}

describe('CSV view schema and revisions', () => {
  it('ignores a corrupt or missing header digest without failing identity matching', async () => {
    const validIdentity: CsvFileIdentity = { name: 'data.csv', size: 4, lastModified: 1, headerDigest: 'a'.repeat(64), sampleDigest: null, folder: null }
    const brokenHeaderIdentity = { ...validIdentity, headerDigest: 'broken' }
    const missingHeaderIdentity = { ...validIdentity, headerDigest: undefined }
    expect(isCsvFileIdentity(validIdentity)).toBe(true)
    expect(isCsvFileIdentity(brokenHeaderIdentity)).toBe(false)
    expect(isCsvFileIdentity(missingHeaderIdentity)).toBe(false)
    await expect(matchIdentity(missingHeaderIdentity as unknown as CsvFileIdentity, null, [])).resolves.toEqual({ kind: 'new' })
  })

  it('validates a v1 bundle and rejects an unsupported operator', () => {
    expect(validateViewBundle(bundle()).ok).toBe(true)
    const invalid = bundle()
    invalid.views[0]!.filter = { op: 'hasAny', columnId: 'c1', optionIds: [] }
    const result = validateViewBundle(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((issue) => issue.code === 'operator-not-allowed')).toBe(true)
  })

  it('continues to read v1 layouts written before card role fields existed', () => {
    const legacy = bundle()
    legacy.views[0] = { ...view, layout: { kind: 'gallery', titleColumnId: 'c1', coverColumnId: null } }
    const result = validateViewBundle(legacy)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.views[0]?.layout).toEqual({ kind: 'gallery', titleColumnId: 'c1', coverColumnId: null, subtitleColumnId: null, badgeColumnIds: [], footerColumnIds: [] })
  })

  it('allows a gallery cover when its view override selects image display', () => {
    const gallery: CsvViewDefinition = { ...view, layout: { kind: 'gallery', titleColumnId: 'c1', coverColumnId: 'c1' }, displayOverrides: { c1: { label: null, display: { as: 'image' }, stateText: {} } } }
    expect(validateViewDefinition(gallery, [column]).ok).toBe(true)
    expect(validateViewDefinition({ ...gallery, displayOverrides: {} }, [column]).ok).toBe(false)
  })

  it('increments profile revision for every save and schema revision only for schema changes', () => {
    expect(nextRevisions(null, { schemaChanged: false })).toEqual({ schemaRevision: 1, profileRevision: 1 })
    expect(nextRevisions({ schemaRevision: 4, profileRevision: 8 }, { schemaChanged: false })).toEqual({ schemaRevision: 4, profileRevision: 9 })
    expect(nextRevisions({ schemaRevision: 4, profileRevision: 8 }, { schemaChanged: true })).toEqual({ schemaRevision: 5, profileRevision: 9 })
  })

  it('validates an exported multi-profile backup without trusting local identity', () => {
    const exported = bundle()
    const { kind: _kind, schemaVersion: _version, exportedAt, appVersion, ...profile } = exported
    expect(validateBackup({ kind: 'csv-view-backup', schemaVersion: 1, exportedAt, appVersion, profiles: [profile] }).ok).toBe(true)
    expect(validateBackup({ kind: 'csv-view-backup', schemaVersion: 9, exportedAt, appVersion, profiles: [] })).toMatchObject({ ok: false })
  })
})
