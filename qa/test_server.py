"""Lokalni server šalje COOP/COEP zaglavlja (AI na više niti) i ispravne MIME tipove za module."""
import http.client
import importlib.util
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('drummer_server', ROOT / 'alati' / 'server.py')
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class ServerHeadersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import functools
        handler = functools.partial(server_module.Handler, directory=str(ROOT))
        cls.server = server_module.Server(('127.0.0.1', 0), handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)
        connection.request('GET', path)
        response = connection.getresponse()
        response.read()
        connection.close()
        return response

    def test_isolation_headers_on_page_and_modules(self):
        for path in ('/', '/js/ai-model-cache.js', '/js/vendor/ort-webgpu-1.31.1.min.mjs'):
            response = self.get(path)
            self.assertEqual(response.status, 200, path)
            self.assertEqual(response.getheader('Cross-Origin-Opener-Policy'), 'same-origin')
            self.assertEqual(response.getheader('Cross-Origin-Embedder-Policy'), 'require-corp')
            self.assertEqual(response.getheader('Cache-Control'), 'no-cache')

    def test_module_mime_types(self):
        self.assertEqual(self.get('/js/vendor/ort-wasm-1.31.1.min.mjs').getheader('Content-Type'), 'text/javascript')
        self.assertEqual(self.get('/js/main.js').getheader('Content-Type'), 'text/javascript')

    def test_large_listen_queue(self):
        self.assertGreaterEqual(server_module.Server.request_queue_size, 64)


if __name__ == '__main__':
    unittest.main()
