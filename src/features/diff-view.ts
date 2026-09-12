import './diff-view.scss'
import { WorkspaceView, app } from '@typora-community-plugin/core'
import type { WorkspaceLeaf } from '@typora-community-plugin/core'
import { CodeMirror, getCodeMirrorMode } from 'typora'
import type GitPlugin from '../main'
import { GitClient } from './git-client'

type Jq = ReturnType<typeof $>

/** placeholders Typora's `CodeMirror()` expects as the parent editor */
const FAKE_EDITOR = {
  sourceView: { inSourceMode: false },
  undo: {
    register() { },
    lastRegisteredOperationCommand() { },
  },
}

/**
 * `diff`    — render the unified diff of the unstaged changes in a full-height
 *             Typora `CodeMirror` instance
 * `content` — render the file's content at `HEAD` as a read-only Markdown preview
 */
export type DiffViewMode = 'diff' | 'content'

export interface DiffViewState {
  /** stable identity of the tab (`typ://<type>/<mode>/<file>`) */
  path: string
  /** vault-relative path of the file the view renders */
  file: string
  mode: DiffViewMode
}

/**
 * Lines git emits before/around a hunk body. Dropped so the view shows only the
 * file content and the changes (VSCode-style inline diff), not git's plumbing.
 */
const GIT_META_PREFIXES = [
  'diff --git ',
  'index ',
  'old mode ',
  'new mode ',
  'new file mode ',
  'deleted file mode ',
  'similarity index ',
  'dissimilarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
]

/**
 * Turn a full-context unified diff into an inline diff: the whole file with
 * `-`/`+` marked changed lines, without the `diff --git`/`index`/`@@` headers.
 */
function toInlineDiff(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .filter(line =>
      !GIT_META_PREFIXES.some(prefix => line.startsWith(prefix))
      && !line.startsWith('--- ')
      && !line.startsWith('+++ ')
      && !line.startsWith('@@')
      && line !== '\\ No newline at end of file',
    )
    .join('\n')
}

/**
 * Read-only view that renders git data with Typora's own tooling: the diff is
 * shown in a `CodeMirror` instance filling the whole view, a file restored from
 * git is shown as a Markdown preview.
 */
export class DiffView extends WorkspaceView {

  static type = 'git-diff'

  containerEl: HTMLElement = $('<div class="typ-git-diff-view"></div>')[0] as HTMLElement

  private client: GitClient
  private bodyEl: Jq
  private cm: any

  constructor(leaf: WorkspaceLeaf, private plugin: GitPlugin) {
    super(leaf)
    this.client = new GitClient(() => app.vault.path)
    this.leaf.containerEl.classList.add('typ-git-diff-leaf')
    this.bodyEl = $('<div class="typ-git-diff-body"></div>').appendTo(this.containerEl)
  }

  onOpen() {
    void this._render()
  }

  private async _render() {
    const state = this.leaf.state as Partial<DiffViewState>
    const file = state.file
    const mode = state.mode ?? 'diff'

    this.setIcon(mode === 'content' ? 'fa-file-text-o' : 'fa-code-fork')

    if (!file) {
      this.bodyEl.text(this.plugin.i18n.t.diffUnavailable)
      return
    }

    try {
      if (mode === 'content') {
        this.bodyEl.empty()
        this.cm = undefined
        const markdown = await this.client.show(file)
        app.features.markdownRenderer.renderTo(markdown, this.bodyEl.get(0) as HTMLElement)
      } else {
        this._renderDiff(await this.client.diff(file))
      }
    } catch (e) {
      console.error('[typora-plugin-git]', e)
      this.bodyEl.text(this.plugin.i18n.t.diffUnavailable)
    }
  }

  private _renderDiff(diff: string) {
    const inline = toInlineDiff(diff)
    const value = inline.trim() ? inline : this.plugin.i18n.t.diffEmpty

    if (this.cm) {
      this.cm.setValue(value)
      this.cm.refresh()
      return
    }

    const el = this.bodyEl.empty().get(0) as HTMLElement
    this.cm = CodeMirror(el, {
      mode: getCodeMirrorMode('diff'),
      readOnly: true,
      lineNumbers: true,
      lineWrapping: true,
      maxHighlightLength: Infinity,
      viewportMargin: Infinity,
      styleSelectedText: true,
      styleActiveLine: true,
      theme: ' inner null-scroll',
      resetSelectionOnContextMenu: true,
      cursorScrollMargin: 60,
      dragDrop: false,
      scrollbarStyle: 'null',
    }, FAKE_EDITOR, 'git-diff-' + Date.now())
    this.cm.setValue(value)
    this.cm.setSize('100%', '100%')
  }
}
