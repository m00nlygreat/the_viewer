import type { CsvViewBackup } from '../../domain/csv-views/model'

interface Props {
  profiles: CsvViewBackup['profiles']
  onSelect(index: number): void
  onCancel(): void
}

export function CsvBackupProfileDialog({ profiles, onSelect, onCancel }: Props) {
  return <div className="csv-view-editor-overlay"><section className="csv-view-editor csv-backup-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="csv-backup-profile-title">
    <header><div><h2 id="csv-backup-profile-title">백업 프로필 선택</h2><p>현재 CSV 파일에 복원할 프로필을 선택하세요. 파일·컬럼 연결을 확인한 뒤 설정을 적용합니다.</p></div><button type="button" className="icon-button" aria-label="백업 선택 닫기" onClick={onCancel}>×</button></header>
    <div className="csv-view-editor-body csv-backup-profile-list">{profiles.map((profile, index) => <button type="button" className="csv-backup-profile-option" key={`${profile.source.fileName}-${index}`} onClick={() => onSelect(index)}>
      <span><strong>{profile.source.fileName}</strong><small>{profile.source.columnCount}개 컬럼 · {profile.views.length}개 보기</small></span><span aria-hidden="true">›</span>
    </button>)}</div>
    <footer><button type="button" className="secondary-button" onClick={onCancel}>취소</button></footer>
  </section></div>
}
