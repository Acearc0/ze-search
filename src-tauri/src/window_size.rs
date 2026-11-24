use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SavedWindowState {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub maximized: bool,
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("window-state.json"))
}

/// 读取上次保存的主窗口状态；文件缺失或损坏时返回 None，调用方回退到默认尺寸。
pub fn load_window_state(app: &AppHandle) -> Option<SavedWindowState> {
    let path = state_path(app)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedWindowState>(&raw).ok()
}

fn write_window_state(app: &AppHandle, state: &SavedWindowState) {
    let Some(path) = state_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, raw);
    }
}

/// 取窗口当前尺寸/位置（逻辑像素）。最大化时不覆盖已保存的正常尺寸，
/// 否则把「最大化后的尺寸」写进配置，下次还原窗口会变成全屏大小。
pub fn capture_window_state(
    window: &WebviewWindow,
    previous: Option<&SavedWindowState>,
) -> Option<SavedWindowState> {
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        let mut next = previous.cloned().unwrap_or_default();
        next.maximized = true;
        return if next.width > 0.0 && next.height > 0.0 {
            Some(next)
        } else {
            None
        };
    }

    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    let size = window.inner_size().ok()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    if width < 320.0 || height < 240.0 {
        return None;
    }

    let (x, y) = match window.outer_position() {
        Ok(pos) => (Some(pos.x as f64 / scale), Some(pos.y as f64 / scale)),
        Err(_) => (
            previous.and_then(|state| state.x),
            previous.and_then(|state| state.y),
        ),
    };

    Some(SavedWindowState {
        width,
        height,
        x,
        y,
        maximized: false,
    })
}

/// 把保存的尺寸裁进当前屏幕：换显示器/分辨率变小后，旧尺寸不能超出工作区。
pub fn fit_saved_state(app: &AppHandle, saved: &SavedWindowState, preset: WindowSizePreset) -> Option<ResolvedWindowSize> {
    if saved.width < 320.0 || saved.height < 240.0 {
        return None;
    }
    let mut width = saved.width;
    let mut height = saved.height;

    if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let scale = monitor.scale_factor().max(1.0);
        let screen = if preset.use_work_area {
            &monitor.work_area().size
        } else {
            monitor.size()
        };
        let max_width = preset.max_width.min(screen.width as f64 / scale);
        let max_height = preset.max_height.min(screen.height as f64 / scale);
        width = clamp(width, preset.min_width.min(max_width), max_width);
        height = clamp(height, preset.min_height.min(max_height), max_height);
    }

    Some(ResolvedWindowSize {
        width,
        height,
        min_width: preset.min_width.min(width),
        min_height: preset.min_height.min(height),
    })
}

/// 保存的位置是否还落在某块屏幕里（多显示器拔掉后不能把窗口还原到屏幕外）。
pub fn saved_position_visible(app: &AppHandle, saved: &SavedWindowState) -> Option<(f64, f64)> {
    let (x, y) = (saved.x?, saved.y?);
    let monitors = app.available_monitors().ok()?;
    let visible = monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor().max(1.0);
        let pos = monitor.position();
        let size = monitor.size();
        let left = pos.x as f64 / scale;
        let top = pos.y as f64 / scale;
        let right = left + size.width as f64 / scale;
        let bottom = top + size.height as f64 / scale;
        // 至少留出 60px 的可抓取区域，避免只露一条边
        x + 60.0 < right && y + 20.0 < bottom && x > left - 200.0 && y > top - 40.0
    });
    if visible {
        Some((x, y))
    } else {
        None
    }
}

