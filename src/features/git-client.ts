import { path } from '@typora-community-plugin/core'

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | '?'

export interface GitFileInfo {
  /** relative to the vault (cwd) */
  path: string
  status: GitFileStatus
  /** true for an untracked directory git reported as a single entry */
  isDir?: boolean
}

export interface GitState {
  branch: string
  staged: GitFileInfo[]
  worktree: GitFileInfo[]
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

function reqnode(moduleName: string): any {
  const g = globalThis as any
  return (g.reqnode?.(moduleName)) ?? (g.Typora?.reqnode?.(moduleName))
}

export function parsePorcelain(raw: string, repoPrefix: string): Omit<GitState, 'branch'> {
  const staged: GitFileInfo[] = []
  const worktree: GitFileInfo[] = []

  // porcelain paths are relative to the repo root, while `git add`/`reset`
  // (run from the vault cwd) expect cwd-relative paths. `status` is invoked
  // with the `.` pathspec, so every entry lives inside the vault and simply
  // needs the repo-root -> vault prefix stripped.
  const toVaultRelative = (repoRel: string): string => {
    let clean = repoRel.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!repoPrefix) return clean
    if (clean === repoPrefix) return ''
    const prefixed = repoPrefix + '/'
    return clean.startsWith(prefixed) ? clean.slice(prefixed.length) : clean
  }

  const tokens = raw.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (!entry) continue

    const x = entry[0]
    const y = entry[1]
    const isDir = /[\\/]$/.test(entry)
    let filePath = toVaultRelative(entry.slice(3))

    // rename/copy entries are "XY <new>\0<old>" — the original path is the
    // next token, so consume it.
    if (x === 'R' || x === 'C') i++

    if (!filePath) continue

    if (y !== ' ') {
      worktree.push({ path: filePath, status: y === '?' ? '?' : y as GitFileStatus, isDir })
    }
    if (x !== ' ' && x !== '?') {
      const st = (['M', 'A', 'D', 'R', 'C'].includes(x) ? x : 'M') as GitFileStatus
      staged.push({ path: filePath, status: st })
    }
  }
  return { staged, worktree }
}

export class GitClient {

  /** repo root relative to the vault cwd; empty when the vault is the repo root */
  private repoPrefix = ''
  private repoReady = false
  private isRepo = false
  private lastVaultPath = ''

  constructor(private vaultPath: () => string) {}

  private run(args: string[]): Promise<string> {
    const childProcess = reqnode('child_process')
    if (!childProcess?.spawn) return Promise.reject(new GitError('git-not-found'))

    return new Promise((resolve, reject) => {
      let child: any
      try {
        child = childProcess.spawn(
          'git', args,
          { cwd: this.vaultPath(), stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e: any) {
        reject(new GitError(e.message || String(e)))
        return
      }

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', () => reject(new GitError(stderr.trim() || 'git-not-found')))
      child.on('close', (code: number) => {
        if (code === 0) resolve(stdout)
        else reject(new GitError(stderr.trim() || `exit code ${code}`))
      })
    })
  }

  /**
   * Resolve (once per vault path) whether the vault is inside a git repository
   * and the path of the vault relative to the repo root.
   */
  private async resolveRepo(): Promise<boolean> {
    const vault = this.vaultPath()

    if (this.repoReady && vault === this.lastVaultPath) return this.isRepo
    this.repoReady = true
    this.lastVaultPath = vault
    this.repoPrefix = ''
    this.isRepo = false

    try {
      const toplevel = (await this.run(['rev-parse', '--show-toplevel']))
        .trim().replace(/\\/g, '/').replace(/\/+$/, '')
      if (!toplevel) return false

      this.isRepo = true

      const normalizedVault = vault.replace(/\\/g, '/').replace(/\/+$/, '')
      if (normalizedVault === toplevel) {
        this.repoPrefix = ''
      } else if (normalizedVault.startsWith(toplevel + '/')) {
        this.repoPrefix = path.relative(toplevel, normalizedVault).replace(/\\/g, '/')
      }
    } catch (e) {
      if (e instanceof GitError && e.message === 'git-not-found') throw e
      this.isRepo = false
    }

    return this.isRepo
  }

  /** true if the vault folder is inside a git repository */
  async probe(): Promise<boolean> {
    return this.resolveRepo()
  }

  async status(): Promise<GitState | null> {
    if (!(await this.resolveRepo())) return null

    let branch = '(unknown)'
    try {
      const out = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])
      branch = out.trim() || '(detached)'
    } catch {
      branch = '(no commits)'
    }

    // `.` pathspec limits the report to the vault subtree, both when the vault
    // is the repo root and when it is nested in a larger repository.
    // `--untracked-files=all` lists every untracked file individually instead of
    // collapsing new folders into a single "dir/" entry, so the tree can expand
    // to arbitrary depth (and stage/unstage individual files inside them).
    const raw = await this.run([
      '-c', 'core.quotePath=false',
      'status', '--porcelain=v1', '-z', '--untracked-files=all',
      '--', '.',
    ])

    return { branch, ...parsePorcelain(raw, this.repoPrefix) }
  }

  /** initialize a git repository in the vault directory */
  async init() {
    await this.run(['init'])
    // drop the cached "not a repo" result so the next status re-resolves it
    this.repoReady = false
  }

  async stage(paths: string[]) {
    if (!paths.length) return
    await this.run(['add', '-A', '--', ...paths])
  }

  async commit(message: string) {
    await this.run(['commit', '-m', message])
  }

  async unstage(paths: string[]) {
    if (!paths.length) return
    try {
      await this.run(['reset', '-q', 'HEAD', '--', ...paths])
    } catch {
      // HEAD does not exist yet (no initial commit): drop the paths from the
      // index directly so they become untracked again.
      await this.run(['rm', '--cached', '-r', '--', ...paths])
    }
  }

  /** repo-root-relative path of a vault-relative file (required by `<rev>:<path>`) */
  private toRepoRelative(vaultRelativePath: string): string {
    const clean = vaultRelativePath.replace(/\\/g, '/')
    return this.repoPrefix ? this.repoPrefix + '/' + clean : clean
  }

  /** unified diff of the unstaged changes of a vault-relative file (full context) */
  async diff(vaultRelativePath: string): Promise<string> {
    return this.run([
      '-c', 'core.quotePath=false',
      'diff', '--no-color', '--unified=999999', '--', vaultRelativePath,
    ])
  }

  /**
   * Content of a vault-relative file at a revision (defaults to `HEAD`).
   * Used to display files that no longer exist in the working tree.
   */
  async show(vaultRelativePath: string, rev = 'HEAD'): Promise<string> {
    if (!(await this.resolveRepo())) throw new GitError('not-a-repo')
    return this.run(['show', `${rev}:${this.toRepoRelative(vaultRelativePath)}`])
  }

  /** absolute path of a vault-relative file */
  vaultPathOf(vaultRelativePath: string): string {
    return path.join(this.vaultPath(), vaultRelativePath)
  }
}
