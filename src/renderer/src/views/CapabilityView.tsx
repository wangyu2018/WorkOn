/**
 * 能力边界页（PRD v3.0 §13）
 */
export default function CapabilityView() {
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      <h2 className="text-xl font-bold text-slate-100">⚡ 能力边界</h2>
      <p className="text-[13px] text-slate-500 -mt-2">
        每个功能的运行模式：无需 AI 即可运行 vs 开启 AI 后增强。关掉 AI 也能保留核心体验。
      </p>

      <div className="rounded-2xl border border-white/5 bg-ink-950/40 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-white/5 text-left text-slate-400">
              <th className="px-4 py-3 font-medium">功能</th>
              <th className="px-4 py-3 font-medium w-28 text-center">无需 AI</th>
              <th className="px-4 py-3 font-medium w-36 text-center">开启 AI 后增强</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {[
              ['日报/周报生成', '65% 覆盖（基础聚合层）', '95% + AI摘要/拆解'],
              ['工作/生活分类', '✓ 规则 + 拖拽纠偏', 'LLM 自动归类'],
              ['作业链路识别', '✓ 闭环规则匹配', 'LLM 链路命名'],
              ['快捷操作推荐', '✗ 需要模式学习', 'AI 推荐引擎'],
              ['注意力曲线', '✓ 算法计算', '—'],
              ['位置/天气提醒', '✓ 天气 API', '—'],
              ['文件夹内容分析', '✓ 正则解析', 'LLM 归纳总结'],
              ['标签体系', '✓ 用户规则 + 拖拽', 'AI 自动发现新标签'],
              ['OCR 深度识别', '✓ 本地引擎', 'LLM 增强'],
              ['问答 agent', '✗', '✓ 全功能'],
            ].map(([name, without, withAi], i) => (
              <tr key={i} className="border-t border-white/[0.04]">
                <td className="px-4 py-2.5 text-slate-200">{name}</td>
                <td className="px-4 py-2.5 text-center text-[12px] text-slate-400">{without}</td>
                <td className="px-4 py-2.5 text-center text-[12px] text-emerald-400">{withAi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-5 py-4 text-[12px] text-amber-300/80">
        <p className="font-medium text-amber-400 mb-1">💡 提示</p>
        <p>关掉 AI 后，WorkOn 依然能用本地规则引擎 + 文件解析 + 拖拽纠偏保持核心体验。AI 做的是"锦上添花"（摘要、拆解、推荐），不是"雪中送炭"。</p>
      </div>
    </div>
  )
}
