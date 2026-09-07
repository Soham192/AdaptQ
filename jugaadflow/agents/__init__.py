import os
import json
import logging

logger = logging.getLogger("jugaadflow.agents")

MODEL = os.environ.get("JUGAADFLOW_AGENT_MODEL", "gemini-3.6-flash")
_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def get_client():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    return {"api_key": key}


def call_llm(client: dict, *, model: str, system: str, messages: list,
             max_tokens: int = 4096, json_mode: bool = True) -> dict:
    import httpx

    contents = []
    for msg in messages:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens,
        },
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"

    url = f"{_API_URL}/{model}:generateContent?key={client['api_key']}"

    response = httpx.post(url, json=body, timeout=30.0)

    if response.status_code == 429:
        raise RateLimitError(f"429: {response.text}")
    if response.status_code == 503:
        raise LLMError(f"503: Gemini temporarily unavailable")
    if response.status_code != 200:
        raise LLMError(f"{response.status_code}: {response.text}")

    result = response.json()

    try:
        parts = result["candidates"][0]["content"]["parts"]
        # Thinking models return multiple parts — take the last text part (the actual response)
        text = None
        for part in reversed(parts):
            if "text" in part:
                text = part["text"]
                break
        if text is None:
            raise KeyError("no text part found")
    except (KeyError, IndexError):
        raise LLMError(f"Unexpected response format: {json.dumps(result)[:200]}")

    return _wrap_text_response(text)


def _wrap_text_response(text: str) -> dict:
    return {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": text,
            }
        }]
    }


class RateLimitError(Exception):
    pass


class LLMError(Exception):
    pass
