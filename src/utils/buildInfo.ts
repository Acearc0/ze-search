/**
 * 构建标识：把 git commit 与构建时间并入版本字符串。
 *
 * 背景：tauri.conf.json 的 version 长期停在同一个数字，装了包、下了 Actions 产物
 * 都分不清是哪次提交构建的。构建期由 vite.config.ts 通过 define 注入 commit 短哈希
 * 与构建时间，关于页据此展示完整版本。
 *
 * 关于 typeof 守卫：vite define 是编译期文本替换。正常构建产物里这些标识符已被替换掉；
 * 但若某条路径没经过该 define（如仅类型检查、或配置被绕过），裸标识符会抛
 * ReferenceError。typeof 对未声明标识符不抛错，因此这里统一用 typeof 兜底。
 */

/** 无效值集合：非 git 环境或读取失败时 vite 侧会给出这些占位 */
const INVALID = new Set(['', 'unknown', 'null', 'undefined'])

const clean = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  return INVALID.has(text.toLowerCase()) ? '' : text
}

/** tauri.conf.json 中的语义版本；取不到时为空串，由展示层决定如何回退 */
export const APP_VERSION: string =
  clean(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '')

/** commit 短哈希，本地未提交时带 -dirty 后缀；非 git 环境为空串 */
export const APP_COMMIT: string =
  clean(typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '')

/** 构建时间（本地时区，精确到分钟）；取不到时为空串 */
export const APP_BUILD_TIME: string =
  clean(typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : '')

/**
 * 关于页展示用的完整版本字符串。
 * 有 commit 时形如 `2.2.7 (d8c9ced · 2026-11-05 15:08)`，
 * 拿不到 commit 时退回纯版本号；两者都没有则返回空串，交给调用方兜底。
 *
 * commit / buildTime 默认取构建期注入值，允许显式传入以便单测覆盖各种组合。
 *
 * @param runtimeVersion 运行时 getVersion() 拿到的版本，优先于构建期读取值
 */
export const formatDisplayVersion = (
  runtimeVersion = '',
  commit: string = APP_COMMIT,
  buildTime: string = APP_BUILD_TIME
): string => {
  const version = clean(runtimeVersion) || APP_VERSION
  if (!version) return ''
  const sha = clean(commit)
  if (!sha) return version
  const time = clean(buildTime)
  return time ? `${version} (${sha} · ${time})` : `${version} (${sha})`
}
