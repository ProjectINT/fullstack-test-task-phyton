#!/usr/bin/env bash
# Генерация клиентского контракта: FastAPI -> backend/openapi.json -> frontend/src/api/schema.d.ts
#
# Оба артефакта коммитятся. CI перегенерирует их и падает на git diff,
# если бэкенд поменял контракт, а типы фронтенда не обновили.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v uv >/dev/null 2>&1; then
  uv run --project backend python backend/scripts/dump_openapi.py backend/openapi.json
elif [ -n "$(docker ps -q -f name='^backend$' 2>/dev/null)" ]; then
  echo "uv не найден, генерирую схему в запущенном контейнере backend"
  docker exec backend python scripts/dump_openapi.py /backend/openapi.json
else
  echo "uv не найден, поднимаю одноразовый контейнер backend"
  docker compose -f docker-compose.dev.yml run --rm --no-deps -T backend \
    python scripts/dump_openapi.py /backend/openapi.json
fi

cd frontend
npx --no-install openapi-typescript ../backend/openapi.json -o src/api/schema.d.ts
