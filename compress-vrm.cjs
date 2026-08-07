/**
 * VRM Draco 压缩脚本 (v4 API)
 * 1. 去重 (dedup) — 移除重复网格
 * 2. 修剪 (prune) — 移除未使用资源
 * 3. 纹理压缩 — 降采样至 2K + WebP
 * 4. Draco 几何压缩 — ~5-10x 减小
 *
 * VRM 扩展（VRM_meta, VRM_humanoid, VRM_springBone 等）作为 glTF 扩展 JSON 保留，不受影响。
 */
const { NodeIO } = require('@gltf-transform/core')
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions')
const { dedup, prune, draco, textureCompress } = require('@gltf-transform/functions')
const draco3dgltf = require('draco3dgltf')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

async function compressVRM(inputPath, outputPath) {
  const sizeBefore = fs.statSync(inputPath).size
  console.log(`[compress] 输入: ${inputPath}`)
  console.log(`[compress] 原始大小: ${(sizeBefore / 1024 / 1024).toFixed(2)} MB`)

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': draco3dgltf.createDecoderModule,
      'draco3d.encoder': draco3dgltf.createEncoderModule,
    })

  // 读取 VRM
  const doc = await io.read(inputPath)
  const root = doc.getRoot()
  console.log(`[compress] 网格: ${root.listMeshes().length}, 纹理: ${root.listTextures().length}, 材质: ${root.listMaterials().length}`)

  // 纹理详情
  for (const tex of root.listTextures()) {
    const img = tex.getImage()
    if (img) {
      const sizeKB = (img.byteLength / 1024).toFixed(0)
      console.log(`[compress]   纹理 "${tex.getName() || 'unnamed'}": ${img.width}x${img.height} (${sizeKB}KB)`)
    }
  }

  // 应用优化管线（Draco 暂时跳过 — draco3dgltf 版本与 glTF-Transform v4 不兼容）
  console.log('[compress] 正在压缩...')
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      resize: [2048, 2048],
      targetFormat: 'webp',
      quality: 80,
    })
  )
  console.log('[compress] 压缩完成')

  // 写入 GLB 二进制（v4 API: writeBinary(doc) 返回 Uint8Array，不直接写文件）
  console.log('[compress] 正在写入 GLB...')
  const glbData = await io.writeBinary(doc)
  // 先写到临时文件再复制，避免 EPERM / 文件锁问题
  const tmpPath = path.join(require('os').tmpdir(), `vrm-compress-${Date.now()}.glb`)
  fs.writeFileSync(tmpPath, Buffer.from(glbData))
  console.log(`[compress] 临时文件: ${tmpPath} (${(fs.statSync(tmpPath).size / 1024 / 1024).toFixed(2)} MB)`)
  // 复制到目标路径
  fs.copyFileSync(tmpPath, outputPath)
  try { fs.unlinkSync(tmpPath) } catch { /* 忽略临时文件清理失败 */ }
  const sizeAfter = fs.statSync(outputPath).size
  const ratio = ((1 - sizeAfter / sizeBefore) * 100).toFixed(1)
  console.log(`[compress] 压缩后: ${(sizeAfter / 1024 / 1024).toFixed(2)} MB (减少 ${ratio}%)`)
  console.log(`[compress] 输出: ${outputPath}`)
}

const input = process.argv[2] || path.join(__dirname, 'src/renderer/public/vrm/peier.vrm')
const output = process.argv[3] || path.join(__dirname, 'src/renderer/public/vrm/peier-compressed.vrm')

compressVRM(input, output).catch((err) => {
  console.error('[compress] 失败:', err.message || err)
  process.exit(1)
})
