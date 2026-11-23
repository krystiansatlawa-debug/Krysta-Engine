#[cfg(windows)]
use windows_sys::Win32::Foundation::HWND;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    VK_CONTROL, VK_LWIN, VK_MENU, VK_RETURN, VK_RWIN, VK_SHIFT,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindowAsync,
    SW_MINIMIZE, SW_RESTORE,
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
pub fn get_game_display_mode(handle: &str, process_id: u32) -> Option<&'static str> {
    let hwnd = owned_window(handle, process_id)?;
    unsafe {
        if GetForegroundWindow() != hwnd || IsIconic(hwnd) != 0 {
            return None;
        }
        let client = crate::window_bounds::get_window_client_bounds(hwnd)?;
        if client.right <= client.left || client.bottom <= client.top {
            return None;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..std::mem::zeroed()
        };
        if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        let bounds = info.rcMonitor;
        if client.left > bounds.left
            || client.top > bounds.top
            || client.right < bounds.right
            || client.bottom < bounds.bottom
        {
            return Some("windowed");
        }

        let mut state = 0;
        match SHQueryUserNotificationState(&mut state) {
            0 if state == QUNS_RUNNING_D3D_FULL_SCREEN => Some("exclusive"),
            0 => Some("fullscreen"),
            _ => None,
        }
    }
}

#[cfg(windows)]
pub fn request_fullscreen(handle: &str, process_id: u32, expected_mode: &str) -> bool {
    if !matches!(expected_mode, "windowed" | "fullscreen")
        || get_game_display_mode(handle, process_id) != Some(expected_mode)
    {
        return false;
    }

    let hwnd = match owned_window(handle, process_id) {
        Some(hwnd) => hwnd,
        None => return false,
    };
    let input = |key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let events = [
        input(VK_MENU, 0),
        input(VK_RETURN, 0),
        input(VK_RETURN, KEYEVENTF_KEYUP),
        input(VK_MENU, KEYEVENTF_KEYUP),
    ];
    unsafe {
        if [VK_MENU, VK_RETURN, VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN]
            .into_iter()
            .any(|key| GetAsyncKeyState(i32::from(key)) < 0)
            || GetForegroundWindow() != hwnd
        {
            return false;
        }
        let size = std::mem::size_of::<INPUT>() as i32;
        let sent = SendInput(events.len() as u32, events.as_ptr(), size);
        // Complete the releases if Windows accepted only the start of the chord.
        if sent == 2 {
            SendInput(2, events[2..].as_ptr(), size);
        } else if sent == 1 || sent == 3 {
            SendInput(1, events[3..].as_ptr(), size);
        }
        sent == events.len() as u32
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
pub fn get_game_display_mode(_handle: &str, _process_id: u32) -> Option<&'static str> {
    None
}

#[cfg(not(windows))]
pub fn request_fullscreen(_handle: &str, _process_id: u32, _expected_mode: &str) -> bool {
    false
}
