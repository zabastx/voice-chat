fn main() {
    println!("cargo:rerun-if-env-changed=VOICECHAT_DESKTOP_PRODUCTION_ORIGIN");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let origin = std::env::var("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN")
            .expect("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be set for a release build");
        assert!(
            origin.starts_with("https://"),
            "VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must use HTTPS"
        );
    }
    tauri_build::build()
}
