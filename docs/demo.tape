# Demo GIF для README: настоящая MCP-сессия по stdio с настоящим сервером
# (packages/mcp/dist/index.js) — хендшейк, tools/list и tools/call идут через
# официальный SDK. Единственная подмена: вместо api.kit.yandex.net сервер
# смотрит (через YANDEX_KIT_BASE_URL) на локальный мок docs/demo/mock-api.mjs,
# поэтому демо не требует токена и не ходит в сеть.
#
# Перегенерация:
#   npm run build && vhs docs/demo.tape
#
# Требуется: vhs (https://github.com/charmbracelet/vhs).
#
# ВАЖНО: при этих настройках терминал vhs — 97 колонок, и капчер замирает при
# скролле буфера. Весь вывод сценария обязан помещаться на один экран:
# не удлиняйте текст/таблицы, не сузив что-то другое.

Output docs/demo.gif

# Рендер в 2.4x (как FontSize 15 при 1060x833, но больше пикселей):
# GIF чёткий на retina, раскладка та же — 97 колонок.
Set Shell bash
Set FontSize 36
Set Width 2544
Set Height 2000
Set Padding 34
Set Margin 43
Set MarginFill "#f4f1eb"
Set WindowBar Colorful
Set BorderRadius 24
Set Framerate 30
# Палитра — как в demo mcp-yandex-direct: бумага #f4f1eb, поверхность #fbfaf7,
# текст #2b2722, акцент #d97757. Шрифт не задаём: дефолт vhs = JetBrains Mono.
Set Theme { "name": "Yandex KIT demo", "background": "#fbfaf7", "foreground": "#2b2722", "cursor": "#d97757", "selection": "#fbeee7", "black": "#1c1917", "red": "#c2453d", "green": "#2f8f6b", "yellow": "#a8801f", "blue": "#229ed9", "magenta": "#c25e3d", "cyan": "#d97757", "white": "#57514b", "brightBlack": "#8a847d", "brightRed": "#c2453d", "brightGreen": "#2f8f6b", "brightYellow": "#a8801f", "brightBlue": "#229ed9", "brightMagenta": "#c25e3d", "brightCyan": "#d97757", "brightWhite": "#1c1917" }

Hide
Type `node docs/demo/run.mjs` Enter
Wait+Screen@15s /инструментов/
Show

# Драйвер сам «печатает» вопрос и ведёт сценарий; ждём финальную строку ответа.
Wait+Screen@60s /скажите код и скидку/
Sleep 4s
