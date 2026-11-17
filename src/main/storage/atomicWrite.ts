import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * Writes to the same path are serialized so two overlapping saves cannot race on the
 * temporary file. Without this, the second write removes the first write's temp file
 * and the first `rename` fails with ENOENT — the user sees a spurious "couldn't save".
 */
const queues = new Map<string, Promise<void>>()

let tempCounter = 0

/**
 * Runs `task` after any previously queued task for the same path has settled, so tasks
 * touching one file are executed one at a time.
 */
function enqueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(filePath)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(task)
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

export function writeFileAtomic(filePath: string, content: string): Promise<void> {
  return enqueue(filePath, () => writeAtomic(filePath, content))
}

/**
 * Reads the current contents, derives the next contents and writes them — all inside the
 * per-path critical section. A caller that reads the file, then writes it back, must use
 * this instead of `writeFileAtomic`: between the read and the write another writer could
 * change the file, and the second writer's change would be silently lost.
 */
export function updateFileAtomic(
  filePath: string,
  update: (current: string) => string
): Promise<string> {
  return enqueue(filePath, async () => {
    const current = await readFileIfExists(filePath)
    const next = update(current)
    await writeAtomic(filePath, next)
    return next
  })
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return ''
    throw error
  }
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
