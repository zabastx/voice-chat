# Windows-клиент Voice Chat

Tauri 2 shell открывает серверную Web Release в WebView2. Nuxt, Postgres и LiveKit остаются на
сервере, а профиль WebView2 сохраняет Sign-in между запусками. Desktop Client имеет отдельную
версию `0.1.0-alpha.1`, binary `voice-chat.exe` и постоянный identifier
`ru.zabastx.voicechat`.

Release-сборка принимает только один HTTPS origin, встроенный во время компиляции. Переменная
`VOICECHAT_DESKTOP_URL` не меняет release EXE. Debug-сборка допускает HTTPS или loopback HTTP.
Страница другого origin и любое новое окно открываются в системном браузере. Удалённая страница
не получает Tauri capabilities или общий `invoke`.

Если сервер недоступен при запуске, shell показывает локальный русский экран. «Повторить» запускает
проверку сразу, а фоновая проверка повторяется каждые 30 секунд. «Выйти» завершает процесс. Локальной
копии каналов и сообщений нет.

## Сборка и запуск

Нужны Windows, [Rust MSVC, C++ Build Tools и WebView2](https://v2.tauri.app/start/prerequisites/).
Команды выполняются из корня репозитория:

```powershell
bun install
$env:VOICECHAT_DESKTOP_PRODUCTION_ORIGIN = 'https://chat.example.com'
bun run desktop:build
bun run desktop:run
```

Вместо `VOICECHAT_DESKTOP_PRODUCTION_ORIGIN` можно задать `DOMAIN=chat.example.com`. Результат:
`desktop/src-tauri/target/release/voice-chat.exe`. `desktop:build` пока собирает no-install EXE;
installer и updater относятся к следующим desktop tickets.

Для разработки против Nuxt на localhost:

```powershell
$env:VOICECHAT_DESKTOP_URL = 'http://localhost:3000'
bun run desktop:dev
```

`desktop:dev` не запускает Nuxt автоматически. Runner использует системный Rust или локальную
установку в `.data/tooling/{cargo,rustup}`.

## Поведение shell

- Крестик скрывает окно и сохраняет страницу и звонок.
- Левый клик по tray icon показывает окно.
- Tray menu содержит «Открыть чат», «Свернуть в трей», «Открыть папку логов» и
  «Выйти из приложения».
- Повторный запуск показывает существующее окно, не создавая второе подключение.
- `bun run desktop:run --tray` скрывает запущенный клиент, обычный запуск показывает его,
  `bun run desktop:run --exit` завершает его.

Shell пишет только фиксированные lifecycle events в
`%LOCALAPPDATA%\ru.zabastx.voicechat\logs`. Хранятся максимум три файла по 256 KiB. URL, cookie,
session material и содержимое страницы в лог не попадают. Автоматической телеметрии нет.

## Проверка production shell

```powershell
bun run desktop:check
```

Harness создаёт временный HTTPS endpoint и release EXE с этим встроенным origin. Через WebView2 CDP
он проверяет отказ от runtime override, локальный экран ошибки, retry без перезапуска, close/hide,
single-instance restore, явный exit и bounded logs. Временный сертификат удаляется после проверки.

## Замер памяти и голоса

Первый prototype baseline составил **239,5 МиБ private commit** для двух участников в звонке в трее.
Подробности находятся в
[матрице проверок](../docs/progress/verification.md#v0250--tauri-2-windows-prototype).

`bun run desktop:bench` сохраняет прежний production memory/voice сценарий: два fixture member,
синтетический тон, двусторонние RTP-счётчики, скрытие и восстановление. Release origin теперь нельзя
подменить при запуске, поэтому перед benchmark нужен локальный HTTPS endpoint, встроенный той же
`desktop:build`. Перед запуском задайте тот же адрес в `VOICECHAT_DESKTOP_BENCH_ORIGIN`. Endpoint и
его certificate chain должны быть доступны и доверены Windows и Node.

Ручной замер всего дерева Tauri/WebView2:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/measure.ps1 -Label call-tray
```

Сравнивайте одинаковые данные, размер окна, состав звонка и время ожидания. `privateMiB` соответствует
метрике в [BENCH.md](../docs/BENCH.md); `workingSetMiB` отдельно включает общие страницы.

## Оставшиеся ограничения

Installer, updater, Native Bridge и notification contract реализуются отдельными tickets #6–#12.
Push-to-talk отложен. Реальные устройства, screen share, сон и пробуждение, embedded players и
длительный звонок требуют отдельной проверки в WebView2.
