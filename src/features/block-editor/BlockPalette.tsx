import type { ReactNode } from 'react'

export interface BlockPaletteSection { title: string; items: ReactNode }

export function BlockPalette({ sections, ariaLabel = '블록', className, afterFixed }: { sections: readonly BlockPaletteSection[]; ariaLabel?: string; className?: string; afterFixed?: ReactNode }) {
  return <aside className={`sd-palette${className ? ` ${className}` : ''}`} aria-label={ariaLabel}>
    <div className="sd-palette-fixed">{sections.map((section) => <section key={section.title}><div className="sd-section-label">{section.title}</div><div className="sd-palette-list">{section.items}</div></section>)}</div>
    {afterFixed}
  </aside>
}
