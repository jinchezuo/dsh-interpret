import test from 'node:test'
import assert from 'node:assert/strict'
import { Translator } from '../src/host/translate.js'
import { normalizeConfig } from '../src/host/config.js'

function fakeContext(providers) {
  const llm = {
    listProviders: async () => Object.keys(providers).map((id) => ({ id, name: id })),
    listModels: async (id) => providers[id] || [],
  }
  return { get: (name) => (name === 'llm' ? llm : undefined) }
}

test('translator honours a valid configured provider/model pair', async () => {
  const translator = new Translator(fakeContext({
    workbuddy: [{ id: 'deepseek-v4.1-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }],
  }), normalizeConfig({ mtProvider: 'workbuddy', mtModel: 'deepseek-v4-pro' }), null)
  const description = await translator.describe(true)
  assert.equal(description.picked.provider, 'workbuddy')
  assert.equal(description.picked.model, 'deepseek-v4-pro')
  assert.equal(description.warning, '')
  assert.equal(description.routes[0].models[1].name, 'Pro')
})

test('provider without a model picks that provider first model', async () => {
  const translator = new Translator(fakeContext({
    workbuddy: [{ id: 'deepseek-v4.1-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }],
  }), normalizeConfig({ mtProvider: 'workbuddy', mtModel: '' }), null)
  const route = await translator.pickRoute(true)
  assert.deepEqual(route, { provider: 'workbuddy', model: 'deepseek-v4.1-flash' })
})

test('invalid saved model falls back and reports a warning', async () => {
  const translator = new Translator(fakeContext({
    workbuddy: [{ id: 'deepseek-v4.1-flash', name: 'Flash' }],
  }), normalizeConfig({ mtProvider: 'workbuddy', mtModel: 'removed-model' }), null)
  const description = await translator.describe(true)
  assert.equal(description.picked.model, 'deepseek-v4.1-flash')
  assert.match(description.warning, /不在当前 DSH 路由中/)
  assert.equal(description.requested.model, 'removed-model')
})

test('missing LLM routes produce an error instead of a fake route', async () => {
  const translator = new Translator(fakeContext({}), normalizeConfig({ mtProvider: '', mtModel: '' }), null)
  const description = await translator.describe(true)
  assert.equal(description.picked, null)
  assert.equal(description.routes.length, 0)
  assert.match(description.error, /没有已配置的翻译模型路由/)
})
