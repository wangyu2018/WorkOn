/**
 * 行业词库 —— 智能报表五维富化的静态字典（无模型依赖）
 * 依据：v2.8 §3.4 行业词库体系
 */
import type { OutputType, UserType, WorkState } from './types'

// ───────────────────────── 词库结构 ─────────────────────────

/** 行业细分状态（如 会议 → 需求评审/庭审/客户拜访） */
export interface IndustryState {
  label: string
  keywords: string[]
}

export interface IndustryVocabulary {
  industryCode: string // 'it' | 'legal' | 'sales' | 'education' | 'finance'
  industryName: string
  /** 状态映射：通用 WorkState → 行业细分 */
  stateMappings: {
    meeting: IndustryState[]
    writing: IndustryState[]
    coding: IndustryState[]
    remote: IndustryState[]
  }
  /** 关键词库：窗口标题/OCR 文本匹配用 */
  keywords: {
    subjectPatterns: string[] // 对象（谁）
    projectPatterns: string[] // 项目（哪个）
    locationPatterns: string[] // 位置（哪里）
    outputPatterns: string[] // 产出（做了什么）
  }
  /** 应用映射：行业专用应用 → 工作内容 */
  appMappings: Record<string, { state: WorkState; contentTag: string; outputType?: OutputType }>
}

// ───────────────────────── 预置词库（v2.8 §3.4） ─────────────────────────

