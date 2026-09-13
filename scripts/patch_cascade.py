import io

# ── projects.ts: removeProject 级联补全 ──
p = 'src/main/projects.ts'
t = io.open(p, encoding='utf-8').read()
old = """  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.projectId === id)
  links.forEach((l) => removeFrom('projectTimeLinks', l.id))
}"""
new = """  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.projectId === id)
  links.forEach((l) => removeFrom('projectTimeLinks', l.id))
  // 级联补全：计划解链（保留条目清归属）、绑定与目录活动清理
  col<PlanItem>('plans')
    .filter((p) => p.projectId === id)
    .forEach((p) => updateIn<PlanItem>('plans', p.id, { projectId: undefined, projectTaskId: undefined }))
  col<{ id: string; projectId: string }>('projectBindings')
    .filter((b) => b.projectId === id)
    .forEach((b) => removeFrom('projectBindings', b.id))
  col<{ id: string; projectId: string }>('dirActivity')
    .filter((a) => a.projectId === id)
    .forEach((a) => removeFrom('dirActivity', a.id))
}"""
assert old in t, 'removeProject anchor'
t = t.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('projects cascade OK')

# ── ipc.ts: plans:setStatus 反哺 projectTaskId ──
p = 'src/main/ipc.ts'
t = io.open(p, encoding='utf-8').read()
old = """  ipcMain.handle('plans:setStatus', async (_e, id: string, status: PlanStatus) => {
    const updated = updateIn<PlanItem>('plans', id, { status })
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    return updated
  })"""
new = """  ipcMain.handle('plans:setStatus', async (_e, id: string, status: PlanStatus) => {
    const updated = updateIn<PlanItem>('plans', id, { status })
    // 核心闭环：挂了项目任务的待办，完成状态反哺 projectTasks
    if (updated?.projectTaskId) {
      const map: Record<string, ProjectTask['status']> = { done: 'done', in_progress: 'in_progress', partial: 'in_progress', planned: 'todo', delayed: 'blocked', cancelled: 'todo' }
      updateIn<ProjectTask>('projectTasks', updated.projectTaskId, { status: map[status] ?? 'todo' })
    }
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    return updated
  })"""
assert old in t, 'setStatus anchor'
t = t.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('setStatus OK')
