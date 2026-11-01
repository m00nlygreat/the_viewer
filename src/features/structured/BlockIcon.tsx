const icons = {
  object: 'M9 4H8a2 2 0 0 0-2 2v3.5a2.5 2.5 0 0 1-2 2.5 2.5 2.5 0 0 1 2 2.5V18a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2 2.5 2.5 2.5 0 0 0-2 2.5V18a2 2 0 0 1-2 2h-1',
  array: 'M9 4H5v16h4M15 4h4v16h-4',
  text: 'M5 6h14M12 6v13',
  number: 'M4 9h16M4 15h16M10 4 8 20M16 4l-2 16',
  boolean: 'M7 7h10a5 5 0 0 1 0 10H7a5 5 0 0 1 0-10zM16 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  date: 'M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 10h17M8 3v4M16 3v4',
  null: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM6.5 17.5l11-11',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
}
export type IconName = keyof typeof icons
export function BlockIcon({ name, size = 12 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'object' || name === 'array' ? 2 : 2.3} strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>
}
