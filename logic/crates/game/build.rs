use std::fs;
use std::path::Path;

use calimero_wasm_abi::emitter::emit_manifest_from_crate;

fn main() {
    let src_dir = Path::new("src");

    let module_files = [
        "lib.rs",
        "events.rs",
        "audit.rs",
        "players.rs",
        "board.rs",
        "ships.rs",
        "validation.rs",
    ];

    for name in &module_files {
        println!("cargo:rerun-if-changed=src/{}", name);
    }

    let sources: Vec<(String, String)> = module_files
        .iter()
        .map(|name| {
            let path = src_dir.join(name);
            let content = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
            (name.to_string(), content)
        })
        .collect();

    let manifest = emit_manifest_from_crate(&sources).expect("Failed to emit ABI manifest");

    let json = serde_json::to_string_pretty(&manifest).expect("Failed to serialize manifest");

    let res_dir = Path::new("res");
    if !res_dir.exists() {
        fs::create_dir_all(res_dir).expect("Failed to create res directory");
    }

    let abi_path = res_dir.join("abi.json");
    fs::write(&abi_path, json).expect("Failed to write ABI JSON");

    println!("cargo:rerun-if-changed={}", abi_path.display());
}
