import { Component, createElement as h } from 'react'
import { Controller } from './controller.js'
import { PanelView } from './panel.js'
import { CaptionDock } from './dock.js'
import { InterpretIcon } from './icon.js'
import { ensureStyles } from './styles.js'

export const inject = ['slots']

const DOCK_ID = 'dsh-interpret/captions'
const DOCK_KIND = 'interpret-captions'
const DOCK_DEFINITION = {
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
}

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
  controller.setDock({ available: false, registered: false, reason: '右侧栏加载中…', mounted: false, expanded: false })

  let dockAvailable = false
  let sidebarRight = null
  let sidebarRightTabs = null
  let failure = null
  let dockTimeout = null

  const reportStatus = () => {
    const mounted = Boolean(sidebarRight?.mounted?.getSnapshot?.())
    const expanded = Boolean(sidebarRight?.isExpanded?.())
    controller.setDock({
      available: dockAvailable,
      registered: Boolean(sidebarRightTabs?.get?.(DOCK_KIND)),
      mounted,
      expanded,
      reason: dockAvailable ? null : (failure || '右侧栏加载中…'),
    })
    try {
      fetch('/interpret/api/client-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dockAvailable,
          registered: Boolean(sidebarRightTabs?.get?.(DOCK_KIND)),
          hasSidebarRight: Boolean(sidebarRight),
          mounted,
          expanded,
          failure,
        }),
        cache: 'no-store',
      }).catch(() => {})
    } catch {}
  }

  const registerDock = (scope) => {
    const tabs = scope.sidebarRightTabs
    if (!tabs) throw new Error('右侧栏 tab 注册器不可用')
    const existing = tabs.get?.(DOCK_KIND)
    if (existing && existing.id !== DOCK_ID) throw new Error('右栏 kind 已被其他插件占用')
    let disposeTab = null
    if (!existing) {
      // Never call register() inside an effect: the DSH registry adds its own
      // effect to the sidebar fiber and an active foreign effect can stall boot.
      disposeTab = tabs.register(DOCK_DEFINITION)
    }
    scope.effect(() => () => {
      try { disposeTab?.() } catch {}
    }, 'dsh-interpret: dock type cleanup')
    scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab',
      key: DOCK_ID,
    }, Dock))
    const definition = tabs.get?.(DOCK_KIND)
    if (!definition || definition.id !== DOCK_ID) throw new Error('右栏字幕类型注册未生效')
    return true
  }

  const openDock = () => {
    const fail = (error) => {
      const message = String(error?.message || error)
      failure = message
      controller.setDock({ available: false, reason: message })
      controller.update({ error: '右栏字幕打开失败：' + message })
      reportStatus()
    }
    if (!sidebarRight) {
      fail(new Error('右侧栏服务未就绪，请刷新页面'))
      return
    }
    if (!sidebarRightTabs?.get?.(DOCK_KIND)) {
      fail(new Error('右栏字幕类型未注册，请刷新页面'))
      return
    }
    const mounted = sidebarRight.mounted?.getSnapshot?.()
    if (!mounted) {
      fail(new Error('当前没有打开的会话，无法打开右栏'))
      return
    }
    const attempt = () => {
      sidebarRight.openTab(DOCK_KIND, { revealIfOpened: true })
      if (sidebarRight.isExpanded?.() === false) sidebarRight.toggleExpanded?.()
      dockAvailable = true
      failure = null
      controller.setDock({ available: true, registered: true, mounted: true, expanded: true, reason: null })
      reportStatus()
    }
    try {
      attempt()
    } catch (error) {
      // The session store may be adopted one frame after the click.
      setTimeout(() => {
        try { attempt() } catch (retryError) { fail(retryError) }
      }, 120)
    }
  }

  const Panel = () => h(Boundary, null, h(PanelView, { controller, openDock }))
  const Dock = () => h(Boundary, null, h(CaptionDock, { controller }))

  // Keep the main panel and sidebar entry independent of the optional right dock.
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

  try {
    ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
      if (dockTimeout) clearTimeout(dockTimeout)
      dockTimeout = null
      sidebarRight = scope.sidebarRight
      sidebarRightTabs = scope.sidebarRightTabs
      // Leave the inject callback frame before touching the registry.
      setTimeout(() => {
        try {
          registerDock(scope)
          dockAvailable = true
          failure = null
        } catch (error) {
          failure = String(error?.message || error)
          console.warn('[dsh-interpret] right dock unavailable:', failure)
        }
        reportStatus()
      }, 0)
    })
  } catch (error) {
    failure = String(error?.message || error)
    console.warn('[dsh-interpret] sidebarRight injection failed:', failure)
    reportStatus()
  }

  dockTimeout = setTimeout(() => {
    dockTimeout = null
    if (!dockAvailable && !failure) failure = '右侧栏服务未就绪（3 秒超时），请刷新页面'
    reportStatus()
  }, 3000)

  ctx.effect(() => () => {
    if (dockTimeout) clearTimeout(dockTimeout)
    try { controller.dispose() } catch {}
  }, 'dsh-interpret: dispose client controller')
  reportStatus()
}
