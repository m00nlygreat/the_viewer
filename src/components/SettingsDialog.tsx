import { useState } from 'react'
import { Check, Download, HardDrive, Info, Moon, Sun, Trash2, X } from 'lucide-react'
import type { ThemePreference } from '../domain/types'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  recoveryEnabled: boolean
  onRecoveryChange: (enabled: boolean) => void
  onClearData: () => void
  onClose: () => void
  onInstall: () => void
  canInstall: boolean
  platform: 'pwa' | 'extension'
}

const themeOptions: Array<{ id: ThemePreference; label: string; icon: typeof Sun; detail: string }> = [
  { id: 'system', label: '시스템', icon: HardDrive, detail: '기기 설정에 맞춥니다.' },
  { id: 'light', label: '라이트', icon: Sun, detail: '밝은 테마를 사용합니다.' },
  { id: 'dark', label: '다크', icon: Moon, detail: '어두운 테마를 사용합니다.' }
]

export function SettingsDialog({ theme, onThemeChange, recoveryEnabled, onRecoveryChange, onClearData, onClose, onInstall, canInstall, platform }: Props) {
  const [confirmClear, setConfirmClear] = useState(false)
  const dialog = useFocusTrap<HTMLElement>()
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="dialog-header"><div><h2 id="settings-title">설정</h2><p>테마와 로컬 작업 복구를 관리합니다.</p></div><button className="icon-button" aria-label="설정 닫기" onClick={onClose}><X size={17} /></button></header>
      <div className="settings-content">
        <section className="settings-section"><h3>테마</h3><div className="theme-options">{themeOptions.map(({ id, label, detail, icon: Icon }) => <button key={id} className={`theme-option${theme === id ? ' selected' : ''}`} onClick={() => onThemeChange(id)}><Icon size={16} /><span><strong>{label}</strong><small>{detail}</small></span>{theme === id && <Check size={15} />}</button>)}</div></section>
        <section className="settings-section"><h3>로컬 작업 복구</h3><div className="settings-row"><span className="settings-row-icon"><HardDrive size={16} /></span><span className="settings-row-copy"><strong>열린 파일 복구</strong><small>편집 중인 파일과 작업본을 이 기기에 저장합니다. 파일 내용은 서버로 전송되지 않습니다.</small></span><button className={`switch${recoveryEnabled ? ' on' : ''}`} role="switch" aria-checked={recoveryEnabled} aria-label="로컬 작업 복구" onClick={() => onRecoveryChange(!recoveryEnabled)}><span /></button></div>
          <button className="settings-action danger-text" onClick={() => confirmClear ? onClearData() : setConfirmClear(true)}><Trash2 size={15} /><span><strong>{confirmClear ? '다시 눌러 로컬 파일 삭제' : '로컬 저장 데이터 삭제'}</strong><small>작업 복구에 저장된 파일과 설정을 삭제합니다.</small></span></button>
        </section>
        {platform === 'pwa' && <section className="settings-section"><h3>앱 설치</h3><div className="settings-row"><span className="settings-row-icon"><Download size={16} /></span><span className="settings-row-copy"><strong>The Viewer 설치</strong><small>{canInstall ? '앱으로 설치해 오프라인에서 사용할 수 있습니다.' : '브라우저 메뉴에서 홈 화면에 추가할 수 있습니다.'}</small></span><button className="subtle-button" onClick={onInstall}>{canInstall ? '설치' : '안내'}</button></div></section>}
        <section className="settings-section"><h3>앱 정보</h3><div className="about-row"><Info size={15} /><span><strong>The Viewer</strong><small>버전 {__APP_VERSION__} · 이 브라우저에서만 파일을 처리합니다.</small></span></div><p className="privacy-copy">외부 네트워크 전송이나 분석 추적을 사용하지 않습니다. 확장 프로그램은 사용자가 요청한 HTTPS 링크 파일을 열 때에만 대상 사이트 권한을 요청합니다.</p><div className="about-links"><a href={`${__APP_BASE__}licenses/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">오픈소스 라이선스</a><a href="https://github.com/m00nlygreat/the_viewer/blob/main/docs/PRIVACY.md" target="_blank" rel="noreferrer">개인정보 처리 안내</a></div></section>
      </div>
    </section>
  </div>
}
