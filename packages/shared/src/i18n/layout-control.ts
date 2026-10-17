import type { LayoutActAction, LayoutChatMode, LayoutChatPosition } from '../layout-control'

export interface LayoutControlMessages {
  snapshot: { streaming: string; done: string; action: string }
  actions: Record<LayoutActAction, { streaming: string; done: string; action: string }>
  side: { left: string; right: string }
  chatMode: Record<LayoutChatMode, string>
  chatPosition: Record<LayoutChatPosition, string>
  outcome: { queued: string; skipped: string; unsupported: string; superseded: string }
  sessionCount: string
  dividerCount: string
  allSplits: string
}

export const layoutControlEn: LayoutControlMessages = {
  snapshot: { streaming: 'Reading layout…', done: 'Layout Read', action: 'Read Layout' },
  actions: {
    focus_session: { streaming: 'Switching session…', done: 'Session Focused', action: 'Focus Session' },
    maximize_split: { streaming: 'Maximizing split…', done: 'Split Maximized', action: 'Maximize Split' },
    restore_splits: { streaming: 'Restoring splits…', done: 'Splits Restored', action: 'Restore Splits' },
    resize_splits: { streaming: 'Resizing splits…', done: 'Splits Resized', action: 'Resize Splits' },
    open_file: { streaming: 'Opening file…', done: 'File Opened', action: 'Open File' },
    focus_tab: { streaming: 'Focusing tab…', done: 'Tab Focused', action: 'Focus Tab' },
    close_tab: { streaming: 'Closing tab…', done: 'Tab Closed', action: 'Close Tab' },
    move_tab: { streaming: 'Moving tab…', done: 'Tab Moved', action: 'Move Tab' },
    resize_group: { streaming: 'Resizing group…', done: 'Group Resized', action: 'Resize Group' },
    show_panel: { streaming: 'Showing panel…', done: 'Panel Shown', action: 'Show Panel' },
    hide_panel: { streaming: 'Hiding panel…', done: 'Panel Hidden', action: 'Hide Panel' },
    maximize_panel: { streaming: 'Maximizing panel…', done: 'Panel Maximized', action: 'Maximize Panel' },
    restore_panel: { streaming: 'Restoring panel…', done: 'Panel Restored', action: 'Restore Panel' },
    panel_side: { streaming: 'Moving panel…', done: 'Panel Moved', action: 'Move Panel' },
    show_sidebar: { streaming: 'Expanding sidebar…', done: 'Sidebar Expanded', action: 'Expand Sidebar' },
    hide_sidebar: { streaming: 'Collapsing sidebar…', done: 'Sidebar Collapsed', action: 'Collapse Sidebar' },
    resize_sidebar: { streaming: 'Resizing sidebar…', done: 'Sidebar Resized', action: 'Resize Sidebar' },
    resize_panel: { streaming: 'Resizing panel…', done: 'Panel Resized', action: 'Resize Panel' },
    chat_mode: { streaming: 'Changing chat view…', done: 'Chat View Changed', action: 'Change Chat View' },
    show_terminal: { streaming: 'Showing terminal…', done: 'Terminal Shown', action: 'Show Terminal' },
    hide_terminal: { streaming: 'Hiding terminal…', done: 'Terminal Hidden', action: 'Hide Terminal' },
    split_session: { streaming: 'Splitting in session…', done: 'Session Split In', action: 'Split In Session' },
    close_split: { streaming: 'Closing split…', done: 'Split Closed', action: 'Close Split' },
  },
  side: { left: 'left', right: 'right' },
  sessionCount: '{{count}} sessions',
  dividerCount: '{{count}} dividers',
  allSplits: 'all splits',
  chatMode: { docked: 'docked', floating: 'floating', icon: 'icon' },
  chatPosition: {
    'top-left': 'top left',
    top: 'top',
    'top-right': 'top right',
    right: 'right',
    'bottom-right': 'bottom right',
    bottom: 'bottom',
    'bottom-left': 'bottom left',
    left: 'left',
  },
  outcome: { queued: 'when you open this session', skipped: 'skipped while you were elsewhere', unsupported: 'unavailable', superseded: 'superseded by navigation' },
}

export const layoutControlZh: LayoutControlMessages = {
  snapshot: { streaming: '正在读取布局…', done: '已读取布局', action: '读取布局' },
  actions: {
    focus_session: { streaming: '正在切换会话…', done: '会话已切换', action: '切换会话' },
    maximize_split: { streaming: '正在最大化分屏…', done: '分屏已最大化', action: '最大化分屏' },
    restore_splits: { streaming: '正在恢复分屏…', done: '分屏已恢复', action: '恢复分屏' },
    resize_splits: { streaming: '正在调整分屏比例…', done: '分屏比例已调整', action: '调整分屏比例' },
    open_file: { streaming: '正在打开文件…', done: '文件已打开', action: '打开文件' },
    focus_tab: { streaming: '正在切换标签…', done: '已切换标签', action: '切换标签' },
    close_tab: { streaming: '正在关闭标签…', done: '标签已关闭', action: '关闭标签' },
    move_tab: { streaming: '正在移动标签…', done: '标签已移动', action: '移动标签' },
    resize_group: { streaming: '正在调整分组大小…', done: '分组大小已调整', action: '调整分组大小' },
    show_panel: { streaming: '正在显示面板…', done: '面板已显示', action: '显示面板' },
    hide_panel: { streaming: '正在隐藏面板…', done: '面板已隐藏', action: '隐藏面板' },
    maximize_panel: { streaming: '正在最大化面板…', done: '面板已最大化', action: '最大化面板' },
    restore_panel: { streaming: '正在还原面板…', done: '面板已还原', action: '还原面板' },
    panel_side: { streaming: '正在移动面板…', done: '面板已移动', action: '移动面板' },
    show_sidebar: { streaming: '正在展开侧边栏…', done: '侧边栏已展开', action: '展开侧边栏' },
    hide_sidebar: { streaming: '正在收起侧边栏…', done: '侧边栏已收起', action: '收起侧边栏' },
    resize_sidebar: { streaming: '正在调整侧边栏宽度…', done: '侧边栏宽度已调整', action: '调整侧边栏宽度' },
    resize_panel: { streaming: '正在调整面板宽度…', done: '面板宽度已调整', action: '调整面板宽度' },
    chat_mode: { streaming: '正在切换聊天形式…', done: '聊天形式已切换', action: '切换聊天形式' },
    show_terminal: { streaming: '正在显示终端…', done: '终端已显示', action: '显示终端' },
    hide_terminal: { streaming: '正在隐藏终端…', done: '终端已隐藏', action: '隐藏终端' },
    split_session: { streaming: '正在分屏显示会话…', done: '会话已分屏显示', action: '分屏显示会话' },
    close_split: { streaming: '正在关闭分屏…', done: '分屏已关闭', action: '关闭分屏' },
  },
  side: { left: '左侧', right: '右侧' },
  sessionCount: '{{count}} 个会话',
  dividerCount: '{{count}} 个分隔条',
  allSplits: '全部分屏',
  chatMode: { docked: '停靠', floating: '悬浮', icon: '图标' },
  chatPosition: {
    'top-left': '左上',
    top: '顶部',
    'top-right': '右上',
    right: '右侧',
    'bottom-right': '右下',
    bottom: '底部',
    'bottom-left': '左下',
    left: '左侧',
  },
  outcome: { queued: '打开此会话时生效', skipped: '你在别处，已跳过', unsupported: '暂不可用', superseded: '已被新的导航取代' },
}
