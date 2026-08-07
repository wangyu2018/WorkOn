/**
 * tesseract.js worker 入口包装（Electron 主进程专用）
 *
 * 背景：Electron 主进程派生的 worker_threads 会继承 process.versions.electron，
 * tesseract.js 的 is-electron 检测据此把运行环境误判为浏览器（env === 'electron'），
 * 加载语言包时走 fetch(URL) 分支，把本地文件路径当 URL → "Only absolute URLs are supported"。
 * 这里在加载官方 worker 脚本前删除该标记，使其回到 Node 本地文件读取分支。
 */
try {
  delete process.versions.electron
} catch {
  /* 删不掉也不阻塞 */
}

let entry
try {
  // 从 assets/ 向上解析 node_modules 中的官方 worker 脚本
  entry = require.resolve('tesseract.js/src/worker-script/node/index.js', {
    paths: [__dirname, process.cwd()]
  })
} catch {
  entry = 'tesseract.js/src/worker-script/node/index.js'
}

module.exports = require(entry)
