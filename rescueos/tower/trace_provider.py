"""Adaptador Ollama local. Sem SDK, download, proxy, redirect ou provedor cloud."""

import json
import httpx


class TraceError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class OllamaProvider:
    kind = "ollama"

    def __init__(self, model="qwen3:4b", transport=None):
        self.model = model
        self.transport = transport

    async def _request(self, method, path, body=None):
        try:
            async with httpx.AsyncClient(base_url="http://127.0.0.1:11434", trust_env=False,
                                        follow_redirects=False, timeout=60,
                                        transport=self.transport) as client:
                async with client.stream(method, path, json=body) as response:
                    if response.status_code != 200:
                        raise TraceError("MODEL_UNAVAILABLE")
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 262144:
                            raise TraceError("MODEL_RESPONSE_LIMIT")
                    return json.loads(raw)
        except httpx.TimeoutException:
            raise TraceError("TIMEOUT") from None
        except httpx.HTTPError:
            raise TraceError("MODEL_UNAVAILABLE") from None
        except (ValueError, RecursionError):
            raise TraceError("INVALID_MODEL_RESPONSE") from None

    async def check(self):
        # Apenas um modelo já instalado, com ferramenta nativa e sem encaminhamento remoto.
        tags = await self._request("GET", "/api/tags")
        if not isinstance(tags, dict) or not isinstance(tags.get("models"), list):
            raise TraceError("INVALID_MODEL_RESPONSE")
        model = next((m for m in tags["models"] if isinstance(m, dict) and m.get("name") == self.model), None)
        if model is None or model.get("remote_host") or ":cloud" in self.model:
            raise TraceError("MODEL_UNAVAILABLE")
        details = await self._request("POST", "/api/show", {"model": self.model})
        if not isinstance(details, dict) or details.get("remote_host") or "tools" not in details.get("capabilities", []):
            raise TraceError("MODEL_UNAVAILABLE")

    async def chat(self, messages, schema):
        body = {"model": self.model, "messages": messages, "stream": False, "think": False,
                "options": {"temperature": 0, "num_predict": 768, "num_ctx": 8192}, "keep_alive": "5m"}
        body["format"] = schema
        data = await self._request("POST", "/api/chat", body)
        if isinstance(data, dict) and data.get("done_reason") == "length":
            raise TraceError("MODEL_OUTPUT_LIMIT")
        if (not isinstance(data, dict) or data.get("done") is not True
                or data.get("done_reason") != "stop" or not isinstance(data.get("message"), dict)):
            raise TraceError("INVALID_MODEL_RESPONSE")
        message = data["message"]
        if message.get("role") != "assistant" or not isinstance(message.get("content", ""), str):
            raise TraceError("INVALID_MODEL_RESPONSE")
        # Não armazenar nem devolver thinking, prompts ou texto livre no histórico público.
        return {"role": "assistant", "content": message.get("content", ""),
                "tool_calls": message.get("tool_calls", [])}
