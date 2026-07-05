#!/usr/bin/env bash
# Проверяет консистентность prompts/index.yml с фактическим содержимым
# репозитория. Возвращает ненулевой exit code при рассинхроне.
# Используется в CI и вручную перед коммитом.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f prompts/index.yml ]]; then
    echo "ERROR: prompts/index.yml не найден. Запусти ./scripts/build-index.sh" >&2
    exit 1
fi

expected="$(mktemp)"
trap 'rm -f "$expected"' EXIT

# Сгенерируем ожидаемый индекс во временный файл
./scripts/build-index.sh "$expected" 2>/dev/null

# generated_at будет отличаться на каждом запуске — нормализуем
# сравнение, вырезав эту строку из обоих файлов.
normalize() {
    grep -v '^generated_at:' "$1"
}

if ! diff <(normalize "$expected") <(normalize prompts/index.yml) > /dev/null; then
    echo "ERROR: prompts/index.yml устарел." >&2
    echo "Запусти ./scripts/build-index.sh и закоммить обновлённый файл." >&2
    echo "" >&2
    echo "Diff (expected vs actual):" >&2
    diff -u <(normalize prompts/index.yml) <(normalize "$expected") | head -100 >&2
    exit 1
fi

echo "prompts/index.yml is up to date"
