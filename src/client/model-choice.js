/** Pure helpers for the translation-model picker. No React or DOM here. */

const OPEN_FAMILIES = [
  /^deepseek/i, /^qwen/i, /^glm/i, /^kimi/i, /^minimax/i, /^hunyuan/i, /^hy\d/i,
  /^step/i, /^mimo/i, /^llama/i, /^mistral/i, /^mixtral/i, /^gemma/i, /^phi/i,
  /^yi/i, /^internlm/i, /^baichuan/i,
]

export const PRESETS = [
  { id: 'cost', label: '省钱优先', title: '优先免费、Flash 或 Mini 档模型' },
  { id: 'quality', label: '高质量', title: '优先 Pro、Max、Plus 等旗舰模型' },
  { id: 'open', label: '开源系', title: '优先 DeepSeek、Qwen、GLM、Kimi 等开源家族' },
]

function textOf(model) {
  const id = model?.id || model?.model || ''
  return String(id + ' ' + (model?.name || '')).toLowerCase()
}

export function flattenRoutes(routes) {
  const out = []
  for (const route of Array.isArray(routes) ? routes : []) {
    for (const model of Array.isArray(route?.models) ? route.models : []) {
      if (!model?.id) continue
      out.push({
        provider: route.id,
        providerName: route.name || route.id,
        model: model.id,
        name: model.name || model.id,
        description: model.description || '',
      })
    }
  }
  return out
}

export function tagsForModel(model) {
  const text = textOf(model)
  const tags = []
  if (/\bfree\b|trial|promo|免费|试用/i.test(text)) tags.push('免费/试用')
  if (/flash|mini|turbo|lite|air|small/i.test(text)) tags.push('省钱')
  if (/pro|max|plus|opus|sonnet|kimi|glm-5|hy4std/i.test(text)) tags.push('高质')
  if (OPEN_FAMILIES.some((pattern) => pattern.test(String(model?.id || model?.model || '')))) tags.push('开源系')
  return tags
}

function costScore(model) {
  const text = textOf(model)
  if (/\bfree\b|trial|promo|免费|试用/i.test(text)) return 0
  if (/flash/i.test(text)) return 1
  if (/mini|turbo/i.test(text)) return 2
  if (/lite|air|small/i.test(text)) return 3
  if (/plus/i.test(text)) return 4
  if (/pro|max|opus|sonnet/i.test(text)) return 6
  return 5
}

function qualityScore(model) {
  const text = textOf(model)
  if (/opus|sonnet|pro|max/i.test(text)) return 5
  if (/plus|kimi|glm-5|hy4std/i.test(text)) return 4
  if (/flash|mini|turbo|lite|air|small/i.test(text)) return 2
  return 3
}

export function choosePreset(routes, preset) {
  const all = flattenRoutes(routes)
  if (!all.length) return null
  if (preset === 'cost') {
    return [...all].sort((a, b) => costScore(a) - costScore(b))[0]
  }
  if (preset === 'quality') {
    return [...all].sort((a, b) => qualityScore(b) - qualityScore(a))[0]
  }
  if (preset === 'open') {
    const open = all.filter((item) => tagsForModel(item).includes('开源系'))
    if (!open.length) return null
    return open.sort((a, b) => qualityScore(b) - qualityScore(a))[0]
  }
  return null
}

export function findModel(routes, provider, model) {
  return flattenRoutes(routes).find((item) => item.provider === provider && item.model === model) || null
}
