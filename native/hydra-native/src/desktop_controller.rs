use napi_derive::napi;

#[napi(object)]
#[derive(Clone)]
pub struct WindowsDesktopControllerFrame {
    pub id: String,
    pub name: String,
    pub layout: String,
    pub axes: Vec<f64>,
    pub buttons: u32,
}

#[napi(object)]
pub struct WindowsDesktopControllerDevice {
    pub id: String,
    pub name: String,
    pub layout: String,
}

#[napi]
pub fn poll_windows_desktop_controllers() -> Vec<WindowsDesktopControllerFrame> {
    #[cfg(windows)]
    return windows_runtime::poll();
    #[cfg(not(windows))]
    Vec::new()
}

#[napi]
pub fn stop_windows_desktop_controller_input() {
    #[cfg(windows)]
    windows_runtime::stop();
}

#[napi]
pub async fn list_windows_desktop_controllers() -> Vec<WindowsDesktopControllerDevice> {
    #[cfg(windows)]
    return tokio::task::spawn_blocking(windows_runtime::list)
        .await
        .unwrap_or_default();
    #[cfg(not(windows))]
    Vec::new()
}

#[napi]
pub async fn get_windows_desktop_editable_focus() -> Option<String> {
    #[cfg(windows)]
    return tokio::task::spawn_blocking(windows_runtime::editable_focus)
        .await
        .ok()
        .flatten();
    #[cfg(not(windows))]
    None
}

#[napi]
pub fn show_windows_desktop_keyboard() -> bool {
    #[cfg(windows)]
    return windows_runtime::show_keyboard();
    #[cfg(not(windows))]
    false
}

// USB and full Bluetooth input reports use the same data after their headers.
#[cfg(any(windows, test))]
fn parse_dualsense_report(report: &[u8], bluetooth: bool) -> Option<([f64; 4], u32)> {
    let (axes, keys, triggers) = match report {
        [0x31, _, rest @ ..] if report.len() == 78 => (&rest[..4], &rest[7..10], &rest[4..6]),
        [0x01, rest @ ..] if report.len() == 10 || (bluetooth && rest.len() >= 9) => {
            (&rest[..4], &rest[4..7], &rest[7..9])
        }
        [0x01, rest @ ..] if report.len() == 64 => (&rest[..4], &rest[7..10], &rest[4..6]),
        _ => return None,
    };
    let mut buttons = 0;
    let mut set = |index, pressed| {
        if pressed {
            buttons |= 1u32 << index;
        }
    };
    for (index, mask) in [(0, 0x20), (1, 0x40), (2, 0x10), (3, 0x80)] {
        set(index, keys[0] & mask != 0);
    }
    for (index, mask) in [
        (4, 0x01),
        (5, 0x02),
        (8, 0x10),
        (9, 0x20),
        (10, 0x40),
        (11, 0x80),
    ] {
        set(index, keys[1] & mask != 0);
    }
    set(6, keys[1] & 0x04 != 0 || triggers[0] > 127);
    set(7, keys[1] & 0x08 != 0 || triggers[1] > 127);
    let hat = keys[0] & 0x0f;
    set(12, matches!(hat, 0 | 1 | 7));
    set(13, matches!(hat, 3..=5));
    set(14, matches!(hat, 5..=7));
    set(15, matches!(hat, 1..=3));
    set(16, keys[2] & 0x01 != 0);
    set(17, keys[2] & 0x02 != 0);
    set(18, keys[2] & 0x04 != 0);
    Some((
        std::array::from_fn(|index| (f64::from(axes[index]) - 127.5) / 127.5),
        buttons,
    ))
}

