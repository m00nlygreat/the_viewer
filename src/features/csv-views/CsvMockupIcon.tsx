import type { ReactNode, SVGProps } from 'react'
import type { CsvLayout } from '../../domain/csv-views/model'

type IconName = CsvLayout['kind'] | 'plus'

const icons: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  gallery: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  kanban: <><rect x="3" y="3" width="5" height="14" rx="1.5" /><rect x="10" y="3" width="5" height="9" rx="1.5" /><rect x="17" y="3" width="4" height="18" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
}

export function CsvMockupIcon({ name, size = 15, ...props }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {icons[name]}
  </svg>
}
