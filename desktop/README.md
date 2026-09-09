# Windows-клиент Voice Chat

Tauri 2 shell открывает серверную Web Release в WebView2. Nuxt, Postgres и LiveKit остаются на
сервере, а профиль WebView2 сохраняет Sign-in между запусками. Desktop Client имеет отдельную
версию `0.1.0-alpha.1`, binary `voice-chat.exe` и постоянный identifier
`ru.zabastx.voicechat`.

Release-сборка принимает только один HTTPS origin, встроенный во время компиляции. Переменная
`VOICECHAT_DESKTOP_URL` не меняет release EXE. Debug-сборка допускает HTTPS или loopback HTTP.
Страница другого origin и любое новое окно открываются в системном браузере. Удалённая страница
не получает Tauri capabilities или общий `invoke` — только версионированный Native Bridge, описанный
ниже.

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

## Native Bridge

Удалённая Web Release не получает общий Tauri `invoke` и не имеет permissions к updater, shell,
filesystem, process или store. Всё нативное проходит через один маленький контракт
([ADR 0013](../docs/adr/0013-remote-ui-behind-versioned-native-bridge.md)).

На доверенном origin — и только на нём — shell замораживает `window.voiceChatDesktop`:

```js
{ desktopVersion: '0.1.0-alpha.1', bridgeVersion: 1, capabilities: ['voice-lifecycle'], setVoiceActive }
```

`bridgeVersion` растёт, когда меняется форма контракта; новая возможность добавляется как
capability, а Web Release её feature-detect'ит. Web-сторона читает descriptor через
`useNativeDesktop()` ([app/composables/useNativeDesktop.ts](../app/composables/useNativeDesktop.ts)),
который проверяет descriptor и при отсутствии, поломке или неизвестной версии отдаёт browser
adapter. Неизвестные capabilities отбрасываются, поэтому более новый клиент не расширяет права
страницы. Браузер и старый Desktop Client продолжают работать: пропадает только соответствующий
native affordance.

Единственная обратная операция первой версии — `setVoiceActive(boolean)`. `useVoice` вызывает её
при входе в Voice Channel и в `reset()`; shell хранит флаг, чтобы согласованное обновление
устанавливалось после звонка, а не посреди него. Операции регистрируются поимённо: capability,
проверка payload и «сбой native не выходит наружу» находятся в
[shared/utils/native-bridge.ts](../shared/utils/native-bridge.ts), а разбор конверта — в
[src-tauri/src/bridge.rs](src-tauri/src/bridge.rs).

Обратный канал — отменяемая навигация `voicechat://bridge/<op>?value=...`, тот же механизм, которым
уже пользуются «Повторить» и «Выйти» на локальном экране ошибки. `chrome.webview.postMessage` здесь
не подходит: wry регистрирует свой `WebMessageReceived` первым для Tauri IPC и падает на любом
не-строковом payload, после чего WebView2 не вызывает следующие обработчики; строковый payload
доходит, но заставляет Tauri писать ошибку разбора в консоль страницы на каждый вызов
([GOTCHAS](../docs/GOTCHAS.md)).

Операция принимается, только если текущий документ окна — доверенный origin. Неизвестная операция и
неверное значение отбрасываются и один раз за процесс пишутся в лог; смена voice-состояния пишется
по переходу, а не по сообщению, поэтому болтливая страница не заполнит ограниченный лог. Любая
навигация, заменяющая документ, сбрасывает voice-флаг — документ, который его поднял, уже ушёл.

Одни и те же contract scenarios ([test/native-bridge-contract.ts](../test/native-bridge-contract.ts))
проходят и с browser adapter в `bun test`, и с настоящим Tauri adapter внутри WebView2 в
`bun run desktop:check`.

## Update feed

Серверная часть updater уже готова: публичный `GET /api/desktop/update` отдаёт Tauri updater
manifest для новейшего опубликованного GitHub Release с тегом `desktop-v*` (см.
[ADR 0014](../docs/adr/0014-independent-desktop-releases-with-one-update-stream.md)). Endpoint
доступен до Sign-in, потому что Desktop Client проверяет его до загрузки Web Release.

Tauri подставляет свои переменные в URL:

```
https://<origin>/api/desktop/update?target={{target}}&arch={{arch}}&version={{current_version}}
```

Ответы: `200` с manifest, `204` — предлагать нечего (клиент уже новый, подходящего Release нет,
или target не Windows x64), `503` — GitHub недоступен и в кэше ничего нет. Минимальная
поддерживаемая версия приходит отдельно от предлагаемой, в заголовке `X-Desktop-Minimum-Version`,
и присутствует в том числе в `204`.

Release попадает в feed, только если он опубликован (не draft), тег разбирается как
`desktop-v<semver>` и в нём есть все три x64 asset: NSIS setup, его `.sig` и Portable EXE. Release
без любого из них собран не полностью и не предлагается никому. `latest.json` и SHA-256 checksum не
требуются: manifest строит сам сервер и ни один из этих файлов не читает. Кандидаты сравниваются по
semver, поэтому возврат плохого Release в draft откатывает предложение на предыдущую версию, а
downgrade невозможен. Prerelease участвует наравне со stable — stream один.

Чтобы прогнать feed локально без публикации Release, укажите
`NUXT_DESKTOP_RELEASE_FIXTURE=test/fixtures/desktop-releases.json` (файл читается на каждый запрос,
его можно править на ходу). Это только для разработки: production-сборка игнорирует переменную и
пишет об этом в лог, потому что fixture может указать любой URL и любую подпись. Клиентская часть —
проверка при запуске и каждые шесть часов, согласие, ожидание выхода из Voice Channel и ручной путь
Portable EXE — относится к tickets #9–#12; сигнал активного звонка для них уже приходит через
Native Bridge.

## Оставшиеся ограничения

Installer, updater-клиент и notification contract реализуются отдельными tickets #7–#12.
Push-to-talk отложен. Реальные устройства, screen share, сон и пробуждение, embedded players и
длительный звонок требуют отдельной проверки в WebView2.
