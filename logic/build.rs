use std::fs;
use std::path::{Path, PathBuf};

use calimero_wasm_abi::emitter::emit_manifest_from_crate;

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");

    // Scan all Rust source files in src/
    let src_dir = Path::new("src");
    let mut source_files = Vec::new();
    
    if let Ok(entries) = fs::read_dir(src_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("rs") {
                source_files.push(path.clone());
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    // Parse lib.rs (required)
    let lib_path = Path::new("src/lib.rs");
    let lib_content = fs::read_to_string(lib_path).expect("Failed to read src/lib.rs");
    
    // Parse all module files
    let mut module_contents = vec![("lib.rs".to_string(), lib_content)];
    
    for source_file in source_files {
        if source_file.file_name() != Some(std::ffi::OsStr::new("lib.rs")) {
            if let Ok(content) = fs::read_to_string(&source_file) {
                let file_name = source_file
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                module_contents.push((file_name, content));
            }
        }
    }

    // Generate ABI manifest from all source files
    let manifest = emit_manifest_from_crate(&module_contents)
        .expect("Failed to emit ABI manifest");

    // Serialize the manifest to JSON
    let json = serde_json::to_string_pretty(&manifest).expect("Failed to serialize manifest");

    // Write the ABI JSON to the res directory
    let res_dir = Path::new("res");
    if !res_dir.exists() {
        fs::create_dir_all(res_dir).expect("Failed to create res directory");
    }

    let abi_path = res_dir.join("abi.json");
    fs::write(&abi_path, json).expect("Failed to write ABI JSON");

    println!("cargo:rerun-if-changed={}", abi_path.display());
}
