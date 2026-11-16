import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { InterpretIcon } from './icon.js'

const PHASE_LABEL = {
  idle: '空闲',
  listening: '正在监听',
  stopping: '正在收尾',
  completed: '已结束',
  error: '出错',
}

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

function preparationLabel(prep) {
  if (!prep) return '未知'
  const phase = prep.phase
  if (phase === 'ready') return '就绪'
  if (phase === 'prepared' || phase === 'standby') return '待命'
  if (phase === 'unprepared') return '未准备'
  if (phase === 'downloading') {
    const done = Number(prep.completedBytes || 0)
    const total = Number(prep.totalBytes || 0)
    const suffix = total ? ' ' + (done / 1048576).toFixed(0) + '/' + (total / 1048576).toFixed(0) + 'MB' : ' ' + (done / 1048576).toFixed(0) + 'MB'
    return '下载中' + suffix
  }
  if (phase === 'checking') return '校验中'
  if (phase === 'loading') return '加载中'
  if (phase === 'failed') return '准备失败'
  if (phase === 'cancelled') return '已取消'
  return String(phase)
}

function prepPercent(prep) {
  if (!prep || prep.phase !== 'downloading') return null
  const total = Number(prep.totalBytes || 0)
  if (!total) return null
  return Math.max(0, Math.min(100, (Number(prep.completedBytes || 0) / total) * 100))
}

function Chip(props) {
  return h('span', { className: 'di-chip' },
    h('span', { className: 'di-dot ' + (props.tone || '') }),
    props.children)
}

