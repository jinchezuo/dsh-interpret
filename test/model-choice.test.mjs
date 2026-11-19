import test from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, choosePreset, findModel, flattenRoutes, tagsForModel } from '../src/client/model-choice.js'

const routes = [
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    models: [
      { id: 'hy4flash-free', name: 'Hy4 flash', description: 'free trial' },
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { id: 'space-bunny', name: 'Space-Bunny' },
    ],
  },
  {
    id: 'qianwen',
    name: '千问 AI 平台',
    models: [
      { id: 'qwen3.8-flash', name: 'Qwen3.8-Flash' },
      { id: 'qwen4-max', name: 'Qwen4-Max' },
    ],
  },
]

test('model tags identify free, cheap, high-quality and open families', () => {
  assert.deepEqual(tagsForModel({ id: 'hy4flash-free', name: 'Hy4 flash' }), ['免费/试用', '省钱', '开源系'])
  assert.deepEqual(tagsForModel({ id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' }), ['省钱', '开源系'])
  assert.deepEqual(tagsForModel({ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }), ['高质', '开源系'])
  assert.deepEqual(tagsForModel({ id: 'space-bunny', name: 'Space-Bunny' }), [])
})

test('presets choose an available model and expose its route', () => {
  const cost = choosePreset(routes, 'cost')
  assert.equal(cost.provider, 'workbuddy')
  assert.equal(cost.model, 'hy4flash-free')
  const quality = choosePreset(routes, 'quality')
  assert.equal(quality.model, 'deepseek-v4-pro')
  const open = choosePreset(routes, 'open')
  assert.equal(open.model, 'deepseek-v4-pro')
  assert.ok(PRESETS.some((preset) => preset.id === 'cost'))
})

test('flattening and lookup keep provider/model pairs distinct', () => {
  const flat = flattenRoutes(routes)
  assert.equal(flat.length, 6)
  assert.equal(findModel(routes, 'qianwen', 'deepseek-v4-pro'), null)
  assert.equal(findModel(routes, 'workbuddy', 'deepseek-v4-pro').providerName, 'WorkBuddy')
  assert.equal(choosePreset([], 'cost'), null)
})
