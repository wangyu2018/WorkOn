// electron 桩：冒烟脚本专用（esbuild alias electron → 本文件）
const noop = () => {}
class Stub {
  constructor() {
    return new Proxy(this, { get: () => noop })
  }
  static getInstance() { return null }
}
const appStub = {
  getPath: () => require('path').join(process.env.APPDATA || '.', 'workon'),
  on: noop,
  whenReady: () => Promise.resolve(),
  getName: () => 'workon-smoke',
  isPackaged: false
}
module.exports = new Proxy(
  { app: appStub },
  {
    get: (t, k) => (k in t ? t[k] : Stub)
  }
)