#[cfg(windows)]
mod windows_runtime {
    use std::collections::{HashMap, HashSet};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    use hidapi::{BusType, DeviceInfo, HidApi, HidDevice};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextEditPattern, IUIAutomationValuePattern,
        UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_TextEditPatternId,
        UIA_ValuePatternId,
    };
    use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, IsIconic, IsWindowVisible, ShowWindow, SW_SHOWNOACTIVATE,
    };

    use super::{
        parse_dualsense_report, WindowsDesktopControllerDevice, WindowsDesktopControllerFrame,
    };

    struct DualSenseWorker {
        stop: mpsc::Sender<()>,
        frames: Arc<Mutex<Vec<WindowsDesktopControllerFrame>>>,
    }

    struct DualSenseDevice {
        input: HidDevice,
        bluetooth: bool,
        frame: WindowsDesktopControllerFrame,
    }

    static DUALSENSE_WORKER: Mutex<Option<DualSenseWorker>> = Mutex::new(None);

    fn only_dualsense(info: &&DeviceInfo) -> bool {
        info.vendor_id() == 0x054c
            && matches!(info.product_id(), 0x0ce6 | 0x0df2)
            && info.usage_page() == 1
            && info.usage() == 5
    }

    fn dualsense_device(info: &DeviceInfo) -> WindowsDesktopControllerDevice {
        // Prefer the controller serial over the transport-specific HID path.
        let mut identity = blake3::Hasher::new();
        identity.update(&info.product_id().to_le_bytes());
        if let Some(serial) = info
            .serial_number()
            .filter(|serial| !serial.trim().is_empty())
        {
            identity.update(serial.as_bytes());
        } else {
            identity.update(info.path().to_bytes());
        }
        let hash = identity.finalize().to_hex();
        WindowsDesktopControllerDevice {
            id: format!("dualsense:{}", &hash[..32]),
            name: if info.product_id() == 0x0df2 {
                "DualSense Edge"
            } else {
                "DualSense"
            }
            .into(),
            layout: "dualsense".into(),
        }
    }

    fn xbox_frames() -> impl Iterator<Item = WindowsDesktopControllerFrame> {
        (0..4).filter_map(|index| {
            let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
            if unsafe { XInputGetState(index, &mut state) } != 0 {
                return None;
            }
            let pad = state.Gamepad;
            let to_axis = |value| f64::from(value) / 32768.0;
            let masks = [
                0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, 0, 0, 0x0020, 0x0010, 0x0040,
                0x0080, 0x0001, 0x0002, 0x0004, 0x0008,
            ];
            let mut buttons = masks
                .into_iter()
                .enumerate()
                .fold(0, |buttons, (index, mask)| {
                    buttons | (u32::from(pad.wButtons & mask != 0) << index)
                });
            buttons |= u32::from(pad.bLeftTrigger > 127) << 6;
            buttons |= u32::from(pad.bRightTrigger > 127) << 7;
            Some(WindowsDesktopControllerFrame {
                id: format!("xbox:{index}"),
                name: format!("Xbox / XInput {}", index + 1),
                layout: "xbox".into(),
                axes: vec![
                    to_axis(pad.sThumbLX),
                    -to_axis(pad.sThumbLY),
                    to_axis(pad.sThumbRX),
                    -to_axis(pad.sThumbRY),
                ],
                buttons,
            })
        })
    }

    pub fn list() -> Vec<WindowsDesktopControllerDevice> {
        let mut devices: Vec<_> = xbox_frames()
            .map(|frame| WindowsDesktopControllerDevice {
                id: frame.id,
                name: frame.name,
                layout: frame.layout,
            })
            .collect();
        if let Ok(api) = HidApi::new() {
            let mut seen = HashSet::new();
            devices.extend(
                api.device_list()
                    .filter(only_dualsense)
                    .map(dualsense_device)
                    .filter(|device| seen.insert(device.id.clone())),
            );
        }
        devices
    }

    fn read_dualsense(
        api: &mut HidApi,
        devices: &mut HashMap<String, DualSenseDevice>,
        refresh: bool,
    ) {
        if refresh && api.refresh_devices().is_ok() {
            let mut connected = HashSet::new();
            for info in api.device_list().filter(only_dualsense) {
                let identity = dualsense_device(info);
                if !connected.insert(identity.id.clone()) || devices.contains_key(&identity.id) {
                    continue;
                }
                if let Ok(input) = info.open_device(api) {
                    devices.insert(
                        identity.id.clone(),
                        DualSenseDevice {
                            input,
                            bluetooth: matches!(info.bus_type(), BusType::Bluetooth),
                            frame: WindowsDesktopControllerFrame {
                                id: identity.id,
                                name: identity.name,
                                layout: identity.layout,
                                axes: Vec::new(),
                                buttons: 0,
                            },
                        },
                    );
                }
            }
            devices.retain(|id, _| connected.contains(id));
        }

        devices.retain(|_, device| {
            let mut report = [0; 128];
            // Drain queued reports so old stick states cannot delay a button release.
            for _ in 0..32 {
                match device.input.read_timeout(&mut report, 0) {
                    Ok(0) => break,
                    Ok(length) => {
                        if let Some((axes, buttons)) =
                            parse_dualsense_report(&report[..length], device.bluetooth)
                        {
                            device.frame.axes.clear();
                            device.frame.axes.extend(axes);
                            device.frame.buttons = buttons;
                        }
                    }
                    Err(_) => return false,
                }
            }
            true
        });
    }

    fn start_worker() -> Option<DualSenseWorker> {
        let (stop, stopped) = mpsc::channel();
        let frames = Arc::new(Mutex::new(Vec::new()));
        let publish = Arc::clone(&frames);
        std::thread::Builder::new()
            .name("krysta-dualsense-desktop".into())
            .spawn(move || {
                let Ok(mut api) = HidApi::new() else {
                    return;
                };
                let mut devices = HashMap::new();
                let mut refresh_after = Instant::now();
                loop {
                    let now = Instant::now();
                    let refresh = now >= refresh_after;
                    if refresh {
                        refresh_after = now + Duration::from_secs(2);
                    }
                    read_dualsense(&mut api, &mut devices, refresh);
                    if let Ok(mut current) = publish.lock() {
                        current.clear();
                        current.extend(
                            devices
                                .values()
                                .map(|device| &device.frame)
                                .filter(|frame| !frame.axes.is_empty())
                                .cloned(),
                        );
                    }
                    let delay = if devices.is_empty() {
                        refresh_after.saturating_duration_since(Instant::now())
                    } else {
                        Duration::from_millis(16)
                    };
                    if !matches!(
                        stopped.recv_timeout(delay),
                        Err(mpsc::RecvTimeoutError::Timeout)
                    ) {
                        break;
                    }
                }
            })
            .ok()?;
        Some(DualSenseWorker { stop, frames })
    }

    pub fn poll() -> Vec<WindowsDesktopControllerFrame> {
        let mut frames: Vec<_> = xbox_frames().collect();
        if let Ok(mut worker) = DUALSENSE_WORKER.lock() {
            if worker.is_none() {
                *worker = start_worker();
            }
            if let Some(worker) = worker.as_ref() {
                if let Ok(sony) = worker.frames.lock() {
                    frames.extend(sony.iter().cloned());
                }
            }
        }
        frames
    }

    pub fn stop() {
        if let Ok(mut worker) = DUALSENSE_WORKER.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.stop.send(());
            }
        }
    }

    pub fn editable_focus() -> Option<String> {
        struct ComApartment;
        impl Drop for ComApartment {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
            let _apartment = ComApartment;
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let element = automation.GetFocusedElement().ok()?;
            if !element.CurrentHasKeyboardFocus().ok()?.as_bool()
                || !element.CurrentIsEnabled().ok()?.as_bool()
            {
                return None;
            }
            let role = element.CurrentControlType().ok()?;
            let editable = if let Ok(value) =
                element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            {
                !value.CurrentIsReadOnly().ok()?.as_bool()
            } else {
                role == UIA_EditControlTypeId
                    || (role == UIA_DocumentControlTypeId
                        && element
                            .GetCurrentPatternAs::<IUIAutomationTextEditPattern>(
                                UIA_TextEditPatternId,
                            )
                            .is_ok())
            };
            if !editable {
                return None;
            }
            let bounds = element.CurrentBoundingRectangle().ok()?;
            Some(format!(
                "{}:{}:{}:{}",
                element.CurrentProcessId().ok()?,
                element.CurrentAutomationId().ok()?,
                bounds.left,
                bounds.top
            ))
        }
    }

    pub fn show_keyboard() -> bool {
        let class: Vec<u16> = "OSKMainClass\0".encode_utf16().collect();
        unsafe {
            let keyboard = FindWindowW(class.as_ptr(), std::ptr::null());
            if !keyboard.is_null() {
                if IsWindowVisible(keyboard) == 0 || IsIconic(keyboard) != 0 {
                    ShowWindow(keyboard, SW_SHOWNOACTIVATE);
                }
                return true;
            }
        }
        // Launch the built-in accessibility keyboard by its absolute system path.
        // It is clickable on desktop apps and does not need the touch-keyboard service.
        let mut directory = [0u16; 260];
        let length = unsafe {
            windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
                directory.as_mut_ptr(),
                directory.len() as u32,
            )
        } as usize;
        if length == 0 || length >= directory.len() {
            return false;
        }
        let executable: Vec<u16> = directory[..length]
            .iter()
            .copied()
            .chain("\\osk.exe\0".encode_utf16())
            .collect();
        unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                executable.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNOACTIVATE,
            ) as isize
                > 32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_dualsense_report;

    #[test]
    fn normalizes_dualsense_usb_and_bluetooth_face_buttons_and_dpad() {
        let mut usb = [0; 64];
        usb[0] = 1;
        usb[1..5].copy_from_slice(&[0, 127, 255, 128]);
        usb[8] = 0x21; // Cross + diagonally up/right
        usb[9] = 0x12; // R1 + Create
        usb[10] = 0x06; // Touchpad + mute
        let mut bluetooth = [0; 78];
        bluetooth[0] = 0x31;
        bluetooth[2..12].copy_from_slice(&usb[1..11]);
        let (axes, buttons) = parse_dualsense_report(&usb, false).unwrap();
        assert_eq!(
            parse_dualsense_report(&bluetooth, true),
            Some((axes, buttons))
        );
        assert_eq!((axes[0], axes[2]), (-1.0, 1.0));
        assert_eq!(
            buttons,
            (1 << 0) | (1 << 5) | (1 << 8) | (1 << 12) | (1 << 15) | (1 << 17) | (1 << 18)
        );
    }

    #[test]
    fn accepts_simple_bluetooth_reports_and_rejects_invalid_headers() {
        let report = [1, 128, 128, 128, 128, 8, 0, 0, 0, 255];
        assert_eq!(parse_dualsense_report(&report, true).unwrap().1, 1 << 7);
        let mut padded = [0; 78];
        padded[..10].copy_from_slice(&report);
        assert_eq!(
            parse_dualsense_report(&padded, true),
            parse_dualsense_report(&report, true)
        );
        assert!(parse_dualsense_report(&report[..9], true).is_none());
        assert!(parse_dualsense_report(&[0; 64], false).is_none());
    }
}
