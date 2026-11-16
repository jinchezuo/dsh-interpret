import test from 'node:test'
import assert from 'node:assert/strict'
import { Terminology } from '../src/host/terminology.js'
import { TermCorrector } from '../src/host/term-corrector.js'
import { normalizeConfig } from '../src/host/config.js'

async function readyTerminology(t) {
  const term = new Terminology({ dataDir: '/tmp/dsh-term-test' })
  const loaded = await term.load()
  if (!loaded) { t.skip('terminology corpus not built'); return null }
  return term
}

test('terminology corpus has all domains and pronunciation', async (t) => {
  const term = await readyTerminology(t)
  if (!term) return
  const stats = term.stats()
  assert.ok(stats.count >= 2500, 'expected a substantive corpus, got ' + stats.count)
  for (const domain of ['ai', 'math', 'statistics', 'biology', 'urban', 'architecture', 'electronics', 'tech']) {
    assert.ok(stats.domains[domain] > 0, 'missing domain ' + domain)
  }
  const hits = term.search('large language model', { limit: 5 })
  const llm = hits.find((hit) => /large language model/i.test(hit.source))
  assert.ok(llm, 'large language model should be searchable')
  assert.ok(llm.zh, 'large language model should have a Chinese name')
  assert.ok(llm.ipaUk || llm.ipaUs, 'large language model should have IPA')
})

test('retrieval surfaces large language model for laboratory model in AI context', async (t) => {
  const term = await readyTerminology(t)
  if (!term) return
  const hits = term.retrieve('the laboratory model can generate text', { domains: ['ai'], topK: 10 })
  assert.ok(hits.some((hit) => hit.source === 'large language model'), 'expected large language model candidate')
})

test('live correction is domain-gated', async (t) => {
  const term = await readyTerminology(t)
  if (!term) return
  const ai = term.correctLive('the laboratory model can generate text', ['ai'])
  assert.equal(ai.text, 'the large language model can generate text')
  assert.equal(ai.corrections.length, 1)
  const biology = term.correctLive('a laboratory model organism was used', ['biology'])
  assert.equal(biology.text, 'a laboratory model organism was used')
  assert.equal(biology.corrections.length, 0)
})

test('term corrector accepts candidate-backed JSON and rejects unknown terms', async (t) => {
  const term = await readyTerminology(t)
  if (!term) return
  const hits = term.retrieve('the laboratory model can generate text', { domains: ['ai'], topK: 10 })
  let response = '{"corrections":[{"from":"laboratory model","to":"large language model","termId":"large-language-model","confidence":0.95}]}'
  const ctx = {
    get: (name) => name === 'llm' ? {
      stream: async () => (async function* () {
        yield { type: 'text-delta', text: response }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    } : undefined,
  }
  const config = normalizeConfig({ termCorrection: true, termCorrectionTimeoutMs: 2000 })
  const corrector = new TermCorrector(ctx, config, { info() {}, warn() {} })
  const route = { provider: 'deepseek-account', model: 'deepseek-flash' }
  const result = await corrector.correct('the laboratory model can generate text', { hits, route })
  assert.equal(result.text, 'the large language model can generate text')
  assert.equal(result.corrections[0].to, 'large language model')

  response = '{"corrections":[{"from":"laboratory model","to":"quantum gravity","confidence":0.9}]}'
  const rejected = await corrector.correct('a laboratory model is useful', { hits, route })
  assert.equal(rejected.text, 'a laboratory model is useful')
  assert.equal(rejected.corrections.length, 0)

  response = '{"corrections":[{"from":"laboratory model","to":"large language model","confidence":0.9}]}'
  const biology = await corrector.correct('a laboratory model organism was used', { hits, route, domains: ['biology'] })
  assert.equal(biology.text, 'a laboratory model organism was used', 'biology context must not be rewritten as AI')
  assert.equal(biology.corrections.length, 0)
})
