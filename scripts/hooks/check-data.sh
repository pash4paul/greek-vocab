#!/usr/bin/env bash
# Хук Claude Code: после правки словаря в data/*.yaml прогоняет npm run check.
#
# Зачем: сломанный yaml или дубль слова иначе остаётся незамеченным до
# следующей сборки. Хук возвращает текст ошибки модели, чтобы она починила
# сразу, а не через десять сообщений.
#
# Ставится через .claude/settings.json, событие PostToolUse.
# Проверить руками:
#   echo '{"tool_input":{"file_path":"data/01-home.yaml"}}' | scripts/hooks/check-data.sh

set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

# Интересует только словарь. Правки кода проверяются иначе.
case "$file" in
  */data/*.yaml|*/data/*.yml|data/*.yaml|data/*.yml) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0

if out=$(npm run --silent check 2>&1); then
  exit 0
fi

# Ошибку отдаём модели в additionalContext — так она увидит вывод целиком
# и сможет исправить, не запуская проверку заново.
jq -n --arg out "$out" '{
  systemMessage: "Словарь не проходит npm run check — есть ошибки",
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("npm run check завершился с ошибкой:\n\n" + $out)
  }
}'
