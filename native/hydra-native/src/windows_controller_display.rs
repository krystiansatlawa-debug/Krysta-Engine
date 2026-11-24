use std::collections::{HashMap, HashSet};
use std::mem::size_of;
use std::ptr::{null, null_mut};
use std::sync::Mutex;

use napi_derive::napi;
use windows_sys::Win32::Devices::Display::*;
use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
use windows_sys::Win32::Graphics::Gdi::{
    DISPLAYCONFIG_PATH_ACTIVE, DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID,
    DISPLAYCONFIG_PATH_MODE_IDX_INVALID, DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE,
};

struct Configuration {
    paths: Vec<DISPLAYCONFIG_PATH_INFO>,
    modes: Vec<DISPLAYCONFIG_MODE_INFO>,
    virtual_mode_aware: bool,
}

static PREVIOUS_CONFIGURATION: Mutex<Option<Configuration>> = Mutex::new(None);

#[napi(object)]
pub struct WindowsControllerDisplay {
    pub id: String,
    pub label: String,
    pub active: bool,
    pub hdmi: bool,
    pub internal: bool,
}

fn query(flags: u32) -> Option<Configuration> {
    // Hotplug can invalidate the array sizes between the two calls.
    for _ in 0..3 {
        let (mut path_count, mut mode_count) = (0, 0);
        let status =
            unsafe { GetDisplayConfigBufferSizes(flags, &mut path_count, &mut mode_count) };
        if status != ERROR_SUCCESS {
            return None;
        }

        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        let status = unsafe {
            QueryDisplayConfig(
                flags,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                null_mut(),
            )
        };
        if status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if status != ERROR_SUCCESS {
            return None;
        }
        paths.truncate(path_count as usize);
        modes.truncate(mode_count as usize);
        return Some(Configuration {
            paths,
            modes,
            virtual_mode_aware: flags & QDC_VIRTUAL_MODE_AWARE != 0,
        });
    }
    None
}

fn active_configuration() -> Option<Configuration> {
    query(QDC_ONLY_ACTIVE_PATHS | QDC_VIRTUAL_MODE_AWARE).or_else(|| query(QDC_ONLY_ACTIVE_PATHS))
}

fn text(buffer: &[u16]) -> String {
    String::from_utf16_lossy(
        &buffer[..buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(buffer.len())],
    )
}

fn target_key(path: &DISPLAYCONFIG_PATH_INFO) -> (i32, u32, u32) {
    let target = path.targetInfo;
    (
        target.adapterId.HighPart,
        target.adapterId.LowPart,
        target.id,
    )
}

fn describe(path: &DISPLAYCONFIG_PATH_INFO) -> Option<WindowsControllerDisplay> {
    let target = path.targetInfo;
    let mut name = DISPLAYCONFIG_TARGET_DEVICE_NAME {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
            size: size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
            adapterId: target.adapterId,
            id: target.id,
        },
        ..Default::default()
    };
    let request = (&mut name as *mut DISPLAYCONFIG_TARGET_DEVICE_NAME).cast();
    if unsafe { DisplayConfigGetDeviceInfo(request) } != ERROR_SUCCESS as i32 {
        return None;
    }
    let device_path = text(&name.monitorDevicePath);
    if device_path.is_empty() {
        return None;
    }
    let mut label = text(&name.monitorFriendlyDeviceName);
    if label.is_empty() {
        label = device_path
            .split('#')
            .nth(1)
            .unwrap_or(&device_path)
            .to_owned();
    }
    let technology = name.outputTechnology;
    Some(WindowsControllerDisplay {
        id: device_path.to_lowercase(),
        label,
        active: path.flags & DISPLAYCONFIG_PATH_ACTIVE != 0,
        hdmi: technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI,
        internal: matches!(
            technology,
            DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL
                | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS
                | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
                | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED
        ),
    })
}

#[napi]
pub fn get_windows_controller_displays() -> Vec<WindowsControllerDisplay> {
    let Some(config) = query(QDC_ALL_PATHS) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut displays: HashMap<String, WindowsControllerDisplay> = HashMap::new();
    // QueryDisplayConfig lists active paths first, then alternate inactive paths.
    for path in config
        .paths
        .iter()
        .filter(|path| path.targetInfo.targetAvailable != 0)
    {
        if !seen.insert(target_key(path)) {
            continue;
        }
        if let Some(display) = describe(path) {
            displays
                .entry(display.id.clone())
                .and_modify(|previous| previous.active |= display.active)
                .or_insert(display);
        }
    }
    let mut displays: Vec<_> = displays.into_values().collect();
    displays.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
    displays
}

