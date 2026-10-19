import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('drummer_analysis', Path(__file__).resolve().parents[1] / 'alati' / 'analiza.py')
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


def run_analysis(events):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'fixture.jsonl'
        path.write_text('\n'.join(json.dumps(x) for x in events), encoding='utf-8')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            analysis.main(path)
        return output.getvalue()


def hit(t, note=38, vel=92):
    return {'type': 'on', 't': t, 'note': note, 'vel': vel}


class AnalysisTests(unittest.TestCase):
    def test_empty_capture(self):
        self.assertIn('Nema udaraca', run_analysis([]))

    def test_single_hit(self):
        self.assertIn('Udaraca: 1', run_analysis([hit(0)]))

    def test_double_trigger(self):
        self.assertRegex(run_analysis([hit(0), hit(.015, vel=20)]), r'Dobos\s+1x')

    def test_crosstalk(self):
        self.assertIn('udarac u Dobos okida Tom 1: 1x', run_analysis([hit(0), hit(.005, 48, 15)]))

    def test_hi_hat_pedal(self):
        events = [hit(0, 42), hit(1, 46), {'type': 'cc', 't': 0, 'cc': 4, 'val': 0}, {'type': 'cc', 't': 1, 'cc': 4, 'val': 127}]
        self.assertIn('raspon 0-127', run_analysis(events))

    def test_timing_against_click(self):
        events = [{'type': 'beat', 't': i * .5, 'bpm': 120} for i in range(12)]
        events += [hit(i * .5 + .01) for i in range(4, 12)]
        output = run_analysis(events)
        self.assertIn('UKUPNO', output)
        self.assertIn('+10.0', output)

    def test_saturation_warning_and_segments(self):
        output = run_analysis([hit(i * .1, vel=127) for i in range(6)] + [hit(4, 57)])
        self.assertIn('preosjetljivo?', output)
        self.assertIn('Crash 2', output)


if __name__ == '__main__':
    unittest.main()
