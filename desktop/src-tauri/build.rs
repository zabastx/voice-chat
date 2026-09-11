mod origin;

fn main() {
    println!("cargo:rerun-if-env-changed=VOICECHAT_DESKTOP_PRODUCTION_ORIGIN");
    println!("cargo:rerun-if-env-changed=VOICECHAT_DESKTOP_MODE");
    println!("cargo:rerun-if-env-changed=VOICECHAT_DESKTOP_UPDATE_CHECK");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let origin = std::env::var("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN")
            .expect("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be set for a release build");
        let origin = url::Url::parse(&origin)
            .expect("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be a valid URL");
        let update_check = std::env::var("VOICECHAT_DESKTOP_UPDATE_CHECK").as_deref() == Ok("1");
        assert!(
            origin::valid_origin(&origin, update_check),
            "VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be a root HTTPS origin without credentials"
        );
        assert!(
            matches!(
                std::env::var("VOICECHAT_DESKTOP_MODE").as_deref(),
                Ok("installed" | "portable")
            ),
            "VOICECHAT_DESKTOP_MODE must be installed or portable for a release build"
        );
    }
    tauri_build::build()
}
