#[cfg(windows)]
mod windows {
    use std::io;
    use std::sync::OnceLock;
    use windows_sys::core::{w, PCWSTR};
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD,
        RRF_RT_REG_DWORD,
    };
    use windows_sys::Win32::UI::Input::XboxController::XINPUT_STATE;

    type GetState = unsafe extern "system" fn(u32, *mut XINPUT_STATE) -> u32;
    static GET_STATE: OnceLock<Option<GetState>> = OnceLock::new();
    const GUIDE_BUTTON: u16 = 0x0400;
    // Windows versions store this controller-only setting in GameBar or GameDVR.
    const GAME_BAR_PATHS: [PCWSTR; 2] = [
        w!("Software\\Microsoft\\GameBar"),
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR"),
    ];
    const CONTROLLER_VALUE: PCWSTR = w!("UseNexusForGameBarEnabled");

    fn load_get_state() -> Option<GetState> {
        let dll: Vec<u16> = "xinput1_4.dll".encode_utf16().chain([0]).collect();
        // Only load the OS copy. Keep the module loaded for the lifetime of GET_STATE.
        let module = unsafe {
            LoadLibraryExW(dll.as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32)
        };
        if module.is_null() {
            return None;
        }

        // XInputGetStateEx (ordinal 100) has the XInputGetState ABI and also
        // reports Guide. SDL uses the same optional export for Guide support.
        unsafe {
            GetProcAddress(module, 100usize as *const u8)
                .map(|address| std::mem::transmute::<_, GetState>(address))
        }
    }

    pub fn battery_level(index: u32) -> Option<String> {
        use windows_sys::Win32::UI::Input::XboxController::{XInputGetBatteryInformation, XINPUT_BATTERY_INFORMATION};
        if index >= 4 { return None; }
        let mut info: XINPUT_BATTERY_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { XInputGetBatteryInformation(index, 0, &mut info) } != 0 { return None; }
        match info.BatteryType {
            0 => None,
            1 => Some("wired".into()),
            2 | 3 => match info.BatteryLevel {
                0 => Some("empty".into()),
                1 => Some("low".into()),
                2 => Some("medium".into()),
                3 => Some("full".into()),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn is_pressed() -> Option<bool> {
        let get_state = GET_STATE.get_or_init(load_get_state).as_ref()?;
        Some((0..4).any(|controller| {
            let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
            let connected = unsafe { get_state(controller, &mut state) } == 0;
            connected && state.Gamepad.wButtons & GUIDE_BUTTON != 0
        }))
    }

    fn read_controller_value(path: PCWSTR) -> io::Result<Option<u32>> {
        let mut value = 0u32;
        let mut size = size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                path,
                CONTROLLER_VALUE,
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut value as *mut u32).cast(),
                &mut size,
            )
        };
        match status {
            ERROR_SUCCESS => Ok(Some(value)),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            error => Err(io::Error::from_raw_os_error(error as i32)),
        }
    }

    fn write_controller_value(path: PCWSTR, value: Option<u32>) -> io::Result<()> {
        let status = match value {
            Some(value) => unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    path,
                    CONTROLLER_VALUE,
                    REG_DWORD,
                    (&value as *const u32).cast(),
                    size_of::<u32>() as u32,
                )
            },
            None => unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, path, CONTROLLER_VALUE) },
        };
        match status {
            ERROR_SUCCESS => Ok(()),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND if value.is_none() => Ok(()),
            error => Err(io::Error::from_raw_os_error(error as i32)),
        }
    }

    fn controller_enabled(paths: [PCWSTR; 2]) -> io::Result<bool> {
        let values = [
            read_controller_value(paths[0])?,
            read_controller_value(paths[1])?,
        ];
        Ok(values == [None, None] || values.into_iter().flatten().any(|value| value != 0))
    }

    fn set_controller_enabled(paths: [PCWSTR; 2], enabled: bool) -> io::Result<bool> {
        let previous = read_controller_value(paths[0])?;
        let next = Some(u32::from(enabled));
        write_controller_value(paths[0], next)?;
        if let Err(error) = write_controller_value(paths[1], next) {
            if read_controller_value(paths[0])? == next {
                write_controller_value(paths[0], previous)?;
            }
            return Err(error);
        }
        controller_enabled(paths)
    }

    pub fn game_bar_controller_enabled() -> io::Result<bool> {
        controller_enabled(GAME_BAR_PATHS)
    }

    pub fn set_game_bar_controller_enabled(enabled: bool) -> io::Result<bool> {
        set_controller_enabled(GAME_BAR_PATHS, enabled)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::System::Registry::RegDeleteTreeW;

        #[test]
        fn controller_setting_round_trips_both_windows_locations() {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let test_path = format!(
                "Software\\KrystaGameBarTest-{}-{timestamp}",
                std::process::id()
            );
            let wide = |value: &str| value.encode_utf16().chain([0]).collect::<Vec<_>>();
            let game_bar_path = wide(&format!("{test_path}\\GameBar"));
            let game_dvr_path = wide(&format!("{test_path}\\GameDVR"));
            let paths = [game_bar_path.as_ptr(), game_dvr_path.as_ptr()];

            let result = (|| -> io::Result<_> {
                let default = controller_enabled(paths)?;
                let disabled = set_controller_enabled(paths, false)?;
                let first_disabled = read_controller_value(paths[0])?;
                let second_disabled = read_controller_value(paths[1])?;
                let enabled = set_controller_enabled(paths, true)?;
                let first_enabled = read_controller_value(paths[0])?;
                let second_enabled = read_controller_value(paths[1])?;
                Ok((
                    default,
                    disabled,
                    first_disabled,
                    second_disabled,
                    enabled,
                    first_enabled,
                    second_enabled,
                ))
            })();
            unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(&test_path).as_ptr()) };

            assert_eq!(
                result.unwrap(),
                (true, false, Some(0), Some(0), true, Some(1), Some(1))
            );
        }
    }
}

#[cfg(windows)]
pub use windows::{is_pressed, battery_level};
#[cfg(not(windows))]
pub fn battery_level(_index: u32) -> Option<String> { None }
#[cfg(windows)]
pub use windows::{game_bar_controller_enabled, set_game_bar_controller_enabled};

#[cfg(not(windows))]
pub fn is_pressed() -> Option<bool> {
    None
}
