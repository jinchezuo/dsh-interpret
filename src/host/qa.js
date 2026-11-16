/** Number/unit and glossary fidelity checks over one translated segment. */

function cleanNumber(value) {
  return String(value)
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[，]/g, ',')
    .replace(/\s+/g, '')
}

export function extractNumbers(text) {
  const value = String(text || '')
  const matches = value.match(/(?:\d+(?:[.,]\d+)?|\d+\/\d+)(?:\s?%|\s?(?:km|cm|mm|kg|g|mg|ms|s|min|h|Hz|kHz|MHz|GB|MB|KB|TB|°C|℃))?/g) || []
  return [...new Set(matches.map(cleanNumber))]
}

export function cjkRatio(text) {
  const chars = [...String(text || '')].filter((char) => /\S/.test(char))
  if (!chars.length) return 0
  const cjk = chars.filter((char) => /[\u3400-\u9fff]/.test(char)).length
  return cjk / chars.length
}

/**
 * Compare one source/translation pair.
 * @returns issues that should trigger one repair attempt.
 */
export function qaTranslation(source, target, glossaryHits = []) {
  const issues = []
  const sourceNumbers = extractNumbers(source)
  const targetNumbers = new Set(extractNumbers(target))
  const missingNumbers = sourceNumbers.filter((value) => !targetNumbers.has(value))
  if (missingNumbers.length) issues.push({ code: 'MISSING_NUMBER', values: missingNumbers })
  const requiredTerms = (glossaryHits || []).filter((hit) => hit.preferred && !hit.forbidden)
  const missingTerms = requiredTerms.filter((hit) =>
    !String(target || '').toLowerCase().includes(hit.target.toLowerCase()))
  if (missingTerms.length) issues.push({ code: 'MISSING_TERM', values: missingTerms.map((hit) => hit.source + '=>' + hit.target) })
  const forbidden = (glossaryHits || []).filter((hit) => hit.forbidden)
  const usedForbidden = forbidden.filter((hit) =>
    String(target || '').toLowerCase().includes(hit.target.toLowerCase()))
  if (usedForbidden.length) issues.push({ code: 'FORBIDDEN_TERM', values: usedForbidden.map((hit) => hit.source + '=>' + hit.target) })
  const ratio = cjkRatio(target)
  if (ratio < 0.25) issues.push({ code: 'NOT_CHINESE', values: [String(ratio.toFixed(2))] })
  if (/^(以下是|下面是|译文[:：]|翻译[:：])/.test(String(target || '').trim())) issues.push({ code: 'META_PREFIX', values: [] })
  return { ok: issues.length === 0, issues }
}

/** Prompt hint for the single repair attempt. */
export function repairBlock(issues) {
  if (!issues?.length) return ''
  const lines = []
  for (const issue of issues) {
    if (issue.code === 'MISSING_NUMBER') lines.push('上次漏掉了这些数字/单位：' + issue.values.join('、') + '，必须原样保留。')
    if (issue.code === 'MISSING_TERM') lines.push('上次没有使用指定术语：' + issue.values.join('、') + '，必须使用箭头右侧译法。')
    if (issue.code === 'FORBIDDEN_TERM') lines.push('上次使用了禁用译法：' + issue.values.join('、') + '，请换掉。')
    if (issue.code === 'NOT_CHINESE') lines.push('输出必须是简体中文译文，不要输出英文原文。')
    if (issue.code === 'META_PREFIX') lines.push('不要以“以下是”“译文：”等前缀开头。')
  }
  return lines.join('\n')
}
