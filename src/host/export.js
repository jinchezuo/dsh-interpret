/** SRT and Markdown rendering for one saved session. */

function pad(value, length = 2) {
  return String(value).padStart(length, '0')
}

function srtTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds) + ',' + pad(millis, 3)
}

function usable(segments) {
  return (segments || []).filter((segment) => segment.en && segment.status !== 'dropped')
}

export function toSrt(segments, lang = 'en') {
  const rows = usable(segments)
  return rows.map((segment, index) => {
    const text = lang === 'zh' ? (segment.zh || '') : segment.en
    return String(index + 1) + '\n' + srtTime(segment.tStartMs) + ' --> ' + srtTime(segment.tEndMs) + '\n' + text + '\n'
  }).join('\n')
}

export function toBilingualSrt(segments) {
  const rows = usable(segments)
  return rows.map((segment, index) =>
    String(index + 1) + '\n' + srtTime(segment.tStartMs) + ' --> ' + srtTime(segment.tEndMs) + '\n' +
    segment.en + '\n' + (segment.zh || '') + '\n').join('\n')
}

export function toMarkdown(session, segments) {
  const rows = usable(segments)
  const lines = []
  lines.push('# ' + (session?.title || '同传记录'))
  lines.push('')
  if (session?.startedAt) lines.push('- 开始：' + new Date(session.startedAt).toISOString())
  if (session?.endedAt) lines.push('- 结束：' + new Date(session.endedAt).toISOString())
  lines.push('- 句数：' + rows.length)
  lines.push('')
  for (const segment of rows) {
    lines.push('## [' + srtTime(segment.tStartMs) + ']' + (segment.track === 'system' ? ' 系统音频' : ' 麦克风'))
    lines.push('')
    lines.push('**EN** ' + segment.en)
    lines.push('')
    lines.push('**中文** ' + (segment.zh || '（未翻译）'))
    lines.push('')
  }
  return lines.join('\n')
}

export function exportPayload(format, session, segments) {
  if (format === 'srt-en') return { body: toSrt(segments, 'en'), type: 'application/x-subrip; charset=utf-8', extension: 'srt' }
  if (format === 'srt-zh') return { body: toSrt(segments, 'zh'), type: 'application/x-subrip; charset=utf-8', extension: 'srt' }
  if (format === 'srt-bilingual') return { body: toBilingualSrt(segments), type: 'application/x-subrip; charset=utf-8', extension: 'srt' }
  if (format === 'md' || format === 'markdown') return { body: toMarkdown(session, segments), type: 'text/markdown; charset=utf-8', extension: 'md' }
  return null
}
