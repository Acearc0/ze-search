import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const host = process.env.TAURI_DEV_HOST;

/**
 * 构建标识：把 commit 短哈希与构建时间注入前端，
 * 用于分辨「装的是哪次提交的包」（tauri 的 version 长期不变，光看版本号分不出）。
 *
 * 哈希口径必须与 CI 里重命名安装包用的完全一致（都是 rev-parse --short=7），
 * 否则关于页显示的哈希对不上产物文件名，反而更难分辨。
 * 非 git 环境（源码包直接构建、浅克隆异常）返回空串，展示层会退回纯版本号。
 */
const git = (cmd: string): string => {
  try {
    return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

const readGitCommit = (): string => {
  const sha = git('git rev-parse --short=7 HEAD')
  if (!sha) return ''
  // 只看已跟踪文件的改动：构建会产出未被 .gitignore 覆盖的中间文件，
  // 若把未跟踪文件也算 dirty，CI 包会莫名带上 -dirty，与产物文件名对不上
  return git('git status --porcelain --untracked-files=no') ? `${sha}-dirty` : sha
}

const readAppVersion = (): string => {
  try {
    const raw = readFileSync(resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf8')
    return String(JSON.parse(raw)?.version || '').trim()
  } catch {
    return ''
  }
}

const appCommit = readGitCommit()
const appVersion = readAppVersion()
// 构建时间用本地时区、手工拼接，避免依赖 Node 的 ICU locale 数据
const buildNow = new Date()
const pad2 = (n: number) => String(n).padStart(2, '0')
const appBuildTime = `${buildNow.getFullYear()}-${pad2(buildNow.getMonth() + 1)}-${pad2(buildNow.getDate())} ${pad2(buildNow.getHours())}:${pad2(buildNow.getMinutes())}`

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  build: {
    // 禁用类型检查以加快构建速度
    rollupOptions: {
      onwarn(warning, warn) {
        // 忽略 TypeScript 相关的警告
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return;
        warn(warning);
      }
    },
    // 确保静态资源被复制到构建输出
    copyPublicDir: true,
    assetsDir: 'assets',
    // 配置静态资源处理
    assetsInlineLimit: 0, // 禁用内联，确保图片作为独立文件
  },

  // 配置静态资源目录
  publicDir: 'public',
  
  // 确保 src/assets 中的文件被处理
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.webp'],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
