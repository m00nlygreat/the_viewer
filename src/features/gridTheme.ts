import { getDefaultTheme, type Theme as GridTheme } from '@glideapps/glide-data-grid'

export const GRID_FONT_FAMILY = "'Geist Variable', 'Noto Sans KR Variable', sans-serif"
export const GRID_BASE_FONT_STYLE = '13px'
export const GRID_HEADER_FONT_STYLE = '500 12px'

export function createGridTheme(theme: 'light' | 'dark', overrides: Partial<Pick<GridTheme, 'fontFamily' | 'headerFontStyle' | 'baseFontStyle' | 'markerFontStyle' | 'editorFontSize'>> = {}): GridTheme {
  const light = theme === 'light'
  return {
    ...getDefaultTheme(),
    accentColor: light ? '#4A52C4' : '#A4AAF7',
    accentLight: light ? 'rgba(74, 82, 196, 0.16)' : 'rgba(164, 170, 247, 0.20)',
    accentFg: light ? '#FCFCFD' : '#0B0B0C',
    textDark: light ? '#1C1D21' : '#E6E6E8',
    textMedium: light ? '#3D3E44' : '#C9CACE',
    textLight: light ? '#62636A' : '#8A8B91',
    textBubble: light ? '#1C1D21' : '#E6E6E8',
    bgIconHeader: light ? '#F4F4F6' : '#0E0E10',
    fgIconHeader: light ? '#62636A' : '#8A8B91',
    textHeader: light ? '#62636A' : '#8A8B91',
    textHeaderSelected: light ? '#1C1D21' : '#F2F2F3',
    bgCell: light ? '#FCFCFD' : '#0B0B0C',
    bgCellMedium: light ? '#F4F4F6' : '#0E0E10',
    bgHeader: light ? '#F4F4F6' : '#0E0E10',
    bgHeaderHasFocus: light ? '#E6E6EB' : '#1D1E21',
    bgHeaderHovered: light ? '#E6E6EB' : '#1D1E21',
    bgBubble: light ? '#E6E6EB' : '#1D1E21',
    bgBubbleSelected: light ? '#D9DBF7' : '#353859',
    bgSearchResult: light ? '#D9DBF7' : '#353859',
    borderColor: light ? '#E4E4E8' : '#1E1F22',
    horizontalBorderColor: light ? '#EEEEF1' : '#17181B',
    headerBottomBorderColor: light ? '#E4E4E8' : '#1E1F22',
    drilldownBorder: light ? '#4A52C4' : '#5B63D3',
    linkColor: light ? '#4A52C4' : '#A4AAF7',
    fontFamily: GRID_FONT_FAMILY,
    headerFontStyle: GRID_HEADER_FONT_STYLE,
    baseFontStyle: GRID_BASE_FONT_STYLE,
    markerFontStyle: "11px 'Geist Mono Variable', 'Noto Sans Mono', monospace",
    editorFontSize: '13px',
    ...overrides
  }
}
