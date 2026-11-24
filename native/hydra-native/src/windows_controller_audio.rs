use std::ffi::c_void;

use napi_derive::napi;
use windows::core::{IUnknown_Vtbl, Interface, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{PROPERTYKEY, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, DigitalAudioDisplayDevice, ERole, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, PKEY_AudioEndpoint_FormFactor, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PropVariantToStringAlloc, PropVariantToUInt32,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};

const ROLES: [ERole; 3] = [eConsole, eMultimedia, eCommunications];
const FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

// Core Audio enumerates and reads default devices. PolicyConfig is the Windows
// implementation used to change the default endpoint for a render role.
windows::core::imp::define_interface!(
    PolicyConfig,
    PolicyConfigVtable,
    0xf8679f50_850a_41cf_9c72_430f290290c8
);
#[repr(C)]
pub struct PolicyConfigVtable {
    base: IUnknown_Vtbl,
    preceding_methods: [usize; 10],
    set_default_endpoint: unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT,
}

struct ComApartment(bool);

impl ComApartment {
    fn initialize() -> Option<Self> {
        let status = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if status.is_ok() {
            Some(Self(true))
        } else if status == RPC_E_CHANGED_MODE {
            Some(Self(false))
        } else {
            None
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn use_enumerator<T>(callback: impl FnOnce(&IMMDeviceEnumerator) -> Option<T>) -> Option<T> {
    let _apartment = ComApartment::initialize()?;
    let enumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER) }.ok()?;
    callback(&enumerator)
}

fn endpoint_id(device: &IMMDevice) -> Option<String> {
    let id = unsafe { device.GetId() }.ok()?;
    let value = unsafe { id.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(id.as_ptr().cast())) };
    value
}

fn default_ids(enumerator: &IMMDeviceEnumerator) -> Vec<String> {
    ROLES
        .iter()
        .map(|role| {
            unsafe { enumerator.GetDefaultAudioEndpoint(eRender, *role) }
                .ok()
                .as_ref()
                .and_then(endpoint_id)
                .unwrap_or_default()
        })
        .collect()
}

fn digital_display_endpoint(device: &IMMDevice) -> Option<(String, String)> {
    let store = unsafe { device.OpenPropertyStore(STGM_READ).ok()? };
    let mut factor = unsafe { store.GetValue(&PKEY_AudioEndpoint_FormFactor).ok()? };
    let form = unsafe { PropVariantToUInt32(&factor) };
    let _ = unsafe { PropVariantClear(&mut factor) };
    if form.ok()? != DigitalAudioDisplayDevice.0 as u32 {
        return None;
    }

    let mut name_property = unsafe { store.GetValue(&FRIENDLY_NAME).ok()? };
    let name = unsafe { PropVariantToStringAlloc(&name_property) };
    let _ = unsafe { PropVariantClear(&mut name_property) };
    let name = name.ok()?;
    let value = unsafe { name.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(name.as_ptr().cast())) };
    Some((endpoint_id(device)?, value?))
}

fn set_default(policy: &PolicyConfig, id: &str, role: ERole) -> bool {
    let wide: Vec<u16> = id.encode_utf16().chain([0]).collect();
    unsafe {
        (policy.vtable().set_default_endpoint)(policy.as_raw(), PCWSTR(wide.as_ptr()), role).is_ok()
    }
}

#[napi]
pub fn get_windows_controller_audio_defaults() -> Vec<String> {
    use_enumerator(|enumerator| Some(default_ids(enumerator))).unwrap_or_default()
}

#[napi]
pub fn switch_windows_controller_hdmi_audio(label: String, single_display: bool) -> bool {
    use_enumerator(|enumerator| {
        let endpoints =
            unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }.ok()?;
        let count = unsafe { endpoints.GetCount() }.ok()?;
        let candidates: Vec<_> = (0..count)
            .filter_map(|index| unsafe { endpoints.Item(index).ok() })
            .filter_map(|device| digital_display_endpoint(&device))
            .collect();
        let normalized_label = label.trim().to_lowercase();
        let named: Vec<_> = candidates
            .iter()
            .filter(|(_, name)| {
                let name = name.trim().to_lowercase();
                !normalized_label.is_empty()
                    && (name == normalized_label
                        || name
                            .strip_prefix(&normalized_label)
                            .is_some_and(|suffix| suffix.starts_with(" (")))
            })
            .collect();
        let (id, _) = match (named.as_slice(), candidates.as_slice()) {
            ([target], _) => *target,
            ([], [target]) if single_display => target,
            _ => return Some(false),
        };
        let policy =
            unsafe { CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_INPROC_SERVER) }.ok()?;
        let previous = default_ids(enumerator);
        for (index, role) in ROLES.iter().enumerate() {
            if !set_default(&policy, id, *role) {
                for (restored, original) in ROLES[..index].iter().zip(&previous) {
                    if !original.is_empty() {
                        set_default(&policy, original, *restored);
                    }
                }
                return Some(false);
            }
        }
        Some(true)
    })
    .unwrap_or(false)
}

#[napi]
pub fn restore_windows_controller_audio_defaults(devices: Vec<String>) -> bool {
    if devices.len() != ROLES.len() {
        return false;
    }

    use_enumerator(|enumerator| {
        let policy =
            unsafe { CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_INPROC_SERVER) }.ok()?;
        let mut restored = true;
        for (role, id) in ROLES.into_iter().zip(&devices) {
            if id.is_empty() || id.contains('\0') {
                continue;
            }
            let wide: Vec<u16> = id.encode_utf16().chain([0]).collect();
            let active = unsafe {
                enumerator
                    .GetDevice(PCWSTR(wide.as_ptr()))
                    .and_then(|device| device.GetState())
            }
            .is_ok_and(|state| state == DEVICE_STATE_ACTIVE);
            restored &= active && set_default(&policy, id, role);
        }
        Some(restored)
    })
    .unwrap_or(false)
}
