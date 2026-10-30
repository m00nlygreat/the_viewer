export function safeDisplayFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, ' ').trim() || '이름 없음'
}
