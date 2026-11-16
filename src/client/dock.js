import { createElement as h, useEffect, useRef, useSyncExternalStore } from 'react'
import { CaptionRow, LiveRow, fmtClock } from './panel.js'

/** Compact docked caption view for the right sidebar tab. */
export function CaptionDock({ controller }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { state, segments, busy, connection, error, draft, live } = snapshot
  const listRef = useRef(null)
  const stickRef = useRef(true)
  const running = state?.phase === 'listening'
  const stopping = state?.phase === 'stopping'
  const picked = state?.asr?.picked
  const providerReady = picked?.preparation?.phase === 'ready'
  const mt = state?.mt
  const autoTranslate = state?.config?.autoTranslate !== false
  const canStart = !busy && !running && !stopping && providerReady && (!autoTranslate || Boolean(mt?.provider))
  const visible = segments.filter((segment) => segment.status !== 'dropped').slice(-60)
  const liveRows = [live?.mic, live?.system].filter((item) => item?.en)
  const elapsed = running ? snapshot.elapsed : (state?.elapsedMs || 0)

  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [segments.length, live?.mic?.en, live?.system?.en])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  return h('div', { className: 'dsh-interpret-root di-dock' },
    h('div', { className: 'di-dock-head' },
      h('span', { className: 'di-title' }, '同传字幕'),
      h('span', { className: 'di-chip' }, h('span', { className: 'di-dot ' + (running ? 'live' : '') }), running ? fmtClock(elapsed) : (state?.phase === 'completed' ? '已结束' : '空闲')),
      h('span', { className: 'di-spacer' }),
      (running || stopping)
        ? h('button', { className: 'di-btn danger', disabled: busy || stopping, onClick: () => controller.stop() }, stopping ? '收尾中' : '停止')
        : h('button', { className: 'di-btn primary', disabled: !canStart, onClick: () => controller.start(), title: !providerReady ? '先在主面板准备模型' : (!mt?.provider && autoTranslate ? '没有翻译路由' : '开始同传') }, busy ? '启动中' : '开始')),
    error ? h('div', { className: 'di-banner' }, h('span', null, error)) : null,
    h('div', { className: 'di-list di-dock-list', ref: listRef, onScroll },
      visible.length
        ? visible.map((segment) => h(CaptionRow, { key: segment.id, segment }))
        : (liveRows.length ? null : h('div', { className: 'di-empty' },
            h('strong', null, running ? '正在聆听…' : '等待开始'),
            h('div', null, running ? '英文逐词出现，中文随后更新。' : '可在主面板开始，或点这里直接开始。'))),
      liveRows.map((item) => h(LiveRow, { key: 'live-' + item.track, item, showZh: autoTranslate })),
      draft?.en ? h('div', { className: 'di-row di-draft' }, h('div', { className: 'di-meta' }, '草稿'), h('div', { className: 'di-en' }, draft.en)) : null,
      h('div', { style: { height: '1px' } })),
    h('div', { className: 'di-footer' },
      h('span', null, connection === 'open' ? '实时' : '轮询'),
      h('span', { className: 'di-spacer' }),
      h('span', null, state?.stats?.segments ? state.stats.segments + ' 句' : '—'),
      h('span', null, state?.tracks?.system ? '双音轨' : '麦克风')))
}
