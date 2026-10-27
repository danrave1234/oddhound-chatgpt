"""Fixed gateway policy. No model supplied code or dynamic permission expansion."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http, ctx

BASE = Path('/run/oddhound')
SCOPE = json.loads((BASE / 'scope.json').read_text())
LAB = (BASE / 'profile').read_text().strip() == 'owned-lab-v1'
UI = SCOPE['origin']
APIS = {a['origin']: set(a['methods']) for a in SCOPE.get('apiOrigins', [])}
RESOURCES = set(SCOPE.get('resourceOrigins', []))
ASSETS = {'script', 'style', 'image', 'font', 'manifest', 'audio', 'video', 'iframe', 'frame', 'worker', 'sharedworker'}

def origin(url):
    u = urlsplit(url)
    if u.username or u.password or not u.hostname:
        return ''
    port = u.port
    return f'{u.scheme}://{u.hostname}' + (f':{port}' if port and port != (443 if u.scheme == 'https' else 80) else '')

def path_denied(path):
    return any(path == p or path.startswith(p.rstrip('/') + '/') for p in SCOPE.get('deniedPaths', []))

class Policy:
    def __init__(self):
        self.requests = 0
        self.active = 0
        self.bytes = 0
        self.denied = 0
        self.fenced = False
        self.reason = None
        self.nav_used = set()
        self.redirects = {}

    def save(self):
        value = {'requests': self.requests, 'active': self.active, 'receivedBytes': self.bytes, 'denied': self.denied, 'fenced': self.fenced, 'reason': self.reason, 'updatedAt': time.time()}
        temp = Path('/tmp/gateway/state.tmp')
        temp.write_text(json.dumps(value))
        temp.replace('/tmp/gateway/state.json')

    def deny(self, flow, reason, terminal=False):
        self.denied += 1
        if terminal:
            self.fenced = True
            self.reason = reason
        flow.response = http.Response.make(403, b'Oddhound policy refused this request.', {'content-type': 'text/plain', 'cache-control': 'no-store'})
        flow.metadata['oddhound_denied'] = True
        self.release(flow)
        self.save()

    def expired(self):
        # Root supervisor owns expiry; a stop file also fences persistent connections.
        return self.fenced or (BASE / 'stopped').exists() or time.time() >= float((BASE / 'deadline').read_text())

    def http_connect(self, flow):
        permitted = {urlsplit(o).netloc.lower() for o in {UI, *APIS, *RESOURCES}}
        host = flow.request.host.lower()
        authority = host + (f':{flow.request.port}' if flow.request.port != 443 else '')
        if self.expired() or authority not in permitted or any(k.lower().startswith('x-upstream-') for k in flow.request.headers):
            self.deny(flow, 'connect_scope_refused')

    def requestheaders(self, flow):
        self.requests += 1
        if self.expired() or self.requests > 1500:
            self.deny(flow, 'request_limit_or_expiry', True)
            return
        if self.active >= 6:
            self.deny(flow, 'request_concurrency_limit')
            return
        self.active += 1
        flow.metadata['oddhound_active'] = True
        request = flow.request
        host = origin(request.url)
        parsed = urlsplit(request.url)
        if parsed.scheme != 'https' and not LAB:
            self.deny(flow, 'https_required')
            return
        if path_denied(parsed.path) or any(k.lower().startswith('x-upstream-') for k in request.headers):
            self.deny(flow, 'forbidden_operation_or_proxy_header')
            return
        if request.method == 'CONNECT' or request.headers.get('upgrade') or 'websocket' in request.headers.get('connection', '').lower():
            self.deny(flow, 'socket_capability_not_enabled')
            return
        source = origin(request.headers.get('origin', ''))
        referer = origin(request.headers.get('referer', ''))
        dest = request.headers.get('sec-fetch-dest', '')
        allowed = False
        if host == UI:
            # Ordinary in-scope UI discovery is unrestricted by endpoint names.
            allowed = source == UI or referer == UI
            if dest == 'document' and request.method in ('GET', 'HEAD'):
                try:
                    ticket = json.loads((BASE / 'navigation.json').read_text())
                    if ticket['url'] == request.url and ticket['expires'] >= time.time() and ticket['id'] not in self.nav_used:
                        self.nav_used.add(ticket['id'])
                        allowed = True
                except (FileNotFoundError, ValueError, KeyError):
                    pass
                if self.redirects.get(request.url, 0) >= time.time():
                    allowed = True
                    del self.redirects[request.url]
            if request.method not in ('GET', 'HEAD') and not SCOPE['writes']:
                allowed = False
        elif host in APIS:
            # Resource frames/workers cannot borrow the verified UI's API grant.
            allowed = source == UI and dest not in ('document', 'iframe', 'frame') and request.method in APIS[host]
            if request.method not in ('GET', 'HEAD') and not SCOPE['writes']:
                allowed = False
        elif host in RESOURCES:
            allowed = request.method in ('GET', 'HEAD') and dest in ASSETS
            for header in ('cookie', 'authorization', 'proxy-authorization'):
                request.headers.pop(header, None)
        if not allowed:
            self.deny(flow, 'origin_or_capability_refused')
            return
        request.headers.pop('proxy-authorization', None)
        request.headers['accept-encoding'] = 'identity'
        # Request body storage is independently bounded by mitmproxy body_size_limit.
        self.save()

    def responseheaders(self, flow):
        if flow.metadata.get('oddhound_denied'):
            return
        if self.expired():
            self.deny(flow, 'run_fenced', True)
            return
        response = flow.response
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('location', '')
            from urllib.parse import urljoin
            target = urljoin(flow.request.url, location)
            # Only a permitted primary document may continue same-origin navigation.
            if flow.request.headers.get('sec-fetch-dest') == 'document' and origin(target) == UI and not path_denied(urlsplit(target).path):
                self.redirects[target] = time.time() + 10
            elif origin(target) != origin(flow.request.url):
                self.deny(flow, 'redirect_scope_refused')
                return
        # Do not buffer or decompress an unbounded encoded stream.
        # This profile requests identity; an origin ignoring it is explicitly unsupported.
        if response.headers.get('content-encoding', 'identity').lower() not in ('identity', ''):
            self.deny(flow, 'unsupported_content_encoding')
            return
        size = 0
        def stream(chunk):
            nonlocal size
            size += len(chunk)
            self.bytes += len(chunk)
            if self.expired() or size > 8 * 1024 * 1024 or self.bytes > 50 * 1024 * 1024:
                self.fenced = True
                self.reason = 'received_byte_limit'
                self.save()
                flow.kill()
                return b''
            return chunk
        response.stream = stream

    def release(self, flow):
        if flow.metadata.pop('oddhound_active', False):
            self.active = max(0, self.active - 1)

    def response(self, flow):
        self.release(flow)
        self.save()

    def error(self, flow):
        self.release(flow)
        self.save()

    def running(self):
        self.save()

addons = [Policy()]
