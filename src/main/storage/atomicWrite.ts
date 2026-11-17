import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * Writes to the same path are serialized so two overlapping saves cannot race on the
 * temporary file. Without this, the second write removes the first write's temp file
 * and the first `rename` fails with ENOENT — the user sees a spurious "couldn't save".
 */
const queues = new Map<string, Promise<void>>()

let tempCounter = 0

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const key = resolve(filePath)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(() => writeAtomic(filePath, content))
  // The queue must survive a failed write, so it tracks the settled promise.
  const settled = current.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return current
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // A unique temp name keeps concurrent writers on different paths from colliding.
  const tempPath = `${filePath}.${process.pid}.${tempCounter++}.tmp`
  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
