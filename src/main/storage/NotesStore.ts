import { readFileAtomic, writeFileAtomic } from './atomicWrite'

export class NotesStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string> {
    // The read goes through the same per-path queue as the write: on Windows, a read
    // that overlaps a write makes the write's rename fail with EPERM.
    return (await readFileAtomic(this.filePath)) ?? ''
  }

  async write(content: string): Promise<void> {
    await writeFileAtomic(this.filePath, content)
  }
}
