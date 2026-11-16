import { Component, createElement as h } from 'react'
import { Controller } from './controller.js'
import { PanelView } from './panel.js'
import { CaptionDock } from './dock.js'
import { InterpretIcon } from './icon.js'
import { ensureStyles } from './styles.js'

export const inject = ['slots']

const DOCK_ID = 'dsh-interpret/captions'
const DOCK_KIND = 'interpret-captions'

function reportClient(type, extra = {}) {
  try {
    fetch('/interpret/api/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...extra }),
      cache: 'no-store',
    }).catch(() => {})
  } catch {}
}

/** Keep a rendering failure visible instead of silently blanking the panel. */
class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportClient('render-error', {
      message: String(error?.message || error).slice(0, 1200),
      stack: String(error?.stack || '').slice(0, 2400),
      componentStack: String(info?.componentStack || '').slice(0, 2400),
    })
  }

  render() {
    if (this.state.error) {
      return h('div', { className: 'di-banner', style: { margin: '16px' } },
        h('span', null, '同传面板渲染错误：' + String(this.state.error.message || this.state.error)))
    }
    return this.props.children
  }
}

/** Browser half: sidebar entry, main panel, optional right-dock captions, live controller. */
export function apply(ctx) {
  ensureStyles()
  const controller = new Controller()
  controller.connect()
  let dockAvailable = false
  let sidebarRight = null
  let failure = null

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      reportClient('window-error', { message: String(event?.message || ''), stack: String(event?.error?.stack || '').slice(0, 2400) })
    })
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason
      reportClient('unhandled-rejection', { message: String(reason?.message || reason || ''), stack: String(reason?.stack || '').slice(0, 2400) })
    })
  }

  const reportStatus = () => {
    reportClient('client-ready', {
      dockAvailable,
      failure,
      hasSidebarRight: Boolean(sidebarRight),
    })
  }

  const openDock = () => {
    try {
      if (!sidebarRight) throw new Error('当前 DSH 未提供右侧栏')
      sidebarRight.openTab(DOCK_KIND)
    } catch (error) {
      controller.update({ error: '右栏字幕打开失败：' + String(error?.message || error) })
    }
  }

  const Panel = () => h(Boundary, null, h(PanelView, { controller, openDock, dockAvailable }))
  const Dock = () => h(Boundary, null, h(CaptionDock, { controller }))

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
    sidebarRight = scope.sidebarRight
    try {
      scope.effect(() => scope.sidebarRightTabs.register({
        id: DOCK_ID,
        kind: DOCK_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => '同传字幕',
        guide: [{
          id: 'captions',
          order: 10,
          title: () => '同传字幕',
          description: () => '实时英中双语字幕',
        }],
      }), 'dsh-interpret: dock type')
      scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
        name: 'sidebar.right.pane.tab',
        key: DOCK_ID,
      }, Dock))
      dockAvailable = true
      failure = null
    } catch (error) {
      failure = String(error?.message || error)
      console.warn('[dsh-interpret] right dock unavailable:', failure)
    }
    reportStatus()
  })

  try {
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'interpret' }, Panel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'interpret',
      order: 9,
      label: () => '同传',
    }, InterpretIcon))
  } catch (error) {
    failure = String(error?.message || error)
    console.error('[dsh-interpret] panel registration failed:', failure)
  }

  ctx.effect(() => () => controller.dispose(), 'dsh-interpret: dispose client controller')
  reportStatus()
}
