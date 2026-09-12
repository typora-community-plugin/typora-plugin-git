import { SidebarPanel, html, app } from '@typora-community-plugin/core'
import type GitPlugin from '../main'
import {
  GitClient, GitError,
  type GitFileInfo, type GitFileStatus, type GitState,
} from './git-client'
import { buildGitTree, collectFilePaths, type GitTreeNode } from './git-file-tree'

type Jq = ReturnType<typeof $>
type Section = 'staged' | 'worktree'

const STATUS_TEXT: Record<GitFileStatus, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', '?': 'U',
}

function statusClass(status: GitFileStatus): string {
  return status === '?' ? 'untracked' : status.toLowerCase()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export class GitPanel extends SidebarPanel {

  private client: GitClient
  private stagedEl!: HTMLElement
  private worktreeEl!: HTMLElement
  private stagedCountEl!: Jq
  private worktreeCountEl!: Jq
  private commitMessageEl!: HTMLTextAreaElement
  private commitButtonEl!: Jq
  private bodyEl!: Jq
  private initBtnEl!: Jq
  private noRepoEl!: Jq
  private hintEl!: Jq
  private headerEl!: Jq
  private branchEl!: Jq
  private busy = false
  private refreshTimer: any
  private refreshSeq = 0
  private current: GitState | null = null
  private collapsed = new Set<string>()
  private nodeIndex = new Map<string, GitTreeNode>()

  constructor(private plugin: GitPlugin) {
    super()

    this.client = new GitClient(() => app.vault.path)

    const t = () => plugin.i18n.t

    this.addRibbonButton({
      group: 'top',
      id: 'git',
      title: t().ribbonGit,
      className: 'typ-git-button',
      icon: html`<i class="fa fa-code-fork"></i>`,
    })

    const sectionHeader = (label: string, countEl: Jq): Jq =>
      $('<h3>')
        .append($('<span>').text(label))
        .append(countEl)

    this.containerEl = $(`<div id="typ-git-panel">`)
      .append(
        this.headerEl = $('<header class="typ-git-header">')
          .append(this.branchEl = $('<span class="typ-git-branch"></span>'))
          .append($(`<button class="typ-git-refresh" title="${escapeHtml(t().refresh)}"><i class="fa fa-refresh"></i></button>`))
          .append($(`<button class="typ-git-stage-all" title="${escapeHtml(t().stageAll)}"><i class="fa fa-plus"></i></button>`))
          .append($(`<button class="typ-git-unstage-all" title="${escapeHtml(t().unstageAll)}"><i class="fa fa-minus"></i></button>`)),
        this.bodyEl = $('<div class="typ-git-body">')
          .append(
            $('<div class="typ-git-commit">')
              .append(
                this.commitMessageEl = $('<textarea class="typ-git-commit-message" rows="2"></textarea>')
                  .attr('placeholder', t().commit)
                  .on('input', () => this._updateCommitState())
                  .on('keydown', (event: any) => this._onCommitKeydown(event))
                  .get(0) as HTMLTextAreaElement,
                this.commitButtonEl = $('<button class="typ-git-commit-btn">')
                  .attr('title', t().commitButton)
                  .append($('<i class="fa fa-check"></i>'))
                  .append($('<span>').text(t().commitButton)),
              ),
            $('<section class="typ-git-section typ-git-staged">')
              .append(
                sectionHeader(t().staged, this.stagedCountEl = $('<span class="typ-git-count"></span>')),
                this.stagedEl = $('<div class="typ-git-list"></div>').get(0) as HTMLElement),
            $('<section class="typ-git-section typ-git-worktree">')
              .append(
                sectionHeader(t().workingTree, this.worktreeCountEl = $('<span class="typ-git-count"></span>')),
                this.worktreeEl = $('<div class="typ-git-list"></div>').get(0) as HTMLElement),
          ),
        this.noRepoEl = $('<div class="typ-git-hint typ-git-no-repo"></div>')
          .append($('<p></p>').text(t().noRepoHint))
          .append(this.initBtnEl = $('<button class="typ-git-init-btn">')
            .append($('<i class="fa fa-code-fork"></i>'))
            .append($('<span>').text(t().initRepo))
            .on('click', () => void this._initRepo()))
          .hide(),
        this.hintEl = $('<p class="typ-git-hint"></p>').hide(),
      )
      .on('click', '.typ-git-action', (event: any) => this._onActionClick(event))
      .on('click', '.typ-git-tree-item', (event: any) => this._onItemClick(event))
      .on('click', '.typ-git-refresh', () => this.refresh())
      .on('click', '.typ-git-stage-all', () => this._mutateAll('stage'))
      .on('click', '.typ-git-unstage-all', () => this._mutateAll('unstage'))
      .on('click', '.typ-git-commit-btn', () => void this._commit())
      .get(0) as HTMLElement
  }

  onload() {
    this.refresh()
  }

  onshow() {
    this.refresh()
  }

  onhide() {
    this._clearTimer()
  }

  onunload() {
    this._clearTimer()
  }

  refresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this._refresh()
    }, 300)
  }

  private _clearTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }

  private async _refresh() {
    const seq = ++this.refreshSeq
    try {
      const state = await this.client.status()
      if (seq !== this.refreshSeq) return
      if (!state) {
        this.current = null
        this.showNoRepo()
        return
      }
      this.current = state
      this.headerEl.show()
      this.bodyEl.show()
      this.noRepoEl.hide()
      this.hintEl.hide()
      this.branchEl.text(state.branch).attr('title', state.branch)
      this.stagedCountEl.text(state.staged.length || '')
      this.worktreeCountEl.text(state.worktree.length || '')
      this.nodeIndex.clear()
      this._renderSection(this.stagedEl, state.staged, 'staged')
      this._renderSection(this.worktreeEl, state.worktree, 'worktree')
      this._updateCommitState()
    } catch (e: any) {
      if (e instanceof GitError && e.message === 'git-not-found') {
        this.showHint(this.plugin.i18n.t.gitNotFound)
      } else {
        console.error('[typora-plugin-git]', e)
      }
    }
  }

  private showHint(text: string) {
    this.branchEl.text('')
    this.stagedCountEl.text('')
    this.worktreeCountEl.text('')
    $(this.stagedEl).empty()
    $(this.worktreeEl).empty()
    this.noRepoEl.hide()
    this.hintEl.text(text).show()
    this._updateCommitState()
  }

  private showNoRepo() {
    this.branchEl.text('')
    this.stagedCountEl.text('')
    this.worktreeCountEl.text('')
    $(this.stagedEl).empty()
    $(this.worktreeEl).empty()
    this.headerEl.hide()
    this.bodyEl.hide()
    this.hintEl.hide()
    this.noRepoEl.show()
    this._updateCommitState()
  }

  private _onCommitKeydown(event: any) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void this._commit()
    }
  }

  private _updateCommitState() {
    const hasStaged = !!this.current?.staged.length
    const hasMessage = this.commitMessageEl.value.trim().length > 0
    this.commitButtonEl.prop('disabled', this.busy || !hasStaged || !hasMessage)
    this.initBtnEl.prop('disabled', this.busy)
  }

  private async _initRepo() {
    if (this.busy) return
    await this._mutate(() => this.client.init())
  }

  private async _commit() {
    if (this.busy || !this.current?.staged.length) return
    const message = this.commitMessageEl.value.trim()
    if (!message) return
    const ok = await this._mutate(() => this.client.commit(message))
    if (ok) {
      this.commitMessageEl.value = ''
      this._updateCommitState()
    }
  }

  private _renderSection(el: HTMLElement, files: GitFileInfo[], section: Section) {
    el.innerHTML = ''
    if (!files.length) {
      const empty = section === 'staged'
        ? this.plugin.i18n.t.noStaged
        : this.plugin.i18n.t.noChanges
      el.append($('<p class="typ-git-empty"></p>').text(empty).get(0) as HTMLElement)
      return
    }
    el.append(...this._renderNodes(buildGitTree(files), section, 0))
  }

  private _renderNodes(nodes: GitTreeNode[], section: Section, depth: number): HTMLElement[] {
    const out: HTMLElement[] = []
    for (const node of nodes) {
      const key = section + ':' + node.path
      this.nodeIndex.set(key, node)

      const row = this._renderRow(node, section, key, depth)
      out.push(row)

      // an untracked directory is a leaf node (git collapses it to one entry)
      if (node.isDir && node.children.length) {
        const children = document.createElement('div')
        children.className = 'typ-git-children'
        children.append(...this._renderNodes(node.children, section, depth + 1))
        if (this.collapsed.has(key)) {
          row.classList.add('is-collapsed')
          children.classList.add('is-collapsed')
        }
        out.push(children)
      }
    }
    return out
  }

  private _renderRow(node: GitTreeNode, section: Section, key: string, depth: number): HTMLElement {
    const t = this.plugin.i18n.t
    const isStaged = section === 'staged'
    const kind = node.isDir ? 'dir' : 'file'
    const actionTitle = node.isDir
      ? (isStaged ? t.unstageFolder : t.stageFolder)
      : (isStaged ? t.unstageFile : t.stageFile)
    const actionIcon = isStaged ? 'fa-minus' : 'fa-plus'

    const parts: string[] = []
    if (node.isDir) {
      parts.push(node.children.length
        ? '<i class="fa fa-chevron-down typ-git-chevron"></i>'
        : '<i class="typ-git-spacer"></i>')
      parts.push('<i class="fa fa-folder-o typ-git-icon"></i>')
    } else {
      parts.push('<i class="typ-git-spacer"></i>')
      parts.push('<i class="fa fa-file-o typ-git-icon"></i>')
    }
    parts.push(`<span class="typ-git-name" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</span>`)

    if (node.isDir && node.children.length) {
      parts.push(`<span class="typ-git-count">${collectFilePaths(node).length}</span>`)
    } else if (!node.isDir) {
      const status = node.file!.status
      parts.push(`<span class="typ-git-status status-${statusClass(status)}">${STATUS_TEXT[status]}</span>`)
    }
    parts.push(`<button class="typ-git-action" title="${escapeHtml(actionTitle)}"><i class="fa ${actionIcon}"></i></button>`)

    const row = document.createElement('div')
    row.className = `typ-git-tree-item typ-git-${kind}`
    row.dataset.key = key
    row.dataset.path = node.path
    row.dataset.kind = kind
    row.style.paddingLeft = (8 + depth * 14) + 'px'
    row.innerHTML = parts.join('')
    return row
  }

  private _sectionOf(el: Element): Section {
    return el.closest('.typ-git-staged') ? 'staged' : 'worktree'
  }

  private _onActionClick(event: any) {
    if (this.busy) return
    const el = event.target as HTMLElement
    const item = el.closest('.typ-git-action')?.closest('.typ-git-tree-item') as HTMLElement | null
    if (!item) return

    const node = this.nodeIndex.get(item.dataset.key!)
    if (!node) return

    const paths = collectFilePaths(node)
    if (!paths.length) return

    const section = this._sectionOf(item)
    void this._mutate(() => section === 'staged'
      ? this.client.unstage(paths)
      : this.client.stage(paths))
  }

  private _onItemClick(event: any) {
    const el = event.target as HTMLElement
    if (el.closest('.typ-git-action')) return

    const item = el.closest('.typ-git-tree-item') as HTMLElement | null
    if (!item) return

    if (item.dataset.kind === 'dir') {
      this._toggleDir(item)
    } else {
      void app.openFile(this.client.vaultPathOf(item.dataset.path!)).catch(() => { })
    }
  }

  private _toggleDir(item: HTMLElement) {
    const key = item.dataset.key!
    const children = item.nextElementSibling as HTMLElement | null
    if (!children?.classList.contains('typ-git-children')) return
    const expand = this.collapsed.has(key)
    if (expand) this.collapsed.delete(key)
    else this.collapsed.add(key)
    item.classList.toggle('is-collapsed', !expand)
    if (children?.classList.contains('typ-git-children'))
      children.classList.toggle('is-collapsed', !expand)
  }

  private _mutateAll(action: 'stage' | 'unstage') {
    if (this.busy || !this.current) return
    const source = action === 'stage' ? this.current.worktree : this.current.staged
    const paths = source.map(file => file.path)
    if (!paths.length) return
    void this._mutate(() => action === 'stage'
      ? this.client.stage(paths)
      : this.client.unstage(paths))
  }

  private async _mutate(op: () => Promise<void>): Promise<boolean> {
    this.busy = true
    this._updateCommitState()
    let ok = true
    try {
      await op()
    } catch (e) {
      ok = false
      console.error('[typora-plugin-git]', e)
      if (e instanceof GitError) alert(this.plugin.i18n.t.errorPrefix + ' ' + e.message)
    } finally {
      this.busy = false
    }
    this.refresh()
    return ok
  }
}
