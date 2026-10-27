"""Pure request checks shared by the gateway and its focused tests."""
import json
import re
from urllib.parse import parse_qs, unquote

def canonical_path(raw):
    if re.search(r'%2f|%5c', raw, re.I):
        raise ValueError('ambiguous_path')
    value = unquote(raw, errors='strict')
    if '%' in value or '\\' in value or '\x00' in value or '//' in value or any(p in ('.', '..') for p in value.split('/')):
        raise ValueError('ambiguous_path')
    return value

def matching_operation(grant, origin, method, path):
    path = canonical_path(path)
    for operation in grant.get('operations', []):
        if operation['origin'] != origin or operation['method'] != method:
            continue
        template = operation['path'].split('/')
        parts = path.split('/')
        if len(template) != len(parts):
            continue
        if all(part in grant['fixtureIds'] if expected == ':fixture' else part == expected for expected, part in zip(template, parts)):
            return operation
    return None

def preflight_allowed(grant, origin, requested_method, path, source, ui_origin, granted_methods):
    if source != ui_origin or requested_method not in granted_methods:
        return False
    return requested_method in ('GET', 'HEAD') or not grant or grant['mode'] != 'mapped' or matching_operation(grant, origin, requested_method, path) is not None

def body_value(operation, content_type, body):
    binding = operation.get('body')
    if not binding:
        return None
    try:
        if binding['encoding'] == 'form' and content_type.split(';')[0].strip().lower() == 'application/x-www-form-urlencoded':
            values = parse_qs(body.decode('utf-8', errors='strict'), keep_blank_values=True, max_num_fields=256).get(binding['field'], [])
            return values[0] if len(values) == 1 else None
        if binding['encoding'] == 'json' and content_type.split(';')[0].strip().lower() == 'application/json':
            def pairs(items):
                result = {}
                for key, value in items:
                    if key in result:
                        raise ValueError('duplicate_json_key')
                    result[key] = value
                return result
            value = json.loads(body, object_pairs_hook=pairs)
            for part in binding['field'].split('.'):
                value = value.get(part) if isinstance(value, dict) else None
            return value if isinstance(value, str) else None
    except (ValueError, UnicodeError, RecursionError):
        pass
    return None

def body_allowed(grant, operation, content_type, body, registration_prefix=None, registration_domain=None):
    binding = operation.get('body')
    if not binding:
        return operation['effect'] not in ('register', 'create') or ':fixture' in operation['path']
    value = body_value(operation, content_type, body)
    if value is None:
        return False
    if operation['effect'] == 'register':
        if not re.fullmatch(r'[a-zA-Z0-9_.@+-]{1,320}', value):
            return False
        if '@' in value and (not registration_domain or value.count('@') != 1 or value.split('@')[1].lower() != registration_domain.lower()):
            return False
    if binding['match'] == 'fixture_id':
        return value in grant['fixtureIds']
    prefix = registration_prefix if operation['effect'] == 'register' else grant['namespace']
    return bool(prefix and value.startswith(prefix + '_'))
