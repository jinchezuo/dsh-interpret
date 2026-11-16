import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReaderService } from '../src/host/reader.js'

test('reader stores, lists, reads and deletes handouts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reader-'))
  const reader = new ReaderService(dir)
  const saved = await reader.save('Lecture Notes.md', Buffer.from('# Eigenvalues\n\nA is symmetric.'))
  assert.equal(saved.ext, 'md')
  const list = await reader.list()
  assert.ok(list.some((item) => item.id === saved.id))
  const loaded = await reader.get(saved.id)
  assert.equal(loaded.name, 'Lecture Notes.md')
  const raw = await reader.readRaw(saved.id)
  assert.ok(raw.buffer.toString('utf8').includes('Eigenvalues'))
  await reader.remove(saved.id)
  await assert.rejects(() => reader.get(saved.id), (error) => error.code === 'FILE_NOT_FOUND')
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

test('reader rejects unsupported, empty and unsafe files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reader-'))
  const reader = new ReaderService(dir)
  await assert.rejects(() => reader.save('virus.exe', Buffer.from('x')), (error) => error.code === 'UNSUPPORTED_FILE')
  await assert.rejects(() => reader.save('empty.pdf', Buffer.alloc(0)), (error) => error.code === 'EMPTY_FILE')
  await assert.rejects(() => reader.get('../sessions'), (error) => error.code === 'INVALID_FILE_ID')
  await assert.rejects(() => reader.get('not-a-real-file'), (error) => error.code === 'FILE_NOT_FOUND')
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})
