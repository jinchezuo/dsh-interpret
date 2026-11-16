import { createElement as h } from 'react'

export function fmtClock(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

function fmtOffset(ms) {
  const total = Math.max(0, Number(ms || 0))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const tenth = Math.floor((total % 1000) / 100)
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + tenth
}

function StatusBadge({ segment }) {
  if (!segment) return null
  if (segment.status === 'done') return null
  if (segment.status === 'dropped') {
    return h('span', { className: 'di-meta di-badge dropped' }, '已过滤' + (segment.reason ? ' · ' + segment.reason : ''))
  }
  if (segment.status === 'error') {
    return h('span', { className: 'di-meta di-badge error' }, '失败')
  }
  if (segment.qa?.length) {
    return h('span', { className: 'di-meta di-badge', title: segment.qa.map((issue) => issue.code).join(', ') }, '需校对')
  }
  if (segment.status === 'translating') return h('span', { className: 'di-meta di-badge' }, '翻译中…')
  if (segment.status === 'asr') return h('span', { className: 'di-meta di-badge' }, '识别中…')
  return null
}

export function CaptionRow({ segment }) {
  return h('div', { className: 'di-row' },
    h('div', { className: 'di-meta' },
      h('span', { className: 'di-time' }, fmtOffset(segment.tStartMs)),
      h('span', { className: 'di-src' }, segment.track === 'system' ? '系统音频' : '麦克风'),
      segment.asrMs ? h('span', null, 'ASR ' + segment.asrMs + 'ms') : null,
      segment.mtMs ? h('span', null, 'MT ' + segment.mtMs + 'ms') : null,
      segment.termCorrections?.length ? h('span', {
        className: 'di-badge',
        title: segment.termCorrections.map((item) => item.from + ' → ' + item.to).join('\n'),
      }, '术语校正 ×' + segment.termCorrections.length) : null,
      h(StatusBadge, { segment })),
    h('div', { className: 'di-en' }, segment.en || '…'),
    segment.zh
      ? h('div', { className: 'di-zh' }, segment.zh)
      : (segment.status === 'translating' ? h('div', { className: 'di-zh pending' }, '翻译中…') : null),
    segment.error ? h('div', { className: 'di-note' }, segment.error.code + ': ' + segment.error.message) : null)
}

export function LiveRow({ item, showZh = true }) {
  if (!item?.en) return null
  const track = item.track === 'system' ? '系统音频' : '麦克风'
  return h('div', { className: 'di-row di-live' },
    h('div', { className: 'di-meta' },
      h('span', { className: 'di-time' }, '实时'),
      h('span', { className: 'di-src' }, track),
      h('span', { className: 'di-badge' }, item.engine === 'parakeet-rolling' ? '精确实时' : '逐词'),
      item.termCorrections?.length ? h('span', {
        className: 'di-badge',
        title: item.termCorrections.map((entry) => entry.from + ' → ' + entry.to).join('\n'),
      }, '术语校正 ×' + item.termCorrections.length) : null),
    h('div', { className: 'di-en di-live-en' }, item.en),
    showZh
      ? (item.zh
          ? h('div', { className: 'di-zh provisional' }, item.zh)
          : h('div', { className: 'di-zh pending' }, '翻译中…'))
      : null)
}
