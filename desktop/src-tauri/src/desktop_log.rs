use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 256 * 1024;
const LAST_LOG_INDEX: usize = 2;

#[derive(Clone, Copy)]
pub enum DesktopEvent {
    Started,
    WindowShown,
    WindowHidden,
    ExitRequested,
    ExternalNavigation,
    WaitingForServer,
    ServerReached,
    LogsOpened,
}

impl DesktopEvent {
    fn message(self) -> &'static str {
        match self {
            Self::Started => "desktop started",
            Self::WindowShown => "window shown",
            Self::WindowHidden => "window hidden",
            Self::ExitRequested => "exit requested",
            Self::ExternalNavigation => "external navigation opened",
            Self::WaitingForServer => "waiting for server",
            Self::ServerReached => "server reached",
            Self::LogsOpened => "log directory opened",
        }
    }
}

pub struct DesktopLog {
    directory: PathBuf,
    writer: Mutex<Option<File>>,
}

impl DesktopLog {
    pub fn new(directory: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let writer = open_current(&directory)?;
        Ok(Self {
            directory,
            writer: Mutex::new(Some(writer)),
        })
    }

    pub fn event(&self, event: DesktopEvent) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let line = format!("{timestamp} {}\n", event.message());
        let Ok(mut writer) = self.writer.lock() else {
            return;
        };
        let should_rotate = writer
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .is_some_and(|metadata| metadata.len() + line.len() as u64 > MAX_LOG_BYTES);
        if should_rotate {
            *writer = None;
            if rotate(&self.directory).is_err() {
                return;
            }
            *writer = open_current(&self.directory).ok();
        }
        if let Some(writer) = writer.as_mut() {
            let _ = writer.write_all(line.as_bytes());
            let _ = writer.flush();
        }
    }
}

fn log_path(directory: &Path, index: usize) -> PathBuf {
    if index == 0 {
        directory.join("voice-chat.log")
    } else {
        directory.join(format!("voice-chat.{index}.log"))
    }
}

fn open_current(directory: &Path) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path(directory, 0))
}

fn rotate(directory: &Path) -> io::Result<()> {
    let oldest = log_path(directory, LAST_LOG_INDEX);
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (0..LAST_LOG_INDEX).rev() {
        let source = log_path(directory, index);
        if source.exists() {
            fs::rename(source, log_path(directory, index + 1))?;
        }
    }
    Ok(())
}
