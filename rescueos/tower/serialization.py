"""JSON ASCII escapado: mantém identidades aceitas pelo núcleo, inclusive UTF-16 isolado."""

import json

from starlette.responses import JSONResponse


class EscapedJSONResponse(JSONResponse):
    def render(self, content):
        # Classe explícita desativa o dump_json direto do Pydantic no FastAPI.
        # A validação do response_model continua ativa; strings não são substituídas.
        return json.dumps(content, ensure_ascii=True, allow_nan=False,
                          separators=(",", ":")).encode("ascii")
