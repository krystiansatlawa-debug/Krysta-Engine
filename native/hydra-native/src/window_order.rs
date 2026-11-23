#[cfg(windows)]
use windows_sys::Win32::Foundation::{GetLastError, SetLastError, HWND, RECT};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsZoomed,
    SetForegroundWindow, SetWindowLongW, SetWindowPos, ShowWindowAsync, GWL_STYLE,
    SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SW_MINIMIZE, SW_RESTORE,
    WS_CAPTION, WS_THICKFRAME,
};

#[cfg(windows)]
pub fn get_foreground_window() -> Option<(String, u32)> {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(window, &mut process_id);
        if process_id == 0 {
            return None;
        }

        Some(((window as isize as i64).to_string(), process_id))
    }
}

#[cfg(not(windows))]
pub fn get_foreground_window() -> Option<(String, u32)> {
    None
}

#[cfg(windows)]
fn owned_window(handle: &str, process_id: u32) -> Option<HWND> {
    let hwnd = handle.parse::<isize>().ok()? as HWND;
    if hwnd.is_null() || process_id == 0 {
        return None;
    }
    let mut owner = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
    (owner == process_id).then_some(hwnd)
}

#[cfg(windows)]
pub fn minimize_game_window(handle: &str, process_id: u32) -> bool {
    owned_window(handle, process_id).is_some_and(|hwnd| unsafe {
        GetForegroundWindow() == hwnd
            && IsIconic(hwnd) == 0
            && ShowWindowAsync(hwnd, SW_MINIMIZE) != 0
    })
}

#[cfg(windows)]
pub fn restore_game_window(handle: &str, process_id: u32) -> bool {
    owned_window(handle, process_id).is_some_and(|hwnd| unsafe {
        if IsIconic(hwnd) == 0 || ShowWindowAsync(hwnd, SW_RESTORE) == 0 {
            return false;
        }
        SetForegroundWindow(hwnd);
        true
    })
}

#[cfg(windows)]
pub fn fullscreen_game_window(handle: &str, process_id: u32) -> bool {
    let Some(hwnd) = owned_window(handle, process_id) else {
        return false;
    };
    unsafe {
        if IsIconic(hwnd) != 0 || GetForegroundWindow() != hwnd {
            return false;
        }

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..std::mem::zeroed()
        };
        if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        let RECT {
            left,
            top,
            right,
            bottom,
        } = info.rcMonitor;
        if crate::window_bounds::get_window_bounds(handle).is_some_and(|bounds| {
            let client = bounds.client;
            client.left == left
                && client.top == top
                && client.right == right
                && client.bottom == bottom
        }) {
            return true;
        }

        if IsZoomed(hwnd) != 0 {
            ShowWindowAsync(hwnd, SW_RESTORE);
            return false;
        }

        let style = GetWindowLongW(hwnd, GWL_STYLE);
        let borderless = style & !((WS_CAPTION | WS_THICKFRAME) as i32);
        if borderless != style {
            SetLastError(0);
            if SetWindowLongW(hwnd, GWL_STYLE, borderless) == 0 && GetLastError() != 0 {
                return false;
            }
        }
        let queued = SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            left,
            top,
            right - left,
            bottom - top,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS,
        ) != 0;
        if !queued && borderless != style {
            SetWindowLongW(hwnd, GWL_STYLE, style);
        }
        // Confirm the new client bounds after the game handles the resize.
        false
    }
}

#[cfg(not(windows))]
pub fn minimize_game_window(_handle: &str, _process_id: u32) -> bool {
    false
}

#[cfg(not(windows))]
pub fn restore_game_window(_handle: &str, _process_id: u32) -> bool {
    false
}

#[cfg(not(windows))]
pub fn fullscreen_game_window(_handle: &str, _process_id: u32) -> bool {
    false
}
