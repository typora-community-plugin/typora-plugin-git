import './style.scss'
import * as Locale from './locales/lang.en.json'
import { I18n, path, Plugin, PluginSettings } from '@typora-community-plugin/core'
import { GitPanel } from './features/git-panel'
import { GitSettingTab } from './setting-tab'

export interface GitSettings {
  /** how often the sidebar panel refreshes the git status, in milliseconds */
  refreshInterval: number
}

export default class GitPlugin extends Plugin<GitSettings> {

  i18n = new I18n<typeof Locale>({
    localePath: path.join(this.manifest.dir!, 'locales')
  })

  onload() {
    this.registerSettings(
      new PluginSettings<GitSettings>(this.app, this.manifest, { version: 1 }))
    this.settings.setDefault({ refreshInterval: 1000 })

    const panel = new GitPanel(this)

    this.register(this.app.workspace.sidebar.addPanel(panel))
    this.register(() => panel.onunload())

    this.registerSettingTab(new GitSettingTab(this))
    this.register(this.settings.onChange('refreshInterval', () => panel.onSettingsChanged()))

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
