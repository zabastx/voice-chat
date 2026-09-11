pub fn is_loopback(url: &url::Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    )
}

pub fn valid_origin(url: &url::Url, allow_loopback_http: bool) -> bool {
    let valid_scheme = url.scheme() == "https"
        || (allow_loopback_http && url.scheme() == "http" && is_loopback(url));

    valid_scheme
        && !url.cannot_be_a_base()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
mod tests {
    use super::valid_origin;

    fn url(value: &str) -> url::Url {
        url::Url::parse(value).expect("valid test URL")
    }

    #[test]
    fn release_accepts_only_a_root_https_origin() {
        assert!(valid_origin(&url("https://chat.example.com"), false));
        assert!(!valid_origin(&url("http://chat.example.com"), false));
        assert!(!valid_origin(&url("https://chat.example.com/path"), false));
        assert!(!valid_origin(
            &url("https://member:secret@chat.example.com"),
            false
        ));
    }

    #[test]
    fn debug_additionally_accepts_loopback_http() {
        assert!(valid_origin(&url("http://localhost:3000"), true));
        assert!(valid_origin(&url("http://127.0.0.1:3000"), true));
        assert!(valid_origin(&url("http://[::1]:3000"), true));
        assert!(!valid_origin(&url("http://chat.example.com"), true));
    }
}
