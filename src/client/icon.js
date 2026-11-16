import { createElement as h } from 'react'

/** Sidebar panel icon: EN/中文 subtitle bars. */
export function InterpretIcon(props = {}) {
  const size = props.size || 20
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  },
  h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }),
  h('path', { d: 'M7 10h6M7 14h10M16 10h1' }))
}
