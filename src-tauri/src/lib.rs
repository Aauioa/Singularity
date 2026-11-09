// 敏感值（目前只有 API Key）的安全存储。
//
// 为什么需要它：前端把 API Key 明文放在 localStorage 里，任何能读到用户 profile 目录
// 的程序（备份、同步盘、恶意软件、误发的存档文件）都能直接拿走它。
//
// 方案：Windows DPAPI（CryptProtectData）以「当前用户」为密钥派生加密，
// 密文落盘到应用数据目录。密文只有同一台机器上的同一个用户能解开，
// 换机器或换用户都解不开，因此也天然适合被备份/同步而不泄露。
//
// 边界要说清楚：DPAPI 保护的是「静态数据」（被别的程序或文件副本拿走时）。
// 它挡不住已经在本应用 WebView 里跑起来的脚本 —— 那种情况下密钥本来就在内存里。
//
// 刻意不引入 keyring / stronghold 等第三方 crate：只用依赖树里已有的 windows-sys，
// 保持可离线构建，也不往受信任依赖表里加新面孔。

use std::path::PathBuf;

use tauri::Manager;

/// 名称会拼进文件名，必须严格限制，杜绝路径穿越（`../`、盘符、NUL 等）
fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("名称长度必须在 1~64 之间".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("名称只能包含字母、数字、下划线与连字符".into());
    }
    Ok(())
}

fn secret_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?
        .join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建密钥目录失败: {e}"))?;
    Ok(dir)
}

fn secret_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    check_name(name)?;
    Ok(secret_dir(app)?.join(format!("{name}.bin")))
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        // 空值等价于删除，免得留下一个解不开的空壳文件
        let path = secret_file(&app, &name)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))?;
        }
        return Ok(());
    }
    let path = secret_file(&app, &name)?;
    let blob = protect::seal(value.as_bytes())?;
    std::fs::write(&path, blob).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = secret_file(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    let blob = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    // 解不开说明密文来自另一台机器/另一个用户，或已被篡改 ——
    // 交给调用方当作「没有密钥」处理，而不是把应用卡死
    let plain = protect::open(&blob)?;
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "解密结果不是合法 UTF-8，密钥可能已损坏".into())
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = secret_file(&app, &name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
mod protect {
    use windows_sys::Win32::Foundation::{LocalFree, BOOL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    fn in_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    /// 把 DPAPI 分配的输出缓冲拷成 Vec 并释放。成功路径必须释放，否则每次读写都漏一块内存。
    unsafe fn take_out(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as *mut core::ffi::c_void);
        v
    }

    pub fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = in_blob(plain);
            let mut out = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok: BOOL = CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            );
            if ok == 0 {
                return Err("DPAPI 加密失败".into());
            }
            Ok(take_out(out))
        }
    }

    pub fn open(blob: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = in_blob(blob);
            let mut out = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok: BOOL = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            );
            if ok == 0 {
                return Err("DPAPI 解密失败（密文可能来自另一台机器或另一个用户）".into());
            }
            Ok(take_out(out))
        }
    }
}

#[cfg(not(windows))]
mod protect {
    // 本项目只发布 Windows 安装包；留个明确失败的桩，保证其它平台仍能编译
    pub fn seal(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("当前平台没有实现安全存储（仅 Windows 提供 DPAPI）".into())
    }
    pub fn open(_blob: &[u8]) -> Result<Vec<u8>, String> {
        Err("当前平台没有实现安全存储（仅 Windows 提供 DPAPI）".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{check_name, protect};

    // 这是唯一真正跑到 Windows DPAPI 的验证：FFI 的指针/长度/释放很容易写错，
    // 而前端测试用的是假桥，碰不到这里。
    #[test]
    fn dpapi_round_trip() {
        let plain = "sk-test-中文-123".as_bytes();
        let blob = protect::seal(plain).expect("DPAPI 加密失败");
        assert_ne!(blob.as_slice(), plain, "密文不应等于明文");
        assert!(!blob.is_empty(), "密文不应为空");
        let back = protect::open(&blob).expect("DPAPI 解密失败");
        assert_eq!(back, plain, "解出来的内容必须与原文一致");
    }

    #[test]
    fn dpapi_round_trip_is_not_identity() {
        // 同一明文两次加密应得到不同密文（DPAPI 每次都会重新生成盐），
        // 顺带证明我们没有把明文直接落盘。
        let plain = b"sk-same-input";
        let a = protect::seal(plain).expect("seal a");
        let b = protect::seal(plain).expect("seal b");
        assert_ne!(a, b);
        assert_eq!(protect::open(&a).unwrap(), plain);
        assert_eq!(protect::open(&b).unwrap(), plain);
    }

    #[test]
    fn dpapi_rejects_garbage() {
        assert!(protect::open(&[1, 2, 3, 4, 5]).is_err(), "随机字节不应被解成明文");
    }

    #[test]
    fn name_validation_blocks_traversal() {
        // 名称会拼进文件名，必须挡住路径穿越
        for bad in ["../evil", "a/b", "a\\b", "", "..", "a b", "名字"] {
            assert!(check_name(bad).is_err(), "应拒绝名称: {bad:?}");
        }
        for ok in ["api_key", "key-1", "ABC123"] {
            assert!(check_name(ok).is_ok(), "应接受名称: {ok:?}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 前端（src/index.html）除了「安全存储」这三个命令之外不调用任何 Tauri API ——
    // 既没有 window.__TAURI__（withGlobalTauri 关闭），也没用到任何插件。
    // 这里只注册密钥存储相关的自定义命令，其余原生能力一概不开。
    // 自定义命令不受 capabilities 的 ACL 管辖，所以 default.json 仍只需 core:default。
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
