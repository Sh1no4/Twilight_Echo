use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const PORTABLE_LAUNCH_FLAG: &str = "--portable";
pub const PORTABLE_MARKER_FILE: &str = ".portable";
pub const PORTABLE_DATA_DIR: &str = "data";

pub const DATA_ROOT_CATEGORIES: [&str; 7] = [
    "config",
    "database",
    "plugins",
    "plugin-data",
    "cache",
    "logs",
    "backups",
];

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPolicy {
    pub mode: &'static str,
    pub portable_requested: bool,
    pub detection_source: &'static str,
    pub data_root: String,
    pub standard_root: String,
    pub categories: HashMap<&'static str, String>,
    pub writable: bool,
    pub writable_categories: HashMap<&'static str, bool>,
    pub fallback_reason: Option<&'static str>,
}

pub struct PathPolicyState(pub Mutex<Option<PathPolicy>>);

fn has_file(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

fn has_directory(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

fn ensure_directory(dir: &Path) -> bool {
    fs::create_dir_all(dir).is_ok()
}

fn probe_writable(dir: &Path) -> bool {
    if !ensure_directory(dir) {
        return false;
    }
    let probe = dir.join(format!(".twilight-write-probe-{}", std::process::id()));
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

fn build_categories(root: &Path) -> HashMap<&'static str, String> {
    let mut categories = HashMap::new();
    for category in DATA_ROOT_CATEGORIES {
        categories.insert(category, root.join(category).to_string_lossy().into_owned());
    }
    categories
}

fn probe_categories(categories: &HashMap<&'static str, String>) -> HashMap<&'static str, bool> {
    let mut writable_categories = HashMap::new();
    for (category, dir) in categories {
        writable_categories.insert(*category, probe_writable(Path::new(dir)));
    }
    writable_categories
}

fn detect_portable_request(exe_dir: Option<&Path>) -> (bool, &'static str) {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == PORTABLE_LAUNCH_FLAG) {
        return (true, "launch-arg");
    }
    if let Some(dir) = exe_dir {
        if has_file(&dir.join(PORTABLE_MARKER_FILE)) {
            return (true, "marker-file");
        }
        if has_directory(&dir.join(PORTABLE_DATA_DIR)) {
            return (true, "marker-directory");
        }
    }
    (false, "none")
}

fn standard_policy(
    standard_root: &Path,
    standard_categories: &HashMap<&'static str, String>,
    portable_requested: bool,
    detection_source: &'static str,
    fallback_reason: Option<&'static str>,
) -> PathPolicy {
    PathPolicy {
        mode: if fallback_reason.is_some() {
            "fallback"
        } else {
            "standard"
        },
        portable_requested,
        detection_source,
        data_root: standard_root.to_string_lossy().into_owned(),
        standard_root: standard_root.to_string_lossy().into_owned(),
        categories: standard_categories.clone(),
        writable: probe_writable(standard_root),
        writable_categories: probe_categories(standard_categories),
        fallback_reason,
    }
}

pub fn resolve_path_policy(app: &AppHandle) -> PathPolicy {
    let standard_root = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| Path::new(".").to_path_buf());
    let exe_dir = app.path().executable_dir().ok();
    let standard_categories = build_categories(&standard_root);

    let (portable, source) = detect_portable_request(exe_dir.as_deref());

    if !portable {
        return standard_policy(&standard_root, &standard_categories, false, "none", None);
    }

    let Some(exe_dir) = exe_dir else {
        return standard_policy(
            &standard_root,
            &standard_categories,
            true,
            source,
            Some("exe-dir-unresolvable"),
        );
    };

    let data_root = exe_dir.join(PORTABLE_DATA_DIR);
    let portable_categories = build_categories(&data_root);
    let root_writable = probe_writable(&data_root);
    let writable_categories = probe_categories(&portable_categories);
    let category_failed = writable_categories.values().any(|ok| !ok);

    if root_writable && !category_failed {
        return PathPolicy {
            mode: "portable",
            portable_requested: true,
            detection_source: source,
            data_root: data_root.to_string_lossy().into_owned(),
            standard_root: standard_root.to_string_lossy().into_owned(),
            categories: portable_categories,
            writable: true,
            writable_categories,
            fallback_reason: None,
        };
    }

    standard_policy(
        &standard_root,
        &standard_categories,
        true,
        source,
        Some(if root_writable {
            "category-not-writable"
        } else {
            "data-dir-not-writable"
        }),
    )
}

pub fn get_path_policy(app: &AppHandle) -> PathPolicy {
    let state = app.state::<PathPolicyState>();
    let mut guard = state.inner().0.lock().expect("path policy state lock");
    if guard.is_none() {
        *guard = Some(resolve_path_policy(app));
    }
    guard.clone().expect("resolved path policy")
}

pub fn categorized_data_path(policy: &PathPolicy, category: &str, segments: &[&str]) -> PathBuf {
    let root = if policy.mode == "portable" {
        policy
            .categories
            .get(category)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&policy.standard_root))
    } else {
        PathBuf::from(&policy.standard_root)
    };
    let mut path = root;
    for segment in segments {
        path.push(segment);
    }
    path
}

pub fn categorized_app_path(
    policy: &PathPolicy,
    category: &str,
    portable_segments: &[&str],
    legacy_relative: &str,
) -> PathBuf {
    if policy.mode == "portable" {
        let base = policy
            .categories
            .get(category)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&policy.data_root));
        let mut path = base;
        for segment in portable_segments {
            path.push(segment);
        }
        path
    } else {
        let mut path = PathBuf::from(&policy.standard_root);
        for segment in legacy_relative.split(['/', '\\']) {
            if !segment.is_empty() {
                path.push(segment);
            }
        }
        path
    }
}

