from __future__ import annotations

def usage_values(client):
    usage = getattr(client, 'last_usage', None)
    if usage is None:
        return {'input_tokens': None, 'output_tokens': None, 'total_tokens': None}
    get = lambda key: usage.get(key) if isinstance(usage, dict) else getattr(usage, key, None)
    return {'input_tokens': get('prompt_tokens'), 'output_tokens': get('completion_tokens'), 'total_tokens': get('total_tokens')}
