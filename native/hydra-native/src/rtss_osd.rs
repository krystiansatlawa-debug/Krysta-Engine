#[cfg(windows)]
mod windows {
    use std::mem::{size_of, zeroed};
    use std::ptr::{copy_nonoverlapping, read_volatile, write_volatile};
    use std::sync::atomic::{AtomicU32, Ordering};
    use windows_sys::core::w;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Memory::{
        MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, VirtualQuery, FILE_MAP_READ,
        FILE_MAP_WRITE, MEMORY_BASIC_INFORMATION, MEMORY_MAPPED_VIEW_ADDRESS,
    };

    // RTSSSharedMemoryV2, SDK 2.14+. The server supplies the table layout.
    const SIGNATURE: u32 = u32::from_be_bytes(*b"RTSS");
    const OWNER: &[u8] = b"Krysta Engine FPS\0";
    const OWNER_OFFSET: usize = 256;
    const TEXT_OFFSET: usize = 512;
    const TEXT_SIZE: usize = 4096;
    const HEADER_SIZE: usize = 40;
    const FRAME_INDEX: usize = 8;
    const LOCK_INDEX: usize = 9;
    const APP_TIME_START: usize = 67;
    const APP_TIME_END: usize = 68;
    const APP_FRAME_COUNT: usize = 69;

    struct Mapping {
        handle: HANDLE,
        view: MEMORY_MAPPED_VIEW_ADDRESS,
    }

    impl Drop for Mapping {
        fn drop(&mut self) {
            unsafe {
                UnmapViewOfFile(self.view);
                CloseHandle(self.handle);
            }
        }
    }

    impl Mapping {
        fn open() -> Option<Self> {
            unsafe {
                let access = FILE_MAP_READ | FILE_MAP_WRITE;
                let handle = OpenFileMappingW(access, 0, w!("RTSSSharedMemoryV2"));
                if handle.is_null() {
                    return None;
                }
                let view = MapViewOfFile(handle, access, 0, 0, 0);
                if view.Value.is_null() {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self { handle, view })
            }
        }

        fn size(&self) -> Option<usize> {
            unsafe {
                let mut info: MEMORY_BASIC_INFORMATION = zeroed();
                let size = VirtualQuery(
                    self.view.Value,
                    &mut info,
                    size_of::<MEMORY_BASIC_INFORMATION>(),
                );
                (size != 0 && info.BaseAddress == self.view.Value).then_some(info.RegionSize)
            }
        }
    }

    struct WriteLock<'a>(&'a AtomicU32);

    impl Drop for WriteLock<'_> {
        fn drop(&mut self) {
            self.0.fetch_and(!1, Ordering::Release);
        }
    }

    struct Table {
        offset: usize,
        stride: usize,
        count: usize,
    }

    impl Table {
        unsafe fn read(
            header: *const u32,
            mapping_size: usize,
            field: usize,
            min_stride: usize,
        ) -> Option<Self> {
            let stride = read_volatile(header.add(field)) as usize;
            let offset = read_volatile(header.add(field + 1)) as usize;
            let count = read_volatile(header.add(field + 2)) as usize;
            let end = offset.checked_add(stride.checked_mul(count)?)?;
            (offset >= HEADER_SIZE && stride >= min_stride && end <= mapping_size).then_some(Self {
                offset,
                stride,
                count,
            })
        }

        unsafe fn entry(&self, base: *mut u8, index: usize) -> *mut u8 {
            base.add(self.offset + self.stride * index)
        }
    }

    fn view_data(mapping: &Mapping) -> Option<(*mut u32, usize)> {
        let size = mapping.size()?;
        if size < HEADER_SIZE {
            return None;
        }
        let header = mapping.view.Value.cast::<u32>();
        unsafe {
            let version = read_volatile(header.add(1));
            (read_volatile(header) == SIGNATURE && (0x0002_000e..=0x0002_ffff).contains(&version))
                .then_some((header, size))
        }
    }

    pub fn available() -> bool {
        Mapping::open().is_some_and(|mapping| view_data(&mapping).is_some())
    }

    // A zero PID releases this client's OSD slot.
    pub fn update(process_id: u32) -> bool {
        let Some(mapping) = Mapping::open() else {
            return false;
        };
        let Some((header, size)) = view_data(&mapping) else {
            return false;
        };
        let base = header.cast::<u8>();
        unsafe {
            let Some(osd) = Table::read(header, size, 5, TEXT_OFFSET + TEXT_SIZE) else {
                return false;
            };
            let text = if process_id != 0 {
                let Some(apps) =
                    Table::read(header, size, 2, (APP_FRAME_COUNT + 1) * size_of::<u32>())
                else {
                    return false;
                };
                let Some(fps) = (0..apps.count).find_map(|i| {
                    let entry = apps.entry(base, i).cast::<u32>();
                    if !entry.is_aligned() || read_volatile(entry) != process_id {
                        return None;
                    }
                    let start = read_volatile(entry.add(APP_TIME_START));
                    let end = read_volatile(entry.add(APP_TIME_END));
                    let frames = read_volatile(entry.add(APP_FRAME_COUNT));
                    let duration = end.wrapping_sub(start);
                    if start == 0
                        || !(1..=10_000).contains(&duration)
                        || frames == 0
                        || read_volatile(entry) != process_id
                        || read_volatile(entry.add(APP_TIME_START)) != start
                        || read_volatile(entry.add(APP_TIME_END)) != end
                    {
                        return None;
                    }
                    Some((u64::from(frames) * 1000 + u64::from(duration / 2)) / u64::from(duration))
                }) else {
                    return false;
                };
                Some(format!("FPS: {fps}\0"))
            } else {
                None
            };
            let busy = AtomicU32::from_ptr(header.add(LOCK_INDEX));
            let mut lock = None;
            for _ in 0..3 {
                if busy.fetch_or(1, Ordering::Acquire) & 1 == 0 {
                    lock = Some(WriteLock(busy));
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            let Some(_lock) = lock else { return false };
            let mut own_slot = None;
            let mut empty_slot = None;
            for i in 1..osd.count {
                let entry = osd.entry(base, i);
                let owner = entry.add(OWNER_OFFSET);
                if (0..OWNER.len()).all(|j| read_volatile(owner.add(j)) == OWNER[j]) {
                    own_slot = Some(entry);
                    break;
                }
                if read_volatile(owner) == 0 && empty_slot.is_none() {
                    empty_slot = Some(entry);
                }
            }

            if let Some(text) = text {
                let Some(entry) = own_slot.or(empty_slot) else {
                    return false;
                };
                copy_nonoverlapping(OWNER.as_ptr(), entry.add(OWNER_OFFSET), OWNER.len());
                copy_nonoverlapping(text.as_ptr(), entry.add(TEXT_OFFSET), text.len());
            } else if let Some(entry) = own_slot {
                write_volatile(entry, 0);
                write_volatile(entry.add(TEXT_OFFSET), 0);
                write_volatile(entry.add(OWNER_OFFSET), 0);
            } else {
                return true;
            }
            AtomicU32::from_ptr(header.add(FRAME_INDEX)).fetch_add(1, Ordering::Release);
        }
        true
    }
}

#[cfg(windows)]
pub use windows::{available, update};

#[cfg(not(windows))]
pub fn available() -> bool {
    false
}

#[cfg(not(windows))]
pub fn update(_process_id: u32) -> bool {
    false
}
