import io

p = 'src/renderer/src/components/ProjectBoard.tsx'
t = io.open(p, encoding='utf-8').read()

old = """                    {/* 里程碑：按类型模板生成粗颗粒节点 */}
                    {!hasMilestone(p.id) ? (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-slate-600">里程碑</span>
                        {Object.entries(MILESTONE_TEMPLATES).map(([k, tpl]) => (
                          <button
                            key={k}
                            className="rounded-full border border-dashed px-2 py-0.5 text-[10px] font-bold text-slate-500 transition-colors hover:border-[rgba(15,181,164,0.5)] hover:text-[var(--teal-deep)]"
                            onClick={() => void genMilestones(p.id, k)}
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        {(tasks[p.id] ?? []).filter((x) => x.isMilestone).map((x) => (
                          <span key={x.id} className="flex items-center gap-1 rounded bg-[var(--teal-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--teal-deep)]">
                            ◆ {x.title}{x.status === 'done' ? ' ✓' : ''}
                          </span>
                        ))}
                      </div>
                    )}"""

new = """                    {/* 里程碑：模板一键生成 + 编辑/AI 辅助入口 */}
                    {(() => {
                      const ms = (tasks[p.id] ?? []).filter((x) => x.isMilestone)
                      const editing = msEdit?.pid === p.id
                      return (
                        <div className="mb-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-600">里程碑</span>
                            {ms.map((x) => (
                              <span key={x.id} className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${x.status === 'done' ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'}`}>
                                ◆ {x.title}{x.status === 'done' ? ' ✓' : ''}
                              </span>
                            ))}
                            <button
                              className="ml-auto rounded-full border border-dashed px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-200"
                              onClick={() => setMsEdit({ pid: p.id, items: ms.map((x) => x.title), ai: false })}
                            >
                              编辑 / ✦ AI
                            </button>
                          </div>
                          {editing ? (
                            <div className="mt-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                              {msEdit.items.map((it, i) => (
                                <div key={i} className="mb-1 flex items-center gap-1.5">
                                  <span className="text-[10px] text-[var(--violet)]">◆</span>
                                  <input
                                    className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-[var(--border-active)]"
                                    value={it}
                                    onChange={(e) => setMsEdit((s) => (s ? { ...s, items: s.items.map((x, j) => (j === i ? e.target.value : x)) } : s))}
                                  />
                                  <button className="text-slate-600 hover:text-red-400" onClick={() => setMsEdit((s) => (s ? { ...s, items: s.items.filter((_, j) => j !== i) } : s))}>✕</button>
                                </div>
                              ))}
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <button className="rounded-full border border-dashed px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-200" onClick={() => setMsEdit((s) => (s ? { ...s, items: [...s.items, ''] } : s))}>＋ 节点</button>
                                <span className="text-[10px] text-slate-600">模板：</span>
                                {Object.entries(MILESTONE_TEMPLATES).map(([k, tpl]) => (
                                  <button key={k} className="rounded-full border border-dashed px-1.5 py-0.5 text-[9.5px] text-slate-500 hover:text-[var(--teal-deep)]" onClick={() => setMsEdit((s) => (s ? { ...s, items: [...tpl.items] } : s))}>
                                    {tpl.label}
                                  </button>
                                ))}
                                <button
                                  className="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--violet)] hover:bg-white/5"
                                  title="按项目目标 AI 生成里程碑"
                                  onClick={() => {
                                    void (async () => {
                                      const goal = projects.find((x) => x.id === p.id)?.goal ?? ''
                                      const r = (await window.api.askQA?.(
                                        '项目「' + p.name + '」目标：' + (goal || '（未填写）') + '。给出 4-6 个粗颗粒里程碑标题（不要详细设计类官样文字，要结果导向），只输出 JSON 字符串数组。'
                                      )) as { content?: string } | string | undefined
                                      const content = typeof r === 'string' ? r : r?.content ?? ''
                                      const m2 = content.match(/\\[[\\s\\S]*?\\]/)
                                      if (m2) {
                                        const arr: string[] = JSON.parse(m2[0])
                                        setMsEdit((s) => (s ? { ...s, items: arr.filter((x) => typeof x === 'string').slice(0, 8) } : s))
                                      }
                                    })()
                                  }}
                                >✦ AI 生成</button>
                              </div>
                              <div className="mt-1.5 flex justify-end gap-1.5">
                                <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setMsEdit(null)}>取消</button>
                                <button
                                  className="glass-btn primary !px-2 !py-0.5 !text-[10px]"
                                  onClick={() => {
                                    void (async () => {
                                      for (const x of ms) await window.api.removeProjectTask?.(x.id)
                                      for (const title of msEdit.items.filter((x) => x.trim())) {
                                        await window.api.saveProjectTask({ projectId: p.id, title: title.slice(0, 80), status: 'todo', priority: 'high', isMilestone: true })
                                      }
                                      setMsEdit(null)
                                      await loadTasks(p.id)
                                      await load()
                                    })()
                                  }}
                                >确认保存</button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}"""

assert old in t, 'ms-ui anchor missing'
t = t.replace(old, new, 1)

old2 = "  const [attrAdding, setAttrAdding] = useState<string | null>(null)"
new2 = """  const [attrAdding, setAttrAdding] = useState<string | null>(null)
  /** 里程碑编辑器（确认后整组替换里程碑任务） */
  const [msEdit, setMsEdit] = useState<{ pid: string; items: string[] } | null>(null)"""
assert old2 in t, 'state anchor'
t = t.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('patched OK')
