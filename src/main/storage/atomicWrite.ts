import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Every operation on a given path — reads and writes alike — is serialized, so two
 * overlapping operations cannot race.
 *
 * Writer vs. writer: without this, the second write removes the first write's temp file
 * and the first `rename` fails with ENOENT — the user sees a spurious "couldn't save".
 *
 * Reader vs. writer: on Windows, renaming onto a file that another handle still has
 * open fails with EPERM. A read racing a write therefore makes the *write* fail.
 */
const queues = new Map<string, Promise<void>>()

let tempCounter = 0

/**
 * Windows can transiently refuse a rename while another program — a virus scanner, a
 * file indexer, a sync client — holds the file open. Retrying briefly turns that
 * transient failure into a successful save instead of a spurious error to the user.
 */
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 20

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

/**
 * Reads a file through the per-path queue, so the read never overlaps a write to the
 * same file. Resolves to `null` when the file does not exist; any other read error is
 * re-thrown so the caller can tell "no file yet" apart from "the file is unreadable".
 */
export function readFileAtomic(filePath: string): Promise<string | null> {
  return enqueue(filePath, () => readFileIfExists(filePath))
}

/** Writes a file through the per-path queue. */
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
    const current = (await readFileIfExists(filePath)) ?? ''
    const next = update(current)
    await writeAtomic(filePath, next)
    return next
  })
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // A unique temp name keeps concurrent writers on different paths from colliding.
  const tempPath = `${filePath}.${process.pid}.${tempCounter++}.tmp`
  try {
    await writeFile(tempPath, content, 'utf8')
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function renameWithRetry(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tempPath, filePath)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isTransient(error)) throw error
      await delay(RENAME_RETRY_MS * attempt)
    }
  }
}

/** Errors that mean "try again shortly" rather than "this will never work". */
function isTransient(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