function Kv(props) {
  return h('div', { className: 'di-kv' }, h('span', null, props.label), h('span', null, props.value))
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
  const pending = segment.status === 'translating' || segment.status === 'asr'
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

export function PanelView({ controller, openDock, dockAvailable }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { state, segments, busy, error, connection, modelProgress, elapsed, testResult, testBusy, audioInfo, draft, live, termSearch, history, historyView, models } = snapshot
  const listRef = useRef(null)
  const stickRef = useRef(true)
  const [showDropped, setShowDropped] = useState(false)
  const [dismissed, setDismissed] = useState(null)
  const [testText, setTestText] = useState('The eigenvalue decomposition of a symmetric matrix is always possible.')
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [glossaryText, setGlossaryText] = useState('')
  const [glossaryDirty, setGlossaryDirty] = useState(false)
  const [brief, setBrief] = useState('')
  const [briefDirty, setBriefDirty] = useState(false)
  const [termQuery, setTermQuery] = useState('')
  const glossary = snapshot.glossary

  useEffect(() => {
    if (glossaryDirty) return
    const entries = glossary?.entries
    if (!Array.isArray(entries)) return
    setGlossaryText(entries.map((entry) => entry.source + ' => ' + entry.target).join('\n'))
  }, [glossary, glossaryDirty])

  useEffect(() => {
    if (briefDirty) return
    setBrief(String(state?.config?.brief || ''))
  }, [state?.config?.brief, briefDirty])

  const saveGlossary = () => {
    const entries = glossaryText.split(/\r?\n/)
      .map((line) => line.split(/\s*=>\s*/))
      .filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim())
      .map((parts) => ({ source: parts[0].trim(), target: parts.slice(1).join(' => ').trim() }))
    controller.saveGlossary(entries).then(() => setGlossaryDirty(false))
  }

  const importGlossaryFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const extension = String(file.name.split('.').pop() || '').toLowerCase()
    const format = extension === 'tmx' ? 'tmx' : extension === 'json' ? 'json' : extension === 'tsv' ? 'tsv' : 'csv'
    const reader = new FileReader()
    reader.onload = () => { controller.importGlossary(String(reader.result || ''), format) }
    reader.readAsText(file)
    event.target.value = ''
  }

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [segments.length, live?.mic?.en, live?.system?.en, live?.mic?.zh, live?.system?.zh])

  useEffect(() => {
    if (!state) controller.refresh()
  }, [])

  const running = state?.phase === 'listening'
  const stopping = state?.phase === 'stopping'
  const picked = state?.asr?.picked
  const providerReady = picked?.preparation?.phase === 'ready'
  const autoTranslate = state?.config?.autoTranslate !== false
  const mt = state?.mt
  const visible = segments.filter((segment) => showDropped || segment.status !== 'dropped')
  const liveRows = [live?.mic, live?.system].filter((item) => item?.en)
  const errorText = error || state?.lastError?.message || ''
  const showError = errorText && dismissed !== errorText
  const blockedReason = !providerReady
    ? '语音模型未就绪，请先在右侧准备模型'
    : (autoTranslate && !mt?.provider ? '没有可用的翻译模型路由' : '')
  const canStart = !busy && !running && !stopping && !blockedReason
  const listeningTone = running ? 'live' : (stopping ? 'warn' : '')
  const modelPercent = prepPercent(modelProgress?.preparation || picked?.preparation)
  const elapsedMs = running ? elapsed : (state?.elapsedMs || 0)

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
  }

  return h('div', { className: 'dsh-interpret-root' },
    h('header', { className: 'di-header' },
      h('div', { className: 'di-title' }, h(InterpretIcon, { size: 18 }), h('span', null, '同声传译')),
      h(Chip, { tone: listeningTone }, running ? '正在监听 ' + fmtClock(elapsedMs) : (PHASE_LABEL[state?.phase] || '加载中')),
      h('span', { className: 'di-sub' }, segments.length + ' 段'),
      h('span', { className: 'di-spacer' }),
      (running || stopping)
        ? h('button', {
            className: 'di-btn danger',
            disabled: busy || stopping,
            onClick: () => controller.stop(),
          }, stopping ? '正在收尾…' : '停止')
        : h('button', {
            className: 'di-btn primary',
            disabled: !canStart,
            title: blockedReason || '开始麦克风同传',
            onClick: () => controller.start(),
          }, busy ? '启动中…' : '开始同传'),
      h('button', {
        className: 'di-btn ghost',
        disabled: busy,
        onClick: () => controller.refresh(),
        title: '刷新状态',
      }, '刷新'),
      dockAvailable ? h('button', {
        className: 'di-btn ghost',
        onClick: () => openDock && openDock(),
        title: '在右侧栏打开实时字幕',
      }, '右栏显示') : null,
      h('button', {
        className: 'di-btn ghost',
        onClick: () => setSettingsOpen((value) => !value),
        title: '显示或隐藏右侧设置',
      }, settingsOpen ? '隐藏设置' : '设置')),

    showError ? h('div', { className: 'di-banner' },
      h('span', null, errorText),
      h('span', { className: 'di-spacer' }),
      h('button', { className: 'di-btn ghost', onClick: () => setDismissed(errorText) }, '关闭')) : null,

    h('div', { className: 'di-body' },
      h('main', { className: 'di-main' },
        h('div', { className: 'di-list', ref: listRef, onScroll },
          visible.length
            ? visible.map((segment) => h(CaptionRow, { key: segment.id, segment }))
            : (liveRows.length ? null : h('div', { className: 'di-empty' },
                h('strong', null, running ? '正在聆听英文讲解…' : '准备开始实时英中字幕'),
                h('div', null, running
                  ? '英文会逐词出现，中文译文随后更新。'
                  : '点击右上角「开始同传」，允许麦克风后即可实时显示英文原句与中文译文。'))),
          liveRows.map((item) => h(LiveRow, { key: 'live-' + item.track, item, showZh: autoTranslate })),
          draft?.en ? h('div', { className: 'di-row di-draft' },
            h('div', { className: 'di-meta' }, '草稿 · ' + (draft.track === 'system' ? '系统音频' : '麦克风')),
            h('div', { className: 'di-en di-draft-en' }, draft.en)) : null,
          h('div', { style: { height: '1px' } }))),

      settingsOpen ? h('aside', { className: 'di-aside' },
        h('section', { className: 'di-card' },
          h('h4', null, '语音识别'),
          state?.asr?.providers?.length > 1 ? h('select', {
            className: 'di-select',
            value: picked?.id || '',
            onChange: (event) => controller.saveConfig({ asrProvider: event.target.value }),
          }, state.asr.providers.map((provider) =>
            h('option', { key: provider.id, value: provider.id }, provider.name))) : h(Kv, { label: 'Provider', value: picked ? picked.name : '未发现' }),
          h(Kv, { label: '状态', value: preparationLabel(picked?.preparation) }),
          h(Kv, { label: '模型目录', value: picked?.preparation?.directory || '—' }),
          ['downloading', 'checking', 'loading'].includes(picked?.preparation?.phase)
            ? h('div', { className: 'di-actions' }, h('button', { className: 'di-btn', onClick: () => controller.cancelPrepare(picked?.id) }, '取消准备'))
            : null,
          modelPercent !== null ? h('div', { className: 'di-progress' }, h('div', { style: { width: modelPercent + '%' } })) : null,
          !providerReady ? h('div', { className: 'di-actions' },
            h('button', {
              className: 'di-btn primary',
              disabled: busy || modelProgress?.preparation?.phase === 'downloading',
              onClick: () => controller.prepare(picked?.id),
            }, modelProgress?.preparation?.phase === 'downloading' ? '下载中…' : '准备本机模型'),
            h('span', { className: 'di-note' }, '首次约 239MB，仅下载一次。')) : h('div', { className: 'di-note' }, '本机识别，音频不出机器。')),

        h('section', { className: 'di-card' },
          h('h4', null, '逐词实时'),
          h(Kv, { label: '模式', value: state?.config?.streamingMode === 'off' ? '关闭' : (models?.streaming?.ready ? '已就绪' : '未下载') }),
          h('select', {
            className: 'di-select',
            value: state?.config?.streamingMode || 'auto',
            onChange: (event) => controller.saveConfig({ streamingMode: event.target.value }),
          }, ['auto', 'on', 'off'].map((mode) => h('option', { key: mode, value: mode }, mode === 'auto' ? '自动（推荐）' : mode === 'on' ? '必须逐词' : '关闭（整段回退）'))),
          models?.streaming?.ready
            ? h('div', { className: 'di-note' }, '英文流式模型已就绪，边说边出词。')
            : h('div', { className: 'di-actions' },
                h('button', {
                  className: 'di-btn primary',
                  disabled: busy || (models?.streaming?.progress || state?.streaming?.progress)?.phase === 'downloading',
                  onClick: () => controller.prepareStreaming(),
                }, (models?.streaming?.progress || state?.streaming?.progress)?.phase === 'downloading' ? '下载中…' : '下载逐词模型（73MB）'),
                h('span', { className: 'di-note' }, '首次下载，仅用于实时英文。')),
          (models?.streaming?.progress || state?.streaming?.progress)?.phase === 'downloading'
            ? h('div', { className: 'di-note' }, '流式模型 ' + ((models?.streaming?.progress || state?.streaming?.progress).completedBytes / 1048576).toFixed(0) + '/' + ((models?.streaming?.progress || state?.streaming?.progress).totalBytes / 1048576).toFixed(0) + 'MB')
            : null,
          h('div', { className: 'di-note' }, '定稿仍由 Parakeet 复核，术语更准。')),

        h('section', { className: 'di-card' },
          h('h4', null, '识别精度'),
          h(Kv, { label: '采样率', value: audioInfo?.sampleRate ? audioInfo.sampleRate + 'Hz' : '未开始' }),
          h('select', {
            className: 'di-select',
            value: state?.config?.liveAsrMode || 'balanced',
            onChange: (event) => controller.saveConfig({ liveAsrMode: event.target.value }),
          }, [['fast', '低延迟（弱流式）'], ['balanced', '平衡（流式 + Parakeet 校正）'], ['accurate', '高精度（Parakeet 实时）']].map(([value, label]) => h('option', { key: value, value }, label))),
          h('select', {
            className: 'di-select',
            value: state?.config?.vadProfile || 'robust',
            onChange: (event) => controller.saveConfig({ vadProfile: event.target.value }),
          }, [['robust', '切句稳健（推荐，少碎片）'], ['standard', '标准'], ['sensitive', '灵敏（更快出句）']].map(([value, label]) => h('option', { key: value, value }, label))),
          h('select', {
            className: 'di-select',
            value: state?.config?.audioProfile || 'auto',
            onChange: (event) => controller.saveConfig({ audioProfile: event.target.value }),
          }, [['auto', '麦克风自动增强'], ['clean', '强降噪/回声消除'], ['raw', '原始音频（诊断用）']].map(([value, label]) => h('option', { key: value, value }, label))),
          h('div', { className: 'di-note' }, '平衡模式先用流式出字，约 0.6 秒后用 Parakeet 校正；定稿再合并整句。')),

        h('section', { className: 'di-card' },
          h('h4', null, '学科术语 RAG'),
          h(Kv, { label: '术语库', value: state?.terminology?.ready ? (state.terminology.count + ' 条') : '未加载' }),
          h(Kv, { label: '中文/音标', value: state?.terminology?.ready ? (state.terminology.zhCount + ' / ' + state.terminology.ipaCount) : '—' }),
          h('select', {
            className: 'di-select',
            value: state?.config?.terminologyDomains || 'auto',
            onChange: (event) => controller.saveConfig({ terminologyDomains: event.target.value }),
          }, [
            ['auto', '自动识别学科'], ['all', '全部学科'], ['ai', '人工智能'], ['math', '数学'], ['statistics', '统计'],
            ['biology', '生物'], ['urban', '城市规划'], ['architecture', '建筑'], ['electronics', '电子信息'], ['tech', '通用科技'],
          ].map(([value, label]) => h('option', { key: value, value }, label))),
          h('select', {
            className: 'di-select',
            value: state?.config?.terminologyMode || 'auto',
            onChange: (event) => controller.saveConfig({ terminologyMode: event.target.value }),
          }, [['auto', '术语 RAG 自动'], ['on', '强制启用'], ['off', '关闭']].map(([value, label]) => h('option', { key: value, value }, label))),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              type: 'checkbox',
              checked: state?.config?.termCorrection !== false,
              onChange: (event) => controller.saveConfig({ termCorrection: event.target.checked }),
            }),
            '术语自动校正（定稿 + 实时）'),
          h('div', { className: 'di-actions' },
            h('input', {
              className: 'di-select',
              style: { flex: 1, minWidth: 0 },
              value: termQuery,
              placeholder: '查术语 / 音标，如 large language model',
              onChange: (event) => setTermQuery(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') controller.searchTerminology(termQuery, state?.config?.terminologyDomains) },
            }),
            h('button', { className: 'di-btn', disabled: termSearch?.busy, onClick: () => controller.searchTerminology(termQuery, state?.config?.terminologyDomains) }, termSearch?.busy ? '查询中' : '查询')),
          termSearch?.results?.length
            ? h('div', { className: 'di-term-results' }, termSearch.results.slice(0, 8).map((term) =>
                h('div', { key: term.source, className: 'di-term' },
                  h('div', { className: 'di-term-head' }, h('strong', null, term.source), h('span', null, term.zh || '（无中文）')),
                  term.ipaUk || term.ipaUs ? h('div', { className: 'di-note' }, [term.ipaUk && ('UK ' + term.ipaUk), term.ipaUs && ('US ' + term.ipaUs)].filter(Boolean).join('  ·  ')) : null,
                  h('div', { className: 'di-note' }, (term.domains || []).join('/') + (term.definition ? ' · ' + term.definition.slice(0, 140) : '')))))
            : null,
          h('div', { className: 'di-note' }, '本地术语库；定稿时用 RAG 检索 + 模型校验，实时行只做高置信别名纠正。')),

        h('section', { className: 'di-card' },
          h('h4', null, '降噪 / VAD'),
          h(Kv, { label: '模式', value: state?.config?.vadMode === 'energy' ? '能量 VAD' : (models?.vad?.ready ? 'Silero + 能量回退' : '能量 VAD（Silero 未下载）') }),
          h('select', {
            className: 'di-select',
            value: state?.config?.vadMode || 'auto',
            onChange: (event) => controller.saveConfig({ vadMode: event.target.value }),
          }, ['auto', 'silero', 'energy'].map((mode) => h('option', { key: mode, value: mode }, mode === 'auto' ? '自动' : mode === 'silero' ? 'Silero' : '能量'))),
          !models?.vad?.ready ? h('div', { className: 'di-actions' },
            h('button', { className: 'di-btn', onClick: () => controller.prepareVad() }, '下载 Silero VAD（2MB）')) : h('div', { className: 'di-note' }, '本机语音活动检测已就绪。')),

        h('section', { className: 'di-card' },
          h('h4', null, '翻译'),
          h(Kv, { label: '路由', value: mt?.provider || '未选择' }),
          h(Kv, { label: '模型', value: mt?.model || '—' }),
          h(Kv, { label: '模式', value: autoTranslate ? '英译中' : '只转写' }),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
            h('input', {
              type: 'checkbox',
              checked: autoTranslate,
              onChange: (event) => controller.saveConfig({ autoTranslate: event.target.checked }),
            }),
            '启用中文翻译'),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              type: 'checkbox',
              checked: state?.config?.liveTranslate !== false,
              onChange: (event) => controller.saveConfig({ liveTranslate: event.target.checked }),
            }),
            '中文草稿同步（边听边译）'),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              type: 'checkbox',
              checked: state?.config?.systemAudio !== 'off',
              onChange: (event) => controller.saveConfig({ systemAudio: event.target.checked ? 'auto' : 'off' }),
            }),
            '采集系统音频（下次开始生效）'),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' } },
            h('input', {
              type: 'checkbox',
              checked: state?.config?.draftMode !== false,
              onChange: (event) => controller.saveConfig({ draftMode: event.target.checked }),
            }),
            '流式草稿（边说边出英文）'),
          h('textarea', {
            style: { width: '100%', minHeight: '48px', boxSizing: 'border-box', resize: 'vertical', border: '1px solid var(--di-border)', borderRadius: '8px', padding: '6px 8px', marginTop: '6px', background: 'var(--di-surface)', color: 'var(--di-fg)', font: 'inherit', fontSize: '12px' },
            value: brief,
            placeholder: '场景说明：如「线性代数研究生课，听众有数学背景；保持定理与符号准确」',
            onChange: (event) => { setBrief(event.target.value); setBriefDirty(true) },
            spellCheck: false,
          }),
          h('div', { className: 'di-actions' },
            h('button', {
              className: 'di-btn',
              onClick: () => { controller.saveConfig({ brief }).then(() => setBriefDirty(false)) },
            }, '保存场景说明')),
          h('div', { className: 'di-actions' },
            h('button', { className: 'di-btn', disabled: busy, onClick: () => controller.refresh() }, '重新检测路由'))),

        h('section', { className: 'di-card' },
          h('h4', null, '翻译自测'),
          h('div', { className: 'di-test' },
            h('textarea', {
              value: testText,
              onChange: (event) => setTestText(event.target.value),
              spellCheck: false,
            }),
            h('div', { className: 'di-actions' },
              h('button', {
                className: 'di-btn',
                disabled: testBusy || !testText.trim(),
                onClick: () => controller.translateTest(testText),
              }, testBusy ? '翻译中…' : '试翻译'))),
          testResult ? h('div', { className: 'di-result', style: { marginTop: '8px' } },
            testResult.ok
              ? testResult.text
              : ('失败: ' + testResult.message)) : null),

        h('section', { className: 'di-card' },
          h('h4', null, '术语表 (' + (glossary?.count ?? 0) + ')'),
          h('textarea', {
            className: 'di-test-textarea',
            style: { width: '100%', minHeight: '84px', boxSizing: 'border-box', resize: 'vertical', border: '1px solid var(--di-border)', borderRadius: '8px', padding: '6px 8px', background: 'var(--di-surface)', color: 'var(--di-fg)', font: 'inherit', fontSize: '12px' },
            value: glossaryText,
            placeholder: 'eigenvalue => 特征值\ntrace => 迹',
            onChange: (event) => { setGlossaryText(event.target.value); setGlossaryDirty(true) },
            spellCheck: false,
          }),
          h('div', { className: 'di-actions' },
            h('button', { className: 'di-btn', disabled: snapshot.glossaryBusy, onClick: saveGlossary }, snapshot.glossaryBusy ? '保存中…' : '保存术语'),
            h('label', { className: 'di-btn', style: { cursor: 'pointer' } },
              '导入',
              h('input', { type: 'file', accept: '.csv,.tsv,.tmx,.json,text/plain', style: { display: 'none' }, onChange: importGlossaryFile }))),
          h('div', { className: 'di-note' }, '每行 source => target；导入支持 CSV/TSV/TMX/JSON。')),

        h('section', { className: 'di-card' },
          h('h4', null, '导出'),
          h('div', { className: 'di-actions' },
            h('a', { className: 'di-btn', href: controller.exportUrl('srt-bilingual'), download: 'interpret-bilingual.srt' }, '双语 SRT'),
            h('a', { className: 'di-btn', href: controller.exportUrl('srt-en'), download: 'interpret-en.srt' }, '英文 SRT'),
            h('a', { className: 'di-btn', href: controller.exportUrl('srt-zh'), download: 'interpret-zh.srt' }, '中文 SRT'),
            h('a', { className: 'di-btn', href: controller.exportUrl('md'), download: 'interpret.md' }, 'Markdown')),
          h('div', { className: 'di-note' }, '导出当前会话已完成的双语字幕。')),

        h('section', { className: 'di-card' },
          h('h4', null, '本次统计'),
          h(Kv, { label: '完成句数', value: String(state?.stats?.segments ?? 0) }),
          h(Kv, { label: '已过滤', value: String(state?.stats?.dropped ?? 0) }),
          h(Kv, { label: '回声去重', value: String(state?.stats?.echoDropped ?? 0) }),
          h(Kv, { label: '错误', value: String(state?.stats?.errors ?? 0) }),
          h(Kv, { label: 'ASR 平均', value: state?.stats?.avgAsrMs ? state.stats.avgAsrMs + 'ms' : '—' }),
          h(Kv, { label: '翻译平均', value: state?.stats?.avgMtMs ? state.stats.avgMtMs + 'ms' : '—' }),
          h(Kv, { label: '首字平均', value: state?.stats?.avgFirstTokenMs ? state.stats.avgFirstTokenMs + 'ms' : '—' }),
          h(Kv, { label: '实时更新', value: String(state?.stats?.liveUpdates ?? 0) }),
          h(Kv, { label: '中文草稿', value: String(state?.stats?.liveTranslateCount ?? 0) }),
          h(Kv, { label: '术语纠正', value: String(state?.stats?.termRepairs ?? 0) }),
          h(Kv, { label: '质检修正', value: String(state?.stats?.qaRepairs ?? 0) }),
          h('label', { className: 'di-note', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px' } },
            h('input', {
              type: 'checkbox',
              checked: showDropped,
              onChange: (event) => setShowDropped(event.target.checked),
            }),
            '显示已过滤片段')),

        h('section', { className: 'di-card' },
          h('h4', null, '历史会话'),
          h('div', { className: 'di-actions' },
            h('button', { className: 'di-btn', onClick: () => controller.loadSessions() }, '刷新历史')),
          !history?.length
            ? h('div', { className: 'di-note' }, '还没有已保存的会话。')
            : history.slice(0, 8).map((item) => h('div', { className: 'di-history-item', key: item.id },
                h('div', { className: 'di-history-title' }, item.title),
                h('div', { className: 'di-note' }, (item.startedAt ? new Date(item.startedAt).toLocaleString() : item.id) + ' · ' + item.segments + ' 句'),
                h('div', { className: 'di-actions' },
                  h('button', { className: 'di-btn', onClick: () => controller.openSession(item.id) }, '查看'),
                  h('a', { className: 'di-btn', href: controller.exportUrl('srt-bilingual', item.id), download: 'interpret-' + item.id + '.srt' }, '导出'),
                  h('button', { className: 'di-btn danger', onClick: () => {
                    if (window.confirm('删除会话「' + item.title + '」？此操作不可恢复。')) controller.deleteSession(item.id)
                  } }, '删除'))))),

        h('section', { className: 'di-card' },
          h('h4', null, '运行信息与诊断'),
          h(Kv, { label: '阶段', value: PHASE_LABEL[state?.phase] || state?.phase || '—' }),
          h(Kv, { label: '连接', value: connection === 'open' ? 'SSE 实时' : '轮询兜底' }),
          h(Kv, { label: '音轨', value: [state?.tracks?.mic ? '麦克风' : null, state?.tracks?.system ? '系统音频' : null].filter(Boolean).join(' + ') || '未采集' }),
          h(Kv, { label: 'ASR', value: picked?.id || '—' }),
          h(Kv, { label: '翻译', value: mt ? mt.provider + ' / ' + mt.model : '未选择' }),
          h(Kv, { label: '停止原因', value: state?.stopReason || '—' }),
          h(Kv, { label: '空闲', value: state?.idleMs ? Math.round(state.idleMs / 1000) + 's' : '—' }),
          h(Kv, { label: '数据目录', value: state?.config?.dataDir || '—' }),
          h(Kv, { label: 'VAD 阈值', value: String(state?.config?.vadThreshold ?? '—') }),
          h('div', { className: 'di-note' }, '音频仅在本机识别；只有识别文本会发送到你配置的 DSH 模型路由。'))) : null),

    h('footer', { className: 'di-footer' },
      h('span', null, connection === 'open' ? '实时连接正常' : '连接中断，正在重连…'),
      h('span', { className: 'di-spacer' }),
      h('span', null, '会话 ' + (state?.sessionId || '—')),
      h('span', null, '用时 ' + fmtClock(elapsedMs))),

    historyView ? h('div', { className: 'di-modal-backdrop' },
      h('div', { className: 'di-modal' },
        h('div', { className: 'di-modal-head' },
          h('strong', null, historyView.title || historyView.id),
          h('span', { className: 'di-spacer' }),
          h('button', { className: 'di-btn', onClick: () => controller.closeSession() }, '关闭')),
        h('div', { className: 'di-modal-list' },
          (historyView.segments || []).filter((segment) => segment.status !== 'dropped').map((segment) => h(CaptionRow, { key: segment.id, segment }))),
        h('div', { className: 'di-footer' },
          h('span', null, (historyView.segments || []).length + ' 段'),
          h('span', { className: 'di-spacer' }),
          h('a', { className: 'di-btn', href: controller.exportUrl('srt-bilingual', historyView.id), download: 'interpret-' + historyView.id + '.srt' }, '双语 SRT'),
          h('a', { className: 'di-btn', href: controller.exportUrl('md', historyView.id), download: 'interpret-' + historyView.id + '.md' }, 'Markdown')))) : null)
}