/// 挂上主窗口的尺寸记忆：resize/move 时打脏标记，后台线程节流写入；
/// 关闭窗口时立刻写一次（此时窗口还在，能拿到最终尺寸）。
pub fn attach_main_window_state(window: &WebviewWindow) {
    static DIRTY: AtomicBool = AtomicBool::new(false);

    let app = window.app_handle().clone();
    // 事件闭包会 move 走一份 handle，后面给写盘线程还要用，所以先克隆一份
    let event_app = app.clone();
    let win = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
            DIRTY.store(true, Ordering::Relaxed);
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            let previous = load_window_state(&event_app);
            if let Some(state) = capture_window_state(&win, previous.as_ref()) {
                write_window_state(&event_app, &state);
            }
        }
        _ => {}
    });

    let handle = app.clone();
    let _ = std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(900));
        if !DIRTY.swap(false, Ordering::Relaxed) {
            continue;
        }
        let Some(window) = handle.get_webview_window("main") else { continue };
        let previous = load_window_state(&handle);
        if let Some(state) = capture_window_state(&window, previous.as_ref()) {
            write_window_state(&handle, &state);
        }
    });
}

#[derive(Clone, Copy)]
pub struct WindowSizePreset {
    pub preferred_width: f64,
    pub preferred_height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub width_ratio: f64,
    pub height_ratio: f64,
    pub max_width: f64,
    pub max_height: f64,
    use_work_area: bool,
}

impl WindowSizePreset {
    pub const fn new(
        preferred_width: f64,
        preferred_height: f64,
        min_width: f64,
        min_height: f64,
        width_ratio: f64,
        height_ratio: f64,
        max_width: f64,
        max_height: f64,
    ) -> Self {
        Self {
            preferred_width,
            preferred_height,
            min_width,
            min_height,
            width_ratio,
            height_ratio,
            max_width,
            max_height,
            use_work_area: false,
        }
    }
}

#[derive(Clone, Copy)]
pub struct ResolvedWindowSize {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

#[cfg(windows)]
pub const MAIN_WINDOW_PRESET: WindowSizePreset = WindowSizePreset {
    use_work_area: true,
    ..WindowSizePreset::new(1280.0, 760.0, 780.0, 540.0, 0.84, 0.88, 1720.0, 1100.0)
};

#[cfg(not(windows))]
pub const MAIN_WINDOW_PRESET: WindowSizePreset =
    // 略加大：1920x1080 约 1180x740，笔记本仍按比例收敛
    WindowSizePreset::new(1120.0, 740.0, 780.0, 540.0, 0.615, 0.685, 1280.0, 900.0);

pub const URL_CONTENT_WINDOW_PRESET: WindowSizePreset =
    WindowSizePreset::new(1200.0, 800.0, 1000.0, 600.0, 0.84, 0.86, 1720.0, 1180.0);

pub const FILE_INFO_WINDOW_PRESET: WindowSizePreset =
    WindowSizePreset::new(1280.0, 900.0, 960.0, 600.0, 0.84, 0.88, 1720.0, 1200.0);

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

pub fn resolve_window_size(app: &AppHandle, preset: WindowSizePreset) -> ResolvedWindowSize {
    let mut width = preset.preferred_width;
    let mut height = preset.preferred_height;
    let mut min_width = preset.min_width.min(width);
    let mut min_height = preset.min_height.min(height);

    let monitor = app
        .get_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale_factor = monitor.scale_factor().max(1.0);
        let screen = if preset.use_work_area {
            &monitor.work_area().size
        } else {
            monitor.size()
        };
        let screen_width = screen.width as f64 / scale_factor;
        let screen_height = screen.height as f64 / scale_factor;

        let (available_width, available_height) = if preset.use_work_area {
            (screen_width.max(1.0), screen_height.max(1.0))
        } else {
            (
                (screen_width - 48.0).max(640.0),
                (screen_height - 72.0).max(480.0),
            )
        };

        let max_width = preset.max_width.min(available_width);
        let max_height = preset.max_height.min(available_height);

        width = clamp(
            (screen_width * preset.width_ratio).floor(),
            640.0_f64.min(max_width),
            max_width,
        );
        height = clamp(
            (screen_height * preset.height_ratio).floor(),
            480.0_f64.min(max_height),
            max_height,
        );

        min_width = preset.min_width.min(width);
        min_height = preset.min_height.min(height);
    }

    ResolvedWindowSize {
        width,
        height,
        min_width,
        min_height,
    }
}
