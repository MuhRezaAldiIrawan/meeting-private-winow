import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesStore } from './NotesStore'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notes-store-'))
  file = join(dir, 'notes.md')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('NotesStore', () => {
  it('returns empty string when the file does not exist', async () => {
    const store = new NotesStore(file)
    await expect(store.read()).resolves.toBe('')
  })

  it('round-trips content', async () => {
    const store = new NotesStore(file)
    await store.write('# Agenda\n- Intro')
    await expect(store.read()).resolves.toBe('# Agenda\n- Intro')
  })

  it('leaves no temporary file behind after writing', async () => {
    const store = new NotesStore(file)
    await store.write('hello')
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('preserves unicode content exactly', async () => {
    const store = new NotesStore(file)
    const content = '# Catatan\n\n- emoji 🚀\n- "kutip" & <tag>'
    await store.write(content)
    await expect(store.read()).resolves.toBe(content)
  })

  it('does not corrupt the previous content when the write fails', async () => {
    const store = new NotesStore(file)
    await store.write('original')
    // The parent path segment is an existing FILE, so the write genuinely fails.
    // (A path under a missing directory would NOT fail: `write` creates the
    // directory first, so the write would succeed and this test could never fail.)
    const failing = new NotesStore(join(file, 'nested.md'))
    await expect(failing.write('new content')).rejects.toThrow()
    await expect(store.read()).resolves.toBe('original')
  })

  it('leaves no temporary file behind when the write fails', async () => {
    const store = new NotesStore(file)
    await store.write('original')
    const failing = new NotesStore(join(file, 'nested.md'))
    await expect(failing.write('new content')).rejects.toThrow()
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('serializes overlapping writes without corrupting the file', async () => {
    const store = new NotesStore(file)
    await store.write('initial')
    // Overlapping saves happen in practice: the renderer debounces edits, but a slow
    // disk can still overlap two saves. Repeat enough rounds that a race is caught
    // reliably rather than one time in three.
    for (let round = 0; round < 20; round++) {
      const first = store.write('A'.repeat(20_000))
      const second = store.write('B'.repeat(20_000))
      await expect(Promise.all([first, second])).resolves.toBeDefined()
      const content = await store.read()
      // The file must hold exactly one complete write — never a mix of the two.
      expect(content === 'A'.repeat(20_000) || content === 'B'.repeat(20_000)).toBe(true)
    }
    const entries = await readdir(dir)
    expect(entries).toEqual(['notes.md'])
  })

  it('overwrites existing content', async () => {
    const store = new NotesStore(file)
    await store.write('first')
    await store.write('second')
    await expect(store.read()).resolves.toBe('second')
  })
})
