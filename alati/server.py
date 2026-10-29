#!/usr/bin/env python3
"""Lokalni server za Drummer, umesto `python3 -m http.server`.

    python3 alati/server.py            # http://127.0.0.1:8123
    python3 alati/server.py --port 8124

Šalje COOP/COEP zaglavlja, pa je stranica "cross-origin isolated" i AI obrada
koristi sve niti procesora. Fajlove ne kešira bez provere (izmene se vide odmah),
a veći red čekanja ne prekida veze kada browser učita 90+ modula odjednom.
"""
import argparse
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
                      '.webmanifest': 'application/manifest+json', '.json': 'application/json'}

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description='Drummer lokalni server sa COOP/COEP zaglavljima')
    parser.add_argument('--port', type=int, default=8123)
    parser.add_argument('--bind', default='127.0.0.1')
    args = parser.parse_args()
    handler = functools.partial(Handler, directory=str(ROOT))
    with Server((args.bind, args.port), handler) as server:
        print(f'Drummer: http://{args.bind}:{args.port} (Ctrl+C za kraj)', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
