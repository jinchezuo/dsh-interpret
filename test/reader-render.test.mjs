import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReaderService } from '../src/host/reader.js'

const FIXTURES = new URL('./fixtures/reader/', import.meta.url)

test('Office handouts render with the Python standard library', async (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    t.skip('reader Python assets are verified on macOS and Windows')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reader-render-'))
  const reader = new ReaderService(dir)
  t.after(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

  for (const [name, expected] of [
    ['lecture.docx', 'Eigenvalues'],
    ['lecture.xlsx', 'Ada'],
    ['lecture.pptx', 'Linear Algebra'],
  ]) {
    const buffer = await readFile(new URL(name, FIXTURES))
    const saved = await reader.save(name, buffer)
    const rendered = await reader.render(saved.id)
    assert.ok(rendered.html.includes(expected), name + ' should contain ' + expected)
  }
})

test('legacy .doc falls back to the pure JS extractor', async (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    t.skip('legacy .doc fallback is verified on macOS and Windows')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reader-doc-'))
  const reader = new ReaderService(dir)
  t.after(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 3 }) })
  const saved = await reader.save('lecture.doc', await readFile(new URL('lecture.doc', FIXTURES)))
  const meta = await reader.get(saved.id)
  const rendered = await reader.renderDocFallback(meta, join(meta.dir, 'doc-fallback.html'))
  assert.ok(rendered.html.includes('Eigenvalues'))
})
