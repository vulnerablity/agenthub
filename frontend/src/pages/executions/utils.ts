/** 毫秒耗时展示：<1s 显示 ms，否则秒保留两位 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}