#!/usr/bin/env bash
# Сборка пакета для Chrome Web Store + проверки перед публикацией.
# Запуск: ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

# Белый список: в архив попадает только то, что нужно расширению.
# Всё остальное (README, PRIVACY, build/, .git, dist/) исключено по построению.
FILES=(
  manifest.json
  content.js
  content.css
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

echo "== Проверки =="
python3 - "$@" <<'PY'
import json, os, re, struct, sys

fail = []
warn = []
ok = []

with open("manifest.json", encoding="utf-8") as fh:
    m = json.load(fh)

name, desc, ver = m.get("name", ""), m.get("description", ""), m.get("version", "")

if m.get("manifest_version") != 3:
    fail.append(f"manifest_version должен быть 3 (сейчас {m.get('manifest_version')!r})")
else:
    ok.append("manifest_version = 3")

for label, value, limit in (("name", name, 75), ("description", desc, 132)):
    if not value:
        fail.append(f"{label} пустой")
    elif len(value) > limit:
        fail.append(f"{label}: {len(value)} символов, лимит Chrome — {limit}")
    else:
        ok.append(f"{label}: {len(value)}/{limit} символов")

if not re.fullmatch(r"\d+(\.\d+){0,3}", ver or ""):
    fail.append(f"version {ver!r} не подходит по формату Chrome (нужно 1.0.0)")
else:
    ok.append(f"version = {ver}")

if re.search(r"<[a-z][^>]*>", desc):
    fail.append("description содержит HTML — Chrome допускает только простой текст")

def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG")
    w, h = struct.unpack(">II", head[16:24])
    return w, h

icons = m.get("icons")
if not icons:
    fail.append("в манифесте нет блока icons")
else:
    for key, path in sorted(icons.items(), key=lambda kv: int(kv[0])):
        if not os.path.isfile(path):
            fail.append(f"иконка {path} не найдена")
            continue
        try:
            w, h = png_size(path)
        except ValueError as exc:
            fail.append(f"{path}: {exc}")
            continue
        if (w, h) != (int(key), int(key)):
            fail.append(f"{path}: {w}x{h}, а в манифесте заявлено {key}x{key}")
        else:
            ok.append(f"icon{key}: {w}x{h}")

for cs in m.get("content_scripts", []):
    for path in cs.get("js", []) + cs.get("css", []):
        if not os.path.isfile(path):
            fail.append(f"файл контент-скрипта {path} не найден")

if not m.get("content_scripts"):
    fail.append("нет content_scripts — расширение ничего не делает")

for key in ("update_url",):
    if key in m:
        fail.append(f"в манифесте не должно быть {key}")

if m.get("permissions"):
    warn.append(f"запрошены API-разрешения: {m['permissions']} — обоснуйте их в дашборде")

# короткое описание из листинга тоже ограничено 132 символами
try:
    with open("STORE_LISTING.md", encoding="utf-8") as fh:
        listing = fh.read()
    block = re.search(r"\*\*Short description\*\*[^\n]*\n\s*```\n(.*?)\n\s*```", listing, re.S)
    if not block:
        warn.append("не нашёл Short description в STORE_LISTING.md — проверьте вручную")
    else:
        short = block.group(1).strip()
        if len(short) > 132:
            fail.append(f"Short description: {len(short)} символов, лимит — 132")
        else:
            ok.append(f"Short description: {len(short)}/132 символов")
except FileNotFoundError:
    warn.append("STORE_LISTING.md отсутствует")

for line in ok:
    print(f"  ok   {line}")
for line in warn:
    print(f"  WARN {line}")
for line in fail:
    print(f"  FAIL {line}")

if fail:
    print(f"\nПроверки не пройдены: {len(fail)}")
    sys.exit(1)
PY

if command -v node >/dev/null 2>&1; then
  node --check content.js && echo "  ok   content.js — синтаксис валиден"
else
  echo "  WARN node не найден, синтаксис content.js не проверен"
fi

echo
echo "== Сборка =="
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
ZIP="dist/work-zilla-notifyer-${VERSION}.zip"
mkdir -p dist
rm -f "$ZIP"
zip -X -q "$ZIP" "${FILES[@]}"

echo "== Проверка архива =="
python3 - "$ZIP" "${FILES[@]}" <<'PY'
import json, sys, zipfile

zip_path, *expected = sys.argv[1:]
with zipfile.ZipFile(zip_path) as z:
    names = sorted(n for n in z.namelist() if not n.endswith("/"))
    if names != sorted(expected):
        extra = set(names) - set(expected)
        missing = set(expected) - set(names)
        print(f"  FAIL содержимое архива не совпадает с ожидаемым")
        if extra:
            print(f"  FAIL лишние файлы: {sorted(extra)}")
        if missing:
            print(f"  FAIL нет файлов: {sorted(missing)}")
        sys.exit(1)
    print(f"  ok   в архиве ровно {len(names)} файлов: {', '.join(names)}")
    for required in ("manifest.json",):
        if required not in names:
            print(f"  FAIL {required} не в корне архива")
            sys.exit(1)
    manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    print(f"  ok   manifest.json внутри архива читается: v{manifest['version']}")
PY

echo
ls -lh "$ZIP" | awk '{print "Пакет: " $9 " (" $5 ")"}'
sha256sum "$ZIP" | awk '{print "SHA256: " $1}'
