export type HarnessCliInstallMessages = {
  prompt: string
  upgradePrompt: string
  running: string
  upgrading: string
  succeeded: string
  upgraded: string
  failed: string
  stillMissing: string
  stillIncompatible: string
  minVersionBadge: string
  upgradeAction: string
  retryUpgradeAction: string
  composerUpgradeTitle: string
  composerUpgradeHint: string
  composerRemoteIncompatible: string
  updateAvailable: string
  updateToVersion: string
  upToDate: string
  checkingUpdates: string
  checkUpdates: string
}

export const harnessCliInstallEn: HarnessCliInstallMessages = {
  prompt: '{{binary}} CLI was not found. Click ▶ on the code block to install:',
  upgradePrompt: '{{binary}} CLI {{actual}} is below the minimum supported version {{min}}. Click ▶ on the code block to upgrade:',
  running: 'Installing {{binary}} CLI…',
  upgrading: 'Upgrading {{binary}} CLI…',
  succeeded: 'Installed {{id}} CLI',
  upgraded: 'Upgraded {{id}} CLI',
  failed: 'Installation failed (exit code {{code}}). Check the output above and click ▶ to retry.',
  stillMissing: 'Installer finished, but {{binary}} was still not found on PATH.',
  stillIncompatible: 'Upgrade finished, but {{binary}} ({{actual}}) is still below the minimum required {{min}}. Check your PATH for an older binary.',
  minVersionBadge: 'requires ≥ {{min}}',
  upgradeAction: 'Upgrade',
  retryUpgradeAction: 'Retry upgrade',
  composerUpgradeTitle: '{{label}} requires an update',
  composerUpgradeHint: 'Current {{binary}} CLI ({{actual}}) is below the minimum supported version {{min}}.',
  composerRemoteIncompatible: '{{label}} on this remote host must be upgraded to ≥ {{min}} before continuing.',
  updateAvailable: 'Update {{latest}}',
  updateToVersion: 'Update to {{latest}}',
  upToDate: 'Up to date',
  checkingUpdates: 'Checking updates…',
  checkUpdates: 'Check for updates',
}

export const harnessCliInstallZh: HarnessCliInstallMessages = {
  prompt: '未检测到 {{binary}} CLI，点击代码块右上角 ▶ 直接开始安装：',
  upgradePrompt: '检测到 {{binary}} CLI 版本过低（当前 {{actual}}，最低要求 {{min}}），点击代码块右上角 ▶ 升级：',
  running: '正在安装 {{binary}} CLI…',
  upgrading: '正在升级 {{binary}} CLI…',
  succeeded: '已完成 {{id}} CLI 安装',
  upgraded: '已完成 {{id}} CLI 升级',
  failed: '安装失败（退出码 {{code}}），请查看上方输出并点击 ▶ 重试。',
  stillMissing: '安装脚本已结束，但仍未检测到 {{binary}} 可执行文件。',
  stillIncompatible: '升级脚本已结束，但当前 {{binary}} 版本（{{actual}}）仍低于最低要求 {{min}}，请检查 PATH 中是否残留旧版本。',
  minVersionBadge: '需 ≥ {{min}}',
  upgradeAction: '一键升级',
  retryUpgradeAction: '重试升级',
  composerUpgradeTitle: '{{label}} 需要升级',
  composerUpgradeHint: '当前 {{binary}} CLI 版本（{{actual}}）低于最低要求 {{min}}。',
  composerRemoteIncompatible: '远程主机上的 {{label}} 需要升级至 ≥ {{min}} 后才能继续对话。',
  updateAvailable: '有新版本 {{latest}}',
  updateToVersion: '升级到 {{latest}}',
  upToDate: '已是最新',
  checkingUpdates: '检查更新中…',
  checkUpdates: '检查更新',
}