#[napi]
pub fn get_windows_controller_display_mode() -> Option<String> {
    let config = active_configuration()?;
    let first = config.paths.first()?;
    let clone_group = |path: &DISPLAYCONFIG_PATH_INFO| {
        if !config.virtual_mode_aware || path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE == 0 {
            return None;
        }
        let group = unsafe { path.sourceInfo.Anonymous.Anonymous._bitfield } & 0xffff;
        (group != DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID).then_some(group)
    };
    let first_clone_group = clone_group(first);
    let mode = if config.paths.len() == 1 {
        "display"
    } else if config.paths.iter().all(|path| {
        let source = path.sourceInfo;
        (first_clone_group.is_some() && first_clone_group == clone_group(path))
            || (source.id == first.sourceInfo.id
                && source.adapterId.HighPart == first.sourceInfo.adapterId.HighPart
                && source.adapterId.LowPart == first.sourceInfo.adapterId.LowPart)
    }) {
        "duplicate"
    } else {
        "extend"
    };
    Some(mode.to_owned())
}

fn apply_topology(topology: u32) -> bool {
    unsafe { SetDisplayConfig(0, null(), 0, null(), SDC_APPLY | topology) == ERROR_SUCCESS as i32 }
}

fn apply_single_display(id: &str, temporary: bool) -> bool {
    let Some(config) = query(QDC_ALL_PATHS) else {
        return false;
    };
    let active_count = config
        .paths
        .iter()
        .filter(|path| path.flags & DISPLAYCONFIG_PATH_ACTIVE != 0)
        .count();
    let mut target_ids = HashMap::new();
    for mut path in config
        .paths
        .into_iter()
        .filter(|path| path.targetInfo.targetAvailable != 0)
    {
        let candidate_id = target_ids
            .entry(target_key(&path))
            .or_insert_with(|| describe(&path).map(|display| display.id));
        if candidate_id.as_deref() != Some(id) {
            continue;
        }
        let active = path.flags & DISPLAYCONFIG_PATH_ACTIVE != 0;
        if active && active_count == 1 {
            return true;
        }
        path.flags = DISPLAYCONFIG_PATH_ACTIVE;
        path.sourceInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
        path.targetInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
        path.targetInfo.refreshRate = DISPLAYCONFIG_RATIONAL::default();
        path.targetInfo.scanLineOrdering = DISPLAYCONFIG_SCANLINE_ORDERING_UNSPECIFIED;
        if !active {
            path.targetInfo.rotation = DISPLAYCONFIG_ROTATION_IDENTITY;
            path.targetInfo.scaling = DISPLAYCONFIG_SCALING_PREFERRED;
        }
        let mut flags = SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES;
        if !temporary {
            flags |= SDC_SAVE_TO_DATABASE;
        }
        if unsafe { SetDisplayConfig(1, &path, 0, null(), flags) } == ERROR_SUCCESS as i32 {
            return true;
        }
    }
    false
}

#[napi]
pub fn switch_windows_controller_display(mode: String, id: String, temporary: bool) -> bool {
    let Ok(mut previous) = PREVIOUS_CONFIGURATION.lock() else {
        return false;
    };
    let snapshot = if temporary && previous.is_none() {
        let Some(config) = active_configuration().filter(|config| !config.paths.is_empty()) else {
            return false;
        };
        Some(config)
    } else {
        None
    };
    let changed = match mode.as_str() {
        "display" if !id.is_empty() => apply_single_display(&id, temporary),
        "duplicate" if !temporary => apply_topology(SDC_TOPOLOGY_CLONE),
        "extend" if !temporary => apply_topology(SDC_TOPOLOGY_EXTEND),
        _ => false,
    };

    if changed {
        if !temporary {
            *previous = None;
        } else if snapshot.is_some() {
            *previous = snapshot;
        }
    }
    changed
}

#[napi]
pub fn restore_windows_controller_display() -> bool {
    let Ok(mut previous) = PREVIOUS_CONFIGURATION.lock() else {
        return false;
    };
    let Some(config) = previous.as_ref() else {
        return true;
    };
    let virtual_modes = if config.virtual_mode_aware {
        SDC_VIRTUAL_MODE_AWARE
    } else {
        0
    };
    let apply = |flags| unsafe {
        SetDisplayConfig(
            config.paths.len() as u32,
            config.paths.as_ptr(),
            config.modes.len() as u32,
            config.modes.as_ptr(),
            SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | virtual_modes | flags,
        ) == ERROR_SUCCESS as i32
    };
    if apply(0) || apply(SDC_ALLOW_CHANGES) || apply_topology(SDC_USE_DATABASE_CURRENT) {
        *previous = None;
        return true;
    }

    // A saved extended topology can refer to a TV that has been unplugged.
    // Retain any desktop Windows has already recovered or enable a connected
    // monitor without replacing the saved topology.
    let available = get_windows_controller_displays();
    let restored = available.iter().any(|display| display.active)
        || available
            .iter()
            .find(|display| display.internal)
            .or_else(|| available.first())
            .is_some_and(|display| apply_single_display(&display.id, true));
    if restored {
        *previous = None;
    }
    restored
}
