from __future__ import annotations
import json
from demo_backend.ports.errors import LLMClientError

def extract_json_object(raw_text: str) -> dict:
    """Return the first valid JSON object found in an LLM text response."""
    text = str(raw_text or '').strip()
    for candidate in [text, _strip_markdown_fence(text), *_balanced_json_candidates(text)]:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise LLMClientError('LLM output was not valid JSON.', diagnostic_category='response_parse_failed')

def _strip_markdown_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith('```'):
        return stripped
    lines = stripped.splitlines()
    if not lines:
        return stripped
    body_lines = lines[1:]
    if body_lines and body_lines[-1].strip() == '```':
        body_lines = body_lines[:-1]
    return '\n'.join(body_lines).strip()

def _balanced_json_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for start_index, char in enumerate(text):
        if char != '{':
            continue
        depth = 0
        in_string = False
        escaped = False
        for index in range(start_index, len(text)):
            current = text[index]
            if escaped:
                escaped = False
                continue
            if current == '\\':
                escaped = True
                continue
            if current == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if current == '{':
                depth += 1
            elif current == '}':
                depth -= 1
                if depth == 0:
                    candidates.append(text[start_index:index + 1])
                    break
    return candidates
