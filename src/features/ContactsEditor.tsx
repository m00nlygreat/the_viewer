import { useState } from 'react'
import { Building2, Mail, MapPin, Phone, Plus, Trash2, UserRound, Globe2, Pencil } from 'lucide-react'
import type { ContactModel, ViewerDocument } from '../domain/types'
import { addContact, removeContact, setContactItems, updateContact } from '../domain/vcard'

interface Props { document: ViewerDocument; model: ContactModel; onChange: (model: ContactModel, group?: 'typing' | 'command') => void }

export function ContactsEditor({ document, model, onChange }: Props) {
  const [selected, setSelected] = useState(model.cards[0]?.recordId ?? model.cards[0]?.uid ?? '')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(() => model.cards.length > 0 && !model.cards[0]?.fullName && !model.cards[0]?.organization && !model.cards[0]?.phones.length && !model.cards[0]?.emails.length)
  const canEdit = document.parseState === 'ready' && document.modelRevision === document.revision
  const contacts = model.cards
  const visible = contacts.filter((card) => `${card.fullName} ${card.organization} ${card.title} ${card.emails.map((item) => item.value).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const active = contacts.find((card) => (card.recordId ?? card.uid) === selected) ?? visible[0] ?? null
  const activeId = active?.recordId ?? active?.uid ?? ''
  const edit = (values: Parameters<typeof updateContact>[2]) => active && canEdit && onChange(updateContact(model, activeId, values), 'typing')
  const add = () => { if (!canEdit) return; const next = addContact(model); onChange(next); const card = next.cards[next.cards.length - 1]; setSelected(card.recordId ?? card.uid); setEditing(true) }
  const remove = () => { if (!active || !canEdit || !window.confirm(`“${active.fullName || '연락처'}”를 삭제할까요?`)) return; const next = removeContact(model, activeId); onChange(next); setSelected(next.cards[0]?.recordId ?? next.cards[0]?.uid ?? '') }

  return <section className="contacts-layout">
    <aside className="contact-list">
      <div className="contact-list-toolbar"><label className="search-box"><UserRound size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="연락처 검색" placeholder="연락처 검색" /></label><button className="icon-button" disabled={!canEdit} aria-label="연락처 추가" onClick={add}><Plus size={16} /></button></div>
      {model.diagnostics.length > 0 && <div className="inline-warning">{model.diagnostics[0]}</div>}
      {visible.map((card) => <button className={`contact-list-item${active?.recordId === card.recordId ? ' active' : ''}`} key={card.recordId} onClick={() => setSelected(card.recordId)}>
        <span className="contact-avatar">{(card.fullName || '?').slice(0, 1)}</span><span><strong>{card.fullName || '이름 없음'}</strong><small>{card.organization || card.emails[0]?.value || card.phones[0]?.value || '연락처'}</small></span>
      </button>)}
      {!visible.length && <div className="empty-state compact"><span>연락처가 없습니다.</span></div>}
    </aside>
    {active ? <main className="contact-detail">
      <div className="contact-cover"><div className="contact-avatar large">{(active.fullName || '?').slice(0, 1)}</div><div><span className="small-muted">vCard {active.version}</span><h1>{active.fullName || '이름 없음'}</h1><p>{active.title}{active.title && active.organization ? ' · ' : ''}{active.organization}</p></div><button className="subtle-button" disabled={!canEdit} onClick={() => setEditing((value) => !value)}><Pencil size={13} />{editing ? '편집 닫기' : '편집'}</button>{editing && <button className="icon-button danger-hover contact-delete" disabled={!canEdit} aria-label="연락처 삭제" onClick={remove}><Trash2 size={15} /></button>}</div>
      <div className="contact-fields">
        {editing && canEdit ? <>
          <section className="contact-section"><h2>기본 정보</h2><div className="contact-form-grid">
            <label className="form-field"><span>이름</span><input value={active.fullName} disabled={!canEdit} onChange={(event) => edit({ fullName: event.target.value })} /></label>
            <label className="form-field"><span>이름(구조)</span><input value={active.givenName} disabled={!canEdit} onChange={(event) => edit({ givenName: event.target.value })} /></label>
            <label className="form-field"><span>성</span><input value={active.familyName} disabled={!canEdit} onChange={(event) => edit({ familyName: event.target.value })} /></label>
            <label className="form-field"><span>소속</span><input value={active.organization} disabled={!canEdit} onChange={(event) => edit({ organization: event.target.value })} /></label>
            <label className="form-field"><span>직함</span><input value={active.title} disabled={!canEdit} onChange={(event) => edit({ title: event.target.value })} /></label>
          </div></section>
          <ContactItemEditor title="전화번호" icon={<Phone size={14} />} items={active.phones} disabled={!canEdit} onChange={(items, group) => onChange(setContactItems(model, activeId, 'phones', items), group)} />
          <ContactItemEditor title="이메일" icon={<Mail size={14} />} items={active.emails} disabled={!canEdit} onChange={(items, group) => onChange(setContactItems(model, activeId, 'emails', items), group)} />
          <section className="contact-section"><h2><MapPin size={14} /> 메모</h2><label className="form-field"><textarea rows={4} value={active.notes} disabled={!canEdit} onChange={(event) => edit({ notes: event.target.value })} placeholder="메모 추가" /></label></section>
        </> : <>
          {active.organization && <InfoRow icon={<Building2 size={16} />} label="소속" value={active.organization} />}
          {active.title && <InfoRow icon={<UserRound size={16} />} label="직함" value={active.title} />}
          <ContactItemView title="전화번호" icon={<Phone size={14} />} items={active.phones.map((item) => ({ value: item.value, label: item.label }))} />
          <ContactItemView title="이메일" icon={<Mail size={14} />} items={active.emails.map((item) => ({ value: item.value, label: item.label }))} />
          {active.urls.map((url) => <InfoRow key={url} icon={<Globe2 size={16} />} label="웹사이트" value={url} />)}
          {active.notes && <section className="contact-section"><h2>메모</h2><p>{active.notes}</p></section>}
        </>}
        <div className="contact-retention-note">이 연락처의 표시하지 않는 속성과 확장 필드는 그대로 보존합니다.</div>
      </div>
    </main> : <div className="empty-state"><UserRound size={24} /><strong>연락처를 선택하세요.</strong><button className="primary-button" disabled={!canEdit} onClick={add}><Plus size={15} /> 연락처 추가</button></div>}
  </section>
}

function ContactItemEditor({ title, icon, items, disabled, onChange }: { title: string; icon: React.ReactNode; items: Array<{ value: string; label: string }>; disabled: boolean; onChange: (items: Array<{ value: string; label: string }>, group?: 'typing' | 'command') => void }) {
  const rows = items.length ? items : [{ value: '', label: '기타' }]
  return <section className="contact-section"><div className="section-heading"><h2>{icon}{title}</h2><button className="subtle-button" disabled={disabled} onClick={() => onChange([...rows, { value: '', label: '기타' }])}><Plus size={13} /> 항목 추가</button></div>
    {rows.map((item, index) => <div className="repeat-field-row" key={`${title}-${index}`}><select disabled={disabled} aria-label={`${title} 유형 ${index + 1}`} value={item.label} onChange={(event) => onChange(rows.map((value, row) => row === index ? { ...value, label: event.target.value } : value), 'command')}><option>기타</option><option>cell</option><option>work</option><option>home</option><option>fax</option></select><input disabled={disabled} value={item.value} aria-label={`${title} ${index + 1}`} onChange={(event) => onChange(rows.map((value, row) => row === index ? { ...value, value: event.target.value } : value), 'typing')} /><button className="icon-button" disabled={disabled} aria-label={`${title} ${index + 1} 삭제`} onClick={() => onChange(rows.filter((_, row) => row !== index), 'command')}><Trash2 size={13} /></button></div>)}
  </section>
}

function ContactItemView({ title, icon, items }: { title: string; icon: React.ReactNode; items: Array<{ value: string; label: string }> }) {
  return items.length ? <section className="contact-section"><h2>{icon}{title}</h2>{items.map((item, index) => <InfoRow key={`${item.value}-${index}`} icon={icon} label={item.label} value={item.value} />)}</section> : null
}
function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="contact-info-row"><span className="contact-info-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>
}
