import { useMemo } from 'react'
import { container, scalar, slot } from '../../domain/structured/model'
import { inferSchemas } from '../../domain/structured/output'
import type { Payload } from '../../domain/structured/operations'
import { useBlocks } from './BlockContext'
import { BlockIcon, type IconName } from './BlockIcon'

const values: { type: IconName | 'color'; label: string; name: string; dataType: 'string' | 'number' | 'boolean' | 'null'; raw: string }[] = [
  { type: 'text', label: 'abc', name: '텍스트', dataType: 'string', raw: 'abc' },
  { type: 'number', label: '0', name: '숫자', dataType: 'number', raw: '0' },
  { type: 'boolean', label: 'true', name: '불리언', dataType: 'boolean', raw: 'true' },
  { type: 'date', label: '2026-10-29', name: '날짜', dataType: 'string', raw: '2026-10-29' },
  { type: 'color', label: '#E11D48', name: '색', dataType: 'string', raw: '#E11D48' },
  { type: 'null', label: '없음', name: '없음', dataType: 'null', raw: '' }
]
export function StructuredPalette() {
  const { model, startDrag, startPaletteKey, readonly } = useBlocks()
  const schemas = useMemo(() => inferSchemas(model), [model])
  const drag = (event: React.PointerEvent<HTMLElement>, payload: Payload) => { if (!readonly) startDrag(event, { type: 'palette', payload }, null) }
  return <aside className="sd-palette" aria-label="블록">
    <section><div className="sd-section-label">컨테이너</div><div className="sd-palette-list">
      {(['object', 'array'] as const).map((kind) => <div key={kind} role="button" tabIndex={0} className="sd-palette-container" onPointerDown={(event) => drag(event, { node: container(kind) })} onKeyDown={(event) => startPaletteKey(event, { node: container(kind) })}><BlockIcon name={kind} size={16} />{kind === 'object' ? '객체' : '배열'}</div>)}
    </div></section>
    <section><div className="sd-section-label">프로퍼티</div><div className="sd-palette-list">
      {['이름', '0'].map((name, index) => <div key={name} role="button" tabIndex={0} className="sd-palette-property" onPointerDown={(event) => drag(event, { slot: slot(index ? null : 'key', null) })} onKeyDown={(event) => startPaletteKey(event, { slot: slot(index ? null : 'key', null) })}><span>{name}</span><span className="sd-palette-socket" /></div>)}
    </div></section>
    <section><div className="sd-section-label">값</div><div className="sd-palette-list">
      {values.map((value) => <div key={value.name} role="button" tabIndex={0} className="sd-palette-value" onPointerDown={(event) => drag(event, { node: scalar(value.dataType, value.raw) })} onKeyDown={(event) => startPaletteKey(event, { node: scalar(value.dataType, value.raw) })}><span className={`sd-value sd-${value.type}`}>{value.type === 'color' ? <span className="sd-swatch" style={{ background: value.raw }} /> : <BlockIcon name={value.type} />}<span>{value.label}</span></span><small>{value.name}</small></div>)}
    </div></section>
    <section className="sd-schema-section"><div className="sd-schema-title"><span>스키마</span><span>{schemas.length}</span></div>
      <div className="sd-palette-list">{schemas.map((schema, index) => <div className="sd-schema" role="button" tabIndex={0} key={`${schema.name}-${index}`} onKeyDown={(event) => { const node = container('object'); node.items = schema.fields.map((field) => slot(field.key, null)); startPaletteKey(event, { node }) }} onPointerDown={(event) => {
        const node = container('object'); node.items = schema.fields.map((field) => slot(field.key, null)); drag(event, { node })
      }}><div className="sd-schema-head"><BlockIcon name="object" size={14} /><strong>{schema.name}</strong><small>{schema.count}곳</small></div><div className="sd-schema-fields">{schema.fields.map((field, fieldIndex) => <div key={`${field.key}-${fieldIndex}`}>{field.icon ? <BlockIcon name={field.icon} size={11} /> : <span className="sd-schema-icon-placeholder" />}<span>{field.key}{field.optional && <b>?</b>}</span></div>)}</div></div>)}</div>
    </section>
  </aside>
}
