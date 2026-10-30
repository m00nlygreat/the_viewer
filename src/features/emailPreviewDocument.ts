export function createEmailPreviewDocument(sanitizedHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:"><style>html{color-scheme:light;background:#fff}body{font:17px/1.75 system-ui,sans-serif;color:#202124;background:#fff;margin:16px;overflow-wrap:anywhere}a{color:#0b57d0}</style></head><body>${sanitizedHtml}</body></html>`
}
