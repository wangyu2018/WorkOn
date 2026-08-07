/**
 * VRM 纹理压缩脚本 (GLB 直读直写版)
 *
 * 不使用 glTF-Transform 的 transform() 管线，
 * 而是直接操作 GLB 二进制结构：
 *   1. 解析 GLB header + JSON chunk + BIN chunk
 *   2. 保留 VRM 扩展 JSON 完全不动
 *   3. 对每个 image 的 bufferView 进行 sharp 压缩 (resize + WebP)
 *   4. 更新 bufferView byteLength + image mimeType
 *   5. 重建 GLB 二进制
 *
 * 这样 VRM 扩展数据（humanoid, springBone, blendShape, materialProperties 等）完全保留。
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const GLB_MAGIC = 0x46546c67 // 'glTF'
const GLB_VERSION = 2
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

/**
 * 解析 GLB 文件为 { json, bin } 
 */
function parseGLB(buf) {
  const magic = buf.readUInt32LE(0)
  if (magic !== GLB_MAGIC) throw new Error('Not a GLB file')
  const version = buf.readUInt32LE(4)
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`)
  const totalLength = buf.readUInt32LE(8)

  let offset = 12
  let json = null
  let bin = null

  while (offset < totalLength) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const chunkData = buf.subarray(offset + 8, offset + 8 + chunkLength)
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(chunkData.toString('utf8'))
    } else if (chunkType === CHUNK_BIN) {
      bin = Buffer.from(chunkData)
    }
    offset += 8 + chunkLength
  }

  return { json, bin }
}

/**
 * 构建 GLB 二进制
 */
function buildGLB(json, bin) {
  // JSON chunk
  const jsonStr = JSON.stringify(json)
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  // Pad to 4-byte boundary with spaces (0x20)
  let jsonPadded = jsonBuf
  while (jsonPadded.length % 4 !== 0) {
    jsonPadded = Buffer.concat([jsonPadded, Buffer.from([0x20])])
  }

  // BIN chunk — pad to 4-byte boundary with zeros
  let binPadded = bin || Buffer.alloc(0)
  while (binPadded.length % 4 !== 0) {
    binPadded = Buffer.concat([binPadded, Buffer.alloc(1)])
  }

  // GLB header: 12 bytes
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(GLB_VERSION, 4)
  header.writeUInt32LE(totalLength, 8)

  // JSON chunk header
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4)

  // BIN chunk header
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.writeUInt32LE(CHUNK_BIN, 4)

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded])
}

/**
 * 压缩 VRM 纹理
 */
async function compressVRM(inputPath, outputPath) {
  const sizeBefore = fs.statSync(inputPath).size
  console.log(`[compress] 输入: ${inputPath}`)
  console.log(`[compress] 原始大小: ${(sizeBefore / 1024 / 1024).toFixed(2)} MB`)

  const rawBuf = fs.readFileSync(inputPath)
  const { json, bin } = parseGLB(rawBuf)

  // 统计
  console.log(`[compress] 网格: ${(json.meshes || []).length}, 纹理: ${(json.textures || []).length}, 材质: ${(json.materials || []).length}`)

  // 检查 VRM 扩展
  const vrmExt = json.extensions?.VRM
  if (vrmExt) {
    console.log(`[compress] VRM 扩展: 已保留 (humanoid: ${vrmExt.humanoid?.humanBones?.length || 0} bones, specVersion: ${vrmExt.specVersion})`)
  } else {
    console.warn('[compress] 警告: 未找到 VRM 扩展!')
  }

  // 收集所有需要压缩的 image
  const images = json.images || []
  const bufferViews = json.bufferViews || []
  const buffers = json.buffers || []
  const textures = json.textures || []

  console.log(`[compress] 图片: ${images.length}, bufferViews: ${bufferViews.length}, textures: ${textures.length}`)

  // 纹理压缩配置
  const MAX_SIZE = 2048
  const WEBP_QUALITY = 80

  let compressedCount = 0
  let skippedCount = 0
  let totalSaved = 0

  // 处理每个 image
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (!img.bufferView !== undefined && img.bufferView === undefined) {
      // 引用 URI 的图片（base64）— 跳过
      if (img.uri) {
        console.log(`[compress]   图片 ${i}: URI 引用，跳过`)
        skippedCount++
        continue
      }
    }

    const bvIdx = img.bufferView
    if (bvIdx === undefined) {
      console.log(`[compress]   图片 ${i}: 无 bufferView，跳过`)
      skippedCount++
      continue
    }

    const bv = bufferViews[bvIdx]
    if (!bv || bv.buffer === undefined) {
      console.log(`[compress]   图片 ${i}: bufferView 无 buffer，跳过`)
      skippedCount++
      continue
    }

    // 从 bin 中提取图片数据
    const offset = bv.byteOffset || 0
    const length = bv.byteLength
    const imgBuf = bin.subarray(offset, offset + length)
    const oldSize = imgBuf.length

    try {
      // 用 sharp 压缩
      let sharpImg = sharp(imgBuf, { failOn: 'none' })
      const metadata = await sharpImg.metadata()
      const origW = metadata.width || 0
      const origH = metadata.height || 0

      // Resize if larger than MAX_SIZE
      if (origW > MAX_SIZE || origH > MAX_SIZE) {
        sharpImg = sharpImg.resize({
          width: MAX_SIZE,
          height: MAX_SIZE,
          fit: 'inside',
          withoutEnlargement: true,
        })
      }

      const compressedBuf = await sharpImg
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()

      const newSize = compressedBuf.length
      const saved = oldSize - newSize
      const ratio = ((1 - newSize / oldSize) * 100).toFixed(0)

      // 更新 bin 中的数据 — 先记录，后面统一重建
      img._compressedData = compressedBuf
      img._oldSize = oldSize
      img._newSize = newSize
      img._origDim = `${origW}x${origH}`

      // 更新 mimeType
      img.mimeType = 'image/webp'

      totalSaved += saved
      compressedCount++

      console.log(`[compress]   图片 ${i} "${img.name || ''}": ${origW}x${origH} ${oldSize}B → ${newSize}B (-${ratio}%)`)
    } catch (err) {
      console.warn(`[compress]   图片 ${i}: 压缩失败 (${err.message})，保留原始数据`)
      skippedCount++
    }
  }

  // 更新 extensionsUsed — 添加 EXT_texture_webp
  if (!json.extensionsUsed) json.extensionsUsed = []
  if (!json.extensionsUsed.includes('EXT_texture_webp')) {
    json.extensionsUsed.push('EXT_texture_webp')
  }
  if (!json.extensionsRequired) json.extensionsRequired = []
  if (!json.extensionsRequired.includes('EXT_texture_webp')) {
    // 不强制要求 webp — 如果解码器不支持可以回退
  }

  // 更新 textures 的 extensions
  for (const tex of textures) {
    if (!tex.extensions) tex.extensions = {}
    tex.extensions.EXT_texture_webp = { source: tex.source }
  }

  // 重建 bin 数据
  // 策略：保持原始 bin 中非图片数据不动，将压缩后的图片数据追加到 bin 末尾
  // 然后更新对应 bufferView 的 byteOffset 和 byteLength

  // 收集需要更新的 bufferViews
  const newBinParts = []
  let currentOffset = 0

  // 先复制原始 bin 中非图片数据（保持原位）
  // 实际上更简单的策略：创建全新的 bin buffer
  // 1. 遍历所有 bufferViews，将非图片的保留原位
  // 2. 图片的用压缩后数据替换

  // 创建新 bin
  const newBinParts2 = []
  const bvNewOffsets = new Map() // bvIdx -> { offset, length }

  for (let i = 0; i < bufferViews.length; i++) {
    const bv = bufferViews[i]
    const imgIdx = images.findIndex(img => img.bufferView === i)

    if (imgIdx >= 0 && images[imgIdx]._compressedData) {
      // 使用压缩后数据
      const data = images[imgIdx]._compressedData
      // 4-byte 对齐
      let padding = 0
      while ((currentOffset + padding) % 4 !== 0) padding++
      if (padding > 0) {
        newBinParts2.push(Buffer.alloc(padding))
        currentOffset += padding
      }
      bvNewOffsets.set(i, { offset: currentOffset, length: data.length })
      newBinParts2.push(data)
      currentOffset += data.length
    } else {
      // 保留原始数据
      const offset = bv.byteOffset || 0
      const length = bv.byteLength
      const data = bin.subarray(offset, offset + length)
      // 4-byte 对齐
      let padding = 0
      while ((currentOffset + padding) % 4 !== 0) padding++
      if (padding > 0) {
        newBinParts2.push(Buffer.alloc(padding))
        currentOffset += padding
      }
      bvNewOffsets.set(i, { offset: currentOffset, length: length })
      newBinParts2.push(Buffer.from(data))
      currentOffset += length
    }
  }

  // 更新 bufferViews
  for (const [bvIdx, info] of bvNewOffsets) {
    bufferViews[bvIdx].byteOffset = info.offset
    bufferViews[bvIdx].byteLength = info.length
  }

  // 更新 buffer 的 byteLength
  if (buffers.length > 0) {
    buffers[0].byteLength = currentOffset
  }

  // 清理临时属性
  for (const img of images) {
    delete img._compressedData
    delete img._oldSize
    delete img._newSize
    delete img._origDim
  }

  // 构建 GLB
  const newBin = Buffer.concat(newBinParts2)
  const glbBuf = buildGLB(json, newBin)

  // 写入（先写临时文件再复制）
  const os = require('os')
  const tmpPath = path.join(os.tmpdir(), `vrm-compress-${Date.now()}.vrm`)
  fs.writeFileSync(tmpPath, glbBuf)
  console.log(`[compress] 临时文件: ${tmpPath} (${(glbBuf.length / 1024 / 1024).toFixed(2)} MB)`)

  fs.copyFileSync(tmpPath, outputPath)
  try { fs.unlinkSync(tmpPath) } catch { /* 忽略 */ }

  const sizeAfter = fs.statSync(outputPath).size
  const ratio = ((1 - sizeAfter / sizeBefore) * 100).toFixed(1)
  console.log(`[compress] 压缩后: ${(sizeAfter / 1024 / 1024).toFixed(2)} MB (减少 ${ratio}%)`)
  console.log(`[compress] 纹理: ${compressedCount} 已压缩, ${skippedCount} 跳过`)
  console.log(`[compress] 纹理节省: ${(totalSaved / 1024 / 1024).toFixed(2)} MB`)
  console.log(`[compress] 输出: ${outputPath}`)

  // 验证 VRM 扩展
  const verifyBuf = fs.readFileSync(outputPath)
  const { json: verifyJson } = parseGLB(verifyBuf)
  if (verifyJson.extensions?.VRM) {
    console.log('[compress] 验证: VRM 扩展已保留 ✓')
  } else {
    console.warn('[compress] 验证: VRM 扩展丢失! ✗')
  }
}

const input = process.argv[2] || path.join(__dirname, 'src/renderer/public/vrm/peier.vrm')
const output = process.argv[3] || path.join(__dirname, 'peier-compressed.vrm')

compressVRM(input, output).catch((err) => {
  console.error('[compress] 失败:', err.message || err)
  process.exit(1)
})
