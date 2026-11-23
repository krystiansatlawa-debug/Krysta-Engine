#[cfg(windows)]
use windows_sys::Win32::Foundation::HWND;
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

#[cfg(not(windows))]
pub fn minimize_game_window(_handle: &str, _process_id: u32) -> bool {
    false
}

#[cfg(not(windows))]
pub fn restore_game_window(_handle: &str, _process_id: u32) -> bool {
    false
}
