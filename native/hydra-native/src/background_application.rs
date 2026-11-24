#[cfg(windows)]
pub fn request_close(process_id: u32, expected_path: &str) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsWindowVisible,
        PostMessageW, GW_OWNER, WM_CLOSE,
    };

    struct CloseRequest {
        process_id: u32,
        posted: bool,
    }

    unsafe extern "system" fn request_window_close(window: HWND, state: LPARAM) -> i32 {
        let state = unsafe { &mut *(state as *mut CloseRequest) };
        let mut owner_id = 0;
        unsafe { GetWindowThreadProcessId(window, &mut owner_id) };
        let mut foreground_pid = 0;
        unsafe { GetWindowThreadProcessId(GetForegroundWindow(), &mut foreground_pid) };
        if owner_id == state.process_id
            && foreground_pid != state.process_id
            && unsafe { IsWindowVisible(window) } != 0
            && unsafe { GetWindow(window, GW_OWNER) }.is_null()
            && unsafe { PostMessageW(window, WM_CLOSE, 0, 0) } != 0
        {
            state.posted = true;
        }
        1
    }

    fn comparable_path(value: &str) -> String {
        value
            .strip_prefix(r"\\?\")
            .unwrap_or(value)
            .replace('/', "\\")
            .to_lowercase()
    }

    if process_id == 0 || process_id == std::process::id() {
        return false;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return false;
        }
        let mut buffer = vec![0u16; 32_768];
        let mut size = buffer.len() as u32;
        let matches = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0
            && comparable_path(&String::from_utf16_lossy(&buffer[..size as usize]))
                == comparable_path(expected_path);

        let mut state = CloseRequest {
            process_id,
            posted: false,
        };
        if matches {
            EnumWindows(Some(request_window_close), &mut state as *mut _ as LPARAM);
        }
        CloseHandle(process);
        state.posted
    }
}

#[cfg(not(windows))]
pub fn request_close(_process_id: u32, _expected_path: &str) -> bool {
    false
}
