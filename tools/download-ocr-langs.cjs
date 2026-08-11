/** 预下载 OCR 中文语言包（约 12MB），避免首次运行时等待 */
const Tesseract = require('tesseract.js')

async function main() {
  console.log('[ocr] 开始下载中文语言包 chi_sim...')
  const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
    logger: (m) => {
      if (m.status === 'downloading traineddata') {
        process.stdout.write(`\r  下载语言包: ${Math.round(m.progress * 100)}%`)
      }
    }
  })
  console.log('\n[ocr] chi_sim+eng 就绪')
  await worker.terminate()
  console.log('[ocr] 完成')
}

main().catch((err) => {
  console.error('[ocr] 下载失败:', err.message)
  process.exit(1)
})
