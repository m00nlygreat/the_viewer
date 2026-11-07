import { scalar, slot } from '../../domain/structured/model'
import type { Payload } from '../../domain/structured/operations'
import { BlockIcon } from '../structured/BlockIcon'
import { useBlocks } from '../block-editor/BlockContext'
import { BlockPalette } from '../block-editor/BlockPalette'

export function EnvPalette() {
  const { readonly, startDrag, startPaletteKey } = useBlocks()
  const property = (): Payload => ({ slot: slot('key', null) })
  const value = (): Payload => ({ node: scalar('string', 'abc') })
  return <BlockPalette className="env-palette" sections={[
    { title: '프로퍼티', items: <div role="button" tabIndex={0} className="sd-palette-property" aria-disabled={readonly} onPointerDown={(event) => { if (!readonly) startDrag(event, { type: 'palette', payload: property() }, null) }} onKeyDown={(event) => { if (!readonly) startPaletteKey(event, property()) }}><span>이름</span><span className="sd-palette-socket" /></div> },
    { title: '값', items: <div role="button" tabIndex={0} className="sd-palette-value" aria-disabled={readonly} onPointerDown={(event) => { if (!readonly) startDrag(event, { type: 'palette', payload: value() }, null) }} onKeyDown={(event) => { if (!readonly) startPaletteKey(event, value()) }}><span className="sd-value sd-text"><BlockIcon name="text" /><span>abc</span></span><small>문자열</small></div> }
  ]} />
}
