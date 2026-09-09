mod origin;

fn main() {
    println!("cargo:rerun-if-env-changed=VOICECHAT_DESKTOP_PRODUCTION_ORIGIN");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let origin = std::env::var("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN")
            .expect("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be set for a release build");
        let origin = url::Url::parse(&origin)
            .expect("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be a valid URL");
        assert!(
            origin::valid_origin(&origin, false),
            "VOICECHAT_DESKTOP_PRODUCTION_ORIGIN must be a root HTTPS origin without credentials"
        );
    }
    tauri_build::build()
}
