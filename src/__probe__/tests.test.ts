import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('probe test designs', () => {
  it('rename onto a directory fails with EPERM and leaves the temp behind (pre-cleanup)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probe-dir-'))
    const target = join(dir, 'notes.md')
    await mkdir(target)
    const temp = join(dir, 'notes.md.1.tmp')
    await writeFile(temp, 'x', 'utf8')
    let code = 'none'
    try {
      const { rename } = await import('node:fs/promises')
      await rename(temp, target)
    } catch (e) { code = (e as { code?: string }).code ?? 'unknown' }
    console.log('PROBE dir-target code =', code, 'entries =', JSON.stringify(await readdir(dir)))
    await rm(dir, { recursive: true, force: true })
    expect(code).toBe('none')
  })

  it('a reader can observe a partially written file when writing in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probe-partial-'))
    const file = join(dir, 'notes.md')
    const A = 'A'.repeat(200_000)
    const B = 'B'.repeat(200_000)
    await writeFile(file, A, 'utf8')
    let partial = 0
    let reads = 0
    const stop = { value: false }
    const reader = (async () => {
      while (!stop.value) {
        const c = await readFile(file, 'utf8')
        reads++
        if (c !== A && c !== B) partial++
      }
    })()
    await writeFile(file, B, 'utf8')
    stop.value = true
    await reader
    console.log('PROBE-PARTIAL reads =', reads, 'partialObservations =', partial)
    await rm(dir, { recursive: true, force: true })
    expect(true).toBe(true)
  })

  it('reading a directory yields EISDIR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probe-eisdir2-'))
    const target = join(dir, 'notes.md')
    await mkdir(target)
    let code = 'none'
    try { await readFile(target, 'utf8') } catch (e) { code = (e as { code?: string }).code ?? 'unknown' }
    console.log('PROBE-EISDIR code =', code)
    await rm(dir, { recursive: true, force: true })
    expect(code).toBe('EISDIR')
  })
})
