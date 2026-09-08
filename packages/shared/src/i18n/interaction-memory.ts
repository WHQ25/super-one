export const interactionMemoryEn = {
  read: { streaming: 'Reading memory…', action: 'Read Memory', done: 'Memory Read' },
  write: { streaming: 'Saving memory…', action: 'Save Memory', done: 'Memory Saved' },
  archive: { streaming: 'Archiving memory…', action: 'Archive Memory', done: 'Memory Archived' },
  restore: { streaming: 'Restoring memory…', action: 'Restore Memory', done: 'Memory Restored' },
  actionRead: { streaming: 'Reading action…', action: 'Read Action', done: 'Action Read' },
  actionArchive: { streaming: 'Archiving action…', action: 'Archive Action', done: 'Action Archived' },
  actionRestore: { streaming: 'Restoring action…', action: 'Restore Action', done: 'Action Restored' },
  empty: 'No saved topics',
  topics_one: '{{count}} topic',
  topics_other: '{{count}} topics',
}

export const interactionMemoryZh: typeof interactionMemoryEn = {
  read: { streaming: '正在读取经验…', action: '读取经验', done: '经验已读取' },
  write: { streaming: '正在保存经验…', action: '保存经验', done: '经验已保存' },
  archive: { streaming: '正在归档经验…', action: '归档经验', done: '经验已归档' },
  restore: { streaming: '正在恢复经验…', action: '恢复经验', done: '经验已恢复' },
  actionRead: { streaming: '正在读取操作…', action: '读取操作', done: '操作已读取' },
  actionArchive: { streaming: '正在归档操作…', action: '归档操作', done: '操作已归档' },
  actionRestore: { streaming: '正在恢复操作…', action: '恢复操作', done: '操作已恢复' },
  empty: '暂无已保存的经验',
  topics_one: '{{count}} 条经验',
  topics_other: '{{count}} 条经验',
}
