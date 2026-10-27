"""Static DNS fixture for the internal-only browser lab; never a production resolver."""
import socketserver
import struct
RECORDS = {'fixture-lab': bytes([172, 30, 73, 20]), 'fixture-corrected-lab': bytes([172, 30, 73, 21])}
class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        message, sock = self.request
        if len(message) < 17 or len(message) > 512 or struct.unpack('!H', message[4:6])[0] != 1:
            return
        offset, labels = 12, []
        try:
            while message[offset]:
                length = message[offset]
                if length > 63 or offset + 1 + length >= len(message):
                    return
                labels.append(message[offset + 1:offset + 1 + length].decode('ascii').lower())
                offset += 1 + length
            offset += 1
            kind, cls = struct.unpack('!HH', message[offset:offset + 4])
        except (IndexError, UnicodeError, struct.error):
            return
        question = message[12:offset + 4]
        value = RECORDS.get('.'.join(labels))
        answer = b''
        if value and kind == 1 and cls == 1:
            answer = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 30, 4) + value
        flags = 0x8180 if value else 0x8183
        response = message[:2] + struct.pack('!HHHHH', flags, 1, 1 if answer else 0, 0, 0) + question + answer
        sock.sendto(response, self.client_address)
socketserver.UDPServer(('0.0.0.0', 53), Handler).serve_forever()
