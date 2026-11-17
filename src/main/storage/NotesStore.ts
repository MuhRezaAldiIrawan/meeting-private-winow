import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomicWrite'

export class NotesStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string> {
    try {
      return await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return ''
      throw error
    }
  }

  async write(content: string): Promise<void> {
    await writeFileAtomic(this.filePath, content)
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
