"""HTTP client for the active local llama-server OpenAI-compatible ``/v1/chat/completions`` API."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel

# --- Exceptions -----------------------------------------------------------------


class LLMClientError(Exception):
    """Base class for llama.cpp chat client failures."""


class LLMTimeoutError(LLMClientError):
    """Request exceeded the configured timeout."""


class LLMConnectionError(LLMClientError):
    """Could not reach the server (DNS, refused connection, network error)."""


class LLMHttpStatusError(LLMClientError):
    """Server returned a non-success HTTP status."""

    def __init__(self, message: str, *, status_code: int, body_snippet: str | None = None) -> None:
        self.status_code = status_code
        self.body_snippet = body_snippet
        super().__init__(message)


class LLMMalformedResponseError(LLMClientError):
    """Response body was not valid JSON, missing expected fields, or not parseable as required."""


# --- Request / result models ----------------------------------------------------


class ResponseFormat(BaseModel):
    """
    Maps to OpenAI-style ``response_format`` (llama.cpp server compat varies by build).

    Use ``json_object`` when the assistant must emit JSON for the draft pipeline.
    """

    type: Literal["text", "json_object"] = "json_object"


@dataclass(frozen=True, slots=True)
class ChatCompletionResult:
    """Structured outcome for downstream draft generation (transport only — no DSL semantics here)."""

    content: str
    """Raw assistant message string from ``choices[0].message.content``."""

    parsed_json: dict[str, Any] | None
    """If ``response_format.type == json_object``, the parsed top-level JSON object; else ``None``."""

    usage: dict[str, Any] | None
    """Token usage block from the API when present."""

    raw_response: dict[str, Any]
    """Full decoded JSON object returned by ``/v1/chat/completions`` (for logging / metadata)."""


def chat_completions_base_url(host: str, port: int, *, scheme: str = "http") -> str:
    """Build a base URL for ``LlamaChatCompletionClient`` from host/port (no path)."""
    return f"{scheme}://{host}:{int(port)}"


class LlamaChatCompletionClient:
    """
    Sync client for ``POST {base_url}/v1/chat/completions``.

    Callers supply ``base_url`` for the *currently active* server (e.g. from model config + runtime state).
    """

    __slots__ = ("_api_model_name", "_base_url", "_timeout")

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 120.0,
        api_model_name: str = "local",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = float(timeout)
        self._api_model_name = api_model_name

    @property
    def base_url(self) -> str:
        return self._base_url

    def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_format: ResponseFormat,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        extra_request_fields: dict[str, Any] | None = None,
    ) -> ChatCompletionResult:
        """
        Send a single non-streaming chat completion request.

        Does not build workflow prompts — only forwards ``system_prompt`` / ``user_prompt`` as messages.
        """
        payload: dict[str, Any] = {
            "model": self._api_model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "stream": False,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if response_format.type == "json_object":
            payload["response_format"] = {"type": "json_object"}
        if extra_request_fields:
            payload.update(extra_request_fields)

        timeout = httpx.Timeout(connect=10.0, read=self._timeout, write=30.0, pool=10.0)

        try:
            with httpx.Client(base_url=self._base_url, timeout=timeout) as client:
                response = client.post("/v1/chat/completions", json=payload)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(f"llama.cpp chat request timed out: {exc}") from exc
        except httpx.RequestError as exc:
            raise LLMConnectionError(f"llama.cpp chat connection failed: {exc}") from exc

        body_text = response.text
        if not response.is_success:
            snippet = body_text[:2000] if body_text else None
            raise LLMHttpStatusError(
                f"llama.cpp chat HTTP {response.status_code}",
                status_code=response.status_code,
                body_snippet=snippet,
            )

        try:
            raw = response.json()
        except json.JSONDecodeError as exc:
            raise LLMMalformedResponseError(f"chat response is not JSON: {exc}") from exc

        if not isinstance(raw, dict):
            raise LLMMalformedResponseError("chat response JSON root must be an object")

        content = self._extract_message_content(raw)
        usage = raw.get("usage")
        usage_out = usage if isinstance(usage, dict) else None

        parsed: dict[str, Any] | None = None
        if response_format.type == "json_object":
            parsed = self._parse_json_object_content(content)

        return ChatCompletionResult(
            content=content,
            parsed_json=parsed,
            usage=usage_out,
            raw_response=raw,
        )

    @staticmethod
    def _extract_message_content(raw: dict[str, Any]) -> str:
        try:
            choices = raw["choices"]
            if not isinstance(choices, list) or not choices:
                raise KeyError("choices empty")
            first = choices[0]
            if not isinstance(first, dict):
                raise TypeError("choice not an object")
            message = first["message"]
            if not isinstance(message, dict):
                raise TypeError("message not an object")
            content = message["content"]
        except (KeyError, TypeError, IndexError) as exc:
            raise LLMMalformedResponseError("missing choices[0].message.content in chat response") from exc

        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            # Some APIs return content parts; join text parts only (minimal handling).
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    t = item.get("text")
                    if isinstance(t, str):
                        parts.append(t)
                elif isinstance(item, str):
                    parts.append(item)
            if not parts:
                raise LLMMalformedResponseError("unsupported multimodal content array in chat response")
            return "".join(parts)
        raise LLMMalformedResponseError("message.content has unexpected type")

    @staticmethod
    def _parse_json_object_content(content: str) -> dict[str, Any]:
        text = content.strip()
        if not text:
            raise LLMMalformedResponseError("empty assistant content for json_object response")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise LLMMalformedResponseError(f"assistant content is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise LLMMalformedResponseError("JSON mode requires a top-level object")
        return data