export const INDUSTRY_VOCABS: Record<string, IndustryVocabulary> = {
  it: {
    industryCode: 'it',
    industryName: 'IT/互联网',
    stateMappings: {
      meeting: [
        { label: '需求评审', keywords: ['需求', '评审', 'PRD'] },
        { label: '技术方案讨论', keywords: ['方案', '架构', '设计'] },
        { label: '站会', keywords: ['站会', 'standup', 'daily'] },
        { label: '代码评审', keywords: ['code review', 'CR', '代码'] }
      ],
      writing: [
        { label: '技术文档', keywords: ['文档', 'README', '设计稿'] },
        { label: '需求文档', keywords: ['PRD', '需求', '规格'] }
      ],
      coding: [
        { label: '功能开发', keywords: ['feature', '功能', '实现'] },
        { label: 'Bug修复', keywords: ['bug', 'fix', '修复'] },
        { label: '重构优化', keywords: ['refactor', '重构', '优化'] }
      ],
      remote: [
        { label: '服务器部署', keywords: ['deploy', '部署', 'publish'] },
        { label: '环境配置', keywords: ['config', '配置', 'docker'] },
        { label: '数据库操作', keywords: ['mysql', 'redis', 'sql'] }
      ]
    },
    keywords: {
      subjectPatterns: ['产品', '测试', '设计', '运维', '后端', '前端', 'PM'],
      projectPatterns: ['项目', '模块', '系统', '平台', '服务'],
      locationPatterns: ['服务器', '集群', '容器', '云', 'Git'],
      outputPatterns: ['代码', '文档', '配置', '脚本', '接口']
    },
    appMappings: {
      Cursor: { state: 'aidev', contentTag: 'AI辅助开发', outputType: 'code' },
      Docker: { state: 'remote', contentTag: '容器管理', outputType: 'config' },
      Postman: { state: 'coding', contentTag: '接口测试', outputType: 'other' }
    }
  },

  legal: {
    industryCode: 'legal',
    industryName: '法律',
    stateMappings: {
      meeting: [
        { label: '客户咨询', keywords: ['咨询', '面谈', '接待'] },
        { label: '庭审', keywords: ['庭审', '开庭', '审理'] },
        { label: '调解', keywords: ['调解', '和解'] }
      ],
      writing: [
        { label: '合同起草', keywords: ['合同', '协议', '起草'] },
        { label: '法律意见书', keywords: ['意见书', '法律意见'] },
        { label: '起诉状', keywords: ['起诉', '诉状'] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ['当事人', '委托人', '客户', '原告', '被告'],
      projectPatterns: ['案件', '项目', '纠纷', '事务'],
      locationPatterns: ['法院', '仲裁委', '公证处', 'Alpha系统'],
      outputPatterns: ['合同', '意见书', '起诉状', '答辩状', '备忘录']
    },
    appMappings: {
      Alpha: { state: 'writing', contentTag: '案件管理', outputType: 'document' },
      无讼: { state: 'writing', contentTag: '法律检索', outputType: 'document' }
    }
  },

  sales: {
    industryCode: 'sales',
    industryName: '销售/商务',
    stateMappings: {
      meeting: [
        { label: '客户拜访', keywords: ['拜访', '面访', '上门'] },
        { label: '商务谈判', keywords: ['谈判', '报价', '合同'] },
        { label: '产品演示', keywords: ['演示', 'demo', '展示'] }
      ],
      writing: [
        { label: '方案撰写', keywords: ['方案', 'proposal', '标书'] },
        { label: '报价单', keywords: ['报价', 'quotation', '价格'] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ['客户', '甲方', 'prospects', 'lead'],
      projectPatterns: ['项目', '商机', '订单', '合同'],
      locationPatterns: ['CRM', 'ERP', '客户系统'],
      outputPatterns: ['方案', '报价单', '合同', 'PPT', '邮件']
    },
    appMappings: {
      Salesforce: { state: 'writing', contentTag: 'CRM管理', outputType: 'data' },
      钉钉: { state: 'meeting', contentTag: '客户沟通', outputType: 'communication' }
    }
  },

  education: {
    industryCode: 'education',
    industryName: '教育',
    stateMappings: {
      meeting: [
        { label: '备课讨论', keywords: ['备课', '教研', '讨论'] },
        { label: '家长沟通', keywords: ['家长', '沟通'] },
        { label: '学术会议', keywords: ['学术', '研讨', '论坛'] }
      ],
      writing: [
        { label: '教案撰写', keywords: ['教案', '课件', 'PPT'] },
        { label: '试卷编写', keywords: ['试卷', '题目', '出题'] },
        { label: '论文写作', keywords: ['论文', 'paper', '期刊'] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ['学生', '家长', '同事', '导师', '评委'],
      projectPatterns: ['课程', '课题', '项目', '班级'],
      locationPatterns: ['教务系统', '实验室', '图书馆', 'LMS'],
      outputPatterns: ['教案', '课件', '试卷', '论文', '报告']
    },
    appMappings: {}
  },

  finance: {
    industryCode: 'finance',
    industryName: '财务/金融',
    stateMappings: {
      meeting: [
        { label: '审计会议', keywords: ['审计', '核算', '盘点'] },
        { label: '财报分析', keywords: ['财报', '分析', '预算'] }
      ],
      writing: [
        { label: '报表编制', keywords: ['报表', '台账', '凭证'] },
        { label: '预算编制', keywords: ['预算', 'forecast', '预测'] }
      ],
      coding: [],
      remote: []
    },
    keywords: {
      subjectPatterns: ['客户', '审计对象', '部门', '子公司'],
      projectPatterns: ['项目', '审计', '报表', '预算'],
      locationPatterns: ['金蝶', '用友', 'SAP', '银行系统'],
      outputPatterns: ['报表', '凭证', '报告', '底稿', '台账']
    },
    appMappings: {}
  }
}

// ───────────────────────── 行业检测 ─────────────────────────

/** 用户类型 → 默认行业（未明示行业时的先验） */
const USER_TYPE_INDUSTRY: Record<UserType, string> = {
  office_worker: 'it',
  freelancer: 'it',
  entrepreneur: 'sales',
  creator: 'education',
  student: 'education',
  exam_candidate: 'education'
}

/**
 * 检测用户行业：统计 topApps 命中各词库 appMappings 的数量，取最多者；
 * 无命中时按用户类型先验，仍无则默认 it
 */
export function detectIndustry(userType: UserType | undefined, topApps: string[]): IndustryVocabulary {
  const hits: Record<string, number> = {}
  for (const [code, vocab] of Object.entries(INDUSTRY_VOCABS)) {
    const appNames = Object.keys(vocab.appMappings)
    if (appNames.length === 0) continue
    hits[code] = topApps.filter((app) => appNames.some((name) => app.toLowerCase().includes(name.toLowerCase()))).length
  }
  const best = Object.entries(hits).sort((a, b) => b[1] - a[1])[0]
  if (best && best[1] > 0) return INDUSTRY_VOCABS[best[0]]
  const fallback = (userType && USER_TYPE_INDUSTRY[userType]) || 'it'
  return INDUSTRY_VOCABS[fallback]
}
