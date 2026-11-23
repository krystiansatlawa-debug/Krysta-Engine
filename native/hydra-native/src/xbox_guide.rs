#[cfg(windows)]
mod windows {
    use std::sync::OnceLock;
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    use windows_sys::Win32::UI::Input::XboxController::XINPUT_STATE;

    type GetState = unsafe extern "system" fn(u32, *mut XINPUT_STATE) -> u32;
    static GET_STATE: OnceLock<Option<GetState>> = OnceLock::new();
    const GUIDE_BUTTON: u16 = 0x0400;

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

    pub fn is_pressed() -> Option<bool> {
        let get_state = GET_STATE.get_or_init(load_get_state).as_ref()?;
        Some((0..4).any(|controller| {
            let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
            let connected = unsafe { get_state(controller, &mut state) } == 0;
            connected && state.Gamepad.wButtons & GUIDE_BUTTON != 0
        }))
    }
}

#[cfg(windows)]
pub use windows::is_pressed;

#[cfg(not(windows))]
pub fn is_pressed() -> Option<bool> {
    None
}
