import { createElement as h } from 'react'
import { Controller } from './controller.js'
import { PanelView } from './panel.js'
import { CaptionDock } from './dock.js'
import { InterpretIcon } from './icon.js'
import { ensureStyles } from './styles.js'

export const inject = ['slots']

const DOCK_ID = 'dsh-interpret/captions'
const DOCK_KIND = 'interpret-captions'

/** Browser half: sidebar entry, main panel, optional right-dock captions, live controller. */
export function apply(ctx) {
  ensureStyles()
  const controller = new Controller()
  controller.connect()
  let dockAvailable = false
  let sidebarRight = null
  let failure = null

  const reportClient = () => {
    fetch('/interpret/api/client-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dockAvailable,
        failure,
        hasSidebarRight: Boolean(sidebarRight),
      }),
    }).catch(() => {})
  }

  const openDock = () => {
    try {
      if (!sidebarRight) throw new Error('当前 DSH 未提供右侧栏')
      sidebarRight.openTab(DOCK_KIND)
    } catch (error) {
      controller.update({ error: '右栏字幕打开失败：' + String(error?.message || error) })
    }
  }

  const Panel = () => h(PanelView, { controller, openDock, dockAvailable })

  // The right Sidebar is an optional service: wait for it instead of reading
  // ctx.sidebarRight directly (Cordis forbids that without an inject edge).
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
      }, () => h(CaptionDock, { controller })))
      dockAvailable = true
      failure = null
    } catch (error) {
      failure = String(error?.message || error)
      console.warn('[dsh-interpret] right dock unavailable:', failure)
    }
    reportClient()
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
  reportClient()
}
