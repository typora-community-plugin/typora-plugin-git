import './style.scss'
import * as Locale from './locales/lang.en.json'
import { I18n, path, Plugin } from '@typora-community-plugin/core'
import { GitPanel } from './features/git-panel'

export default class GitPlugin extends Plugin {

  i18n = new I18n<typeof Locale>({
    localePath: path.join(this.manifest.dir!, 'locales')
  })

  onload() {
    const panel = new GitPanel(this)

    this.register(this.app.workspace.sidebar.addChild(panel))
    this.register(() => panel.onunload())

    // keep the status tree in sync with disk and editor activity
    const refresh = () => panel.refresh()
    this.register(this.app.vault.on('mounted', refresh))
    this.register(this.app.vault.on('change', refresh))
    this.register(this.app.vault.on('file:delete', refresh))
    this.register(this.app.vault.on('file:rename', refresh))
    this.register(this.app.vault.on('directory:rename', refresh))
    this.register(this.app.workspace.on('file:open', refresh))
    this.register(this.app.workspace.on('file:will-save', refresh))
  }
}
