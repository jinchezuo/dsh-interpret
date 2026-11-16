import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Deployment configuration for the interpretation pipeline. */
export const Config = z.object({
  dataDir: z.string().default('').description('数据目录；留空使用 $DSH_HOME/interpret'),
  asrProvider: z.string().default('parakeet-local').description('parakeet-local 学术英文引擎；sensevoice-local 为官方轻量引擎'),
  asrModelDir: z.string().default('').description('自定义 Parakeet 模型目录；留空自动查找'),
  language: z.string().default('en').description('识别语种（v1 固定 en）'),
  mtProvider: z.string().default('').description('翻译 provider；留空自动选择'),
  mtModel: z.string().default('').description('翻译 model；留空自动选择'),
  mtEffort: z.string().default('low').description('翻译 reasoning effort'),
  temperature: z.number().min(0).max(1).default(0.2),
  maxOutputTokens: z.natural().min(64).default(1200),
  vadMode: z.string().default('auto').description('VAD：auto / silero / energy'),
  vadThreshold: z.number().min(0.001).max(0.2).default(0.008).description('能量 VAD 阈值'),
  minSpeechMs: z.natural().min(100).default(350),
  silenceMs: z.natural().min(100).default(500),
  maxSegmentMs: z.natural().min(1000).default(12000),
  systemAudio: z.string().default('auto').description('系统音频采集：auto / helper / off'),
  autoTranslate: z.boolean().default(true),
  draftMode: z.boolean().default(true).description('边说边出灰色英文草稿'),
  draftIntervalMs: z.natural().min(500).max(5000).default(1200),
  saveAudio: z.boolean().default(false),
  brief: z.string().default('').description('场景说明：课程/会议主题、领域、听众'),
})

/** Resolve the data root without creating it. */
export function resolveDataDir(configured) {
  const custom = String(configured || '').trim()
  if (custom) return resolve(custom.startsWith('~') ? join(homedir(), custom.slice(1)) : custom)
  const home = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  return join(home, 'interpret')
}

/** Keep only the settings this plugin understands. */
export function normalizeConfig(input = {}) {
  return {
    dataDir: String(input.dataDir ?? ''),
    asrProvider: String(input.asrProvider || 'parakeet-local'),
    asrModelDir: String(input.asrModelDir || ''),
    language: 'en',
    mtProvider: String(input.mtProvider || ''),
    mtModel: String(input.mtModel || ''),
    mtEffort: String(input.mtEffort || 'low'),
    temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.2,
    maxOutputTokens: Number.isFinite(Number(input.maxOutputTokens)) ? Number(input.maxOutputTokens) : 1200,
    vadMode: ['auto', 'silero', 'energy'].includes(String(input.vadMode)) ? String(input.vadMode) : 'auto',
    vadThreshold: Number.isFinite(Number(input.vadThreshold)) ? Number(input.vadThreshold) : 0.008,
    minSpeechMs: Number(input.minSpeechMs) || 350,
    silenceMs: Number(input.silenceMs) || 500,
    maxSegmentMs: Number(input.maxSegmentMs) || 12000,
    systemAudio: ['auto', 'helper', 'off'].includes(String(input.systemAudio)) ? String(input.systemAudio) : 'auto',
    autoTranslate: input.autoTranslate !== false,
    draftMode: input.draftMode !== false,
    draftIntervalMs: Number(input.draftIntervalMs) || 1200,
    saveAudio: input.saveAudio === true,
    brief: String(input.brief || '').slice(0, 2000),
  }
}
