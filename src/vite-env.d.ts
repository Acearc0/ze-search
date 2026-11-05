/// <reference types="vite/client" />

// Tauri API类型声明
declare global {
  // 构建期由 vite.config.ts 通过 define 注入，用于分辨安装包来自哪次提交。
  // 必须声明在 declare global 内：本文件末尾有 export{}（模块），
  // 顶层 declare const 在模块里只对当前文件可见。
  const __APP_VERSION__: string
  const __APP_COMMIT__: string
  const __APP_BUILD_TIME__: string

  interface Window {
    __TAURI__?: {
      sql?: {
        load: (path: string) => Promise<any>;
      };
      invoke?: (cmd: string, args?: any) => Promise<any>;
    };
    __TAURI_INTERNALS__?: any;
  }
}

export {};

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
