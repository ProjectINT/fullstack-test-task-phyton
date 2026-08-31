"""Выгрузка OpenAPI-схемы приложения в файл.

Единственный источник правды по контракту — сам FastAPI. Схема кладётся
рядом с кодом бэкенда и коммитится, чтобы изменение контракта было видно
в диффе, а фронтенд мог генерировать типы без запущенного сервера и БД.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.main import app  # noqa: E402

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    output.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n")
    print(f"OpenAPI schema written to {output}")


if __name__ == "__main__":
    main()
