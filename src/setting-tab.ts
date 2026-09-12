import { SettingTab } from '@typora-community-plugin/core'
import type GitPlugin from './main'

const MIN_REFRESH_INTERVAL = 300
const DEFAULT_REFRESH_INTERVAL = 1000

function normalizeInterval(value: unknown): number {
  const interval = Number(value)
  if (!Number.isFinite(interval)) return DEFAULT_REFRESH_INTERVAL
  return Math.max(MIN_REFRESH_INTERVAL, Math.round(interval))
}

export class GitSettingTab extends SettingTab {

  constructor(private gitPlugin: GitPlugin) {
    super()
  }

  get name() {
    return this.gitPlugin.manifest.name
  }

  onload() {
    const t = this.gitPlugin.i18n.t

    this.addSetting(setting => {
      setting.addName(t.refreshInterval)
      setting.addDescription(t.refreshIntervalDesc)
      setting.addInput('number', input => {
        input.min = String(MIN_REFRESH_INTERVAL)
        input.step = '100'
        input.value = String(this.gitPlugin.settings.get('refreshInterval'))
        input.onchange = () => {
          const interval = normalizeInterval(input.value)
          input.value = String(interval)
          this.gitPlugin.settings.set('refreshInterval', interval)
        }
      })
    })
  }
}
