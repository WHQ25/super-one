export type HarnessCliInstallMessages = {
  prompt: string
  running: string
  succeeded: string
  failed: string
  stillMissing: string
}

export const harnessCliInstallEn: HarnessCliInstallMessages = {
  prompt: '{{binary}} CLI was not found. Click ▶ on the code block to install:',
  running: 'Installing {{binary}} CLI…',
  succeeded: 'Installed {{id}} CLI',
  failed: 'Installation failed (exit code {{code}}). Check the output above and click ▶ to retry.',
  stillMissing: 'Installer finished, but {{binary}} was still not found on PATH.',
}

export const harnessCliInstallZh: HarnessCliInstallMessages = {
  prompt: '未检测到 {{binary}} CLI，点击代码块右上角 ▶ 直接开始安装：',
  running: '正在安装 {{binary}} CLI…',
  succeeded: '已完成 {{id}} CLI 安装',
  failed: '安装失败（退出码 {{code}}），请查看上方输出并点击 ▶ 重试。',
  stillMissing: '安装脚本已结束，但仍未检测到 {{binary}} 可执行文件。',
}
