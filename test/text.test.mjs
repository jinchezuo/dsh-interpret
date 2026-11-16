import test from 'node:test'
import assert from 'node:assert/strict'
import { isLikelyEnglish, similarSpeech } from '../src/host/service.js'
import { qaTranslation, repairBlock } from '../src/host/qa.js'
import { Glossary } from '../src/host/glossary.js'
import { toBilingualSrt, toMarkdown } from '../src/host/export.js'

test('English gate accepts academic sentences and rejects Chinese/noise', () => {
  assert.equal(isLikelyEnglish('The eigenvalue decomposition of a symmetric matrix is always possible.'), true)
  assert.equal(isLikelyEnglish('这个特征值分解总是可能的'), false)
  assert.equal(isLikelyEnglish('the the the the the the the'), false)
  assert.equal(isLikelyEnglish(''), false)
})

test('QA flags missing numbers and glossary terms', () => {
  const issues = qaTranslation('The gain is 3.5% with eigenvalue 2.', '增益是 3.5%。', [{ source: 'eigenvalue', target: '特征值', preferred: true }])
  assert.equal(issues.ok, false)
  assert.ok(issues.issues.some((issue) => issue.code === 'MISSING_TERM'))
  const ok = qaTranslation('The gain is 3.5%.', '增益是 3.5%。', [])
  assert.equal(ok.ok, true)
  assert.ok(repairBlock([{ code: 'MISSING_NUMBER', values: ['3.5%'] }]).includes('3.5%'))
})

test('glossary repairs likely ASR misspellings', async () => {
  const glossary = new Glossary('/tmp/dsh-interpret-test-glossary')
  await glossary.save([
    { source: 'eigenvalue', target: '特征值', preferred: true },
    { source: 'Hamiltonian', target: '哈密顿量', preferred: true },
  ])
  const repaired = glossary.repairAsr('The Egenvalu is small; the Hmiltonian is Hermitian.')
  assert.equal(repaired.repairs.length, 2)
  assert.ok(repaired.text.includes('eigenvalue'))
  assert.ok(repaired.text.includes('Hamiltonian'))
  const untouched = glossary.repairAsr('The matrix is symmetric.')
  assert.equal(untouched.repairs.length, 0)
})

test('SRT and Markdown exports carry both languages', () => {
  const segments = [
    { en: 'Hello world.', zh: '你好，世界。', tStartMs: 0, tEndMs: 1500, status: 'done', track: 'mic' },
    { en: 'Second line.', zh: '第二行。', tStartMs: 2000, tEndMs: 3500, status: 'done', track: 'system' },
  ]
  const srt = toBilingualSrt(segments)
  assert.ok(srt.includes('00:00:00,000 --> 00:00:01,500'))
  assert.ok(srt.includes('Hello world.'))
  assert.ok(srt.includes('你好，世界。'))
  const md = toMarkdown({ title: 'Test' }, segments)
  assert.ok(md.includes('**EN** Hello world.'))
  assert.ok(md.includes('**中文** 你好，世界。'))
})

test('similarSpeech catches the same utterance across tracks', () => {
  assert.equal(similarSpeech('The eigenvalue decomposition is always possible.', 'the eigenvalue decomposition is always possible'), true)
  assert.equal(similarSpeech('The eigenvalue decomposition is possible.', 'The Hamiltonian is Hermitian.'), false)
  assert.equal(similarSpeech('short one', 'short one'), false)
})

