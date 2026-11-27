import tempfile
import unittest
from pathlib import Path
from vigil_backend import Backend, robust_forecast


def packet(sample, co2=600, age=0, **changes):
    d={'uptime_ms':sample+age,'scd_age_ms':age,'co2_ppm':co2,'scd_valid':True,'control_co2_fresh':True,
       'fan_on':False,'fan_mode':'AUTO','fan_runtime_s':0,'room_condition':'NO_CONFIRMED_ANOMALY',
       'mq_status':'NO_CONFIRMED_RESPONSE','dust_status':'BASELINE_RANGE','co2_forecast_10min_ppm':co2+100}
    d.update(changes);return d

class BackendTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.b=Backend(Path(self.tmp.name)/'test.db')
    def tearDown(self):self.b.close();self.tmp.cleanup()
    def test_duplicate(self):
        self.b.ingest(packet(5000));self.b.ingest(packet(5000,age=1000));self.assertEqual(self.b.stats()['fresh_co2_samples'],1)
        self.assertEqual(self.b.stats()['session_telemetry'],2)
    def test_robust_linear(self):
        hist=[(i*5000,600+i) for i in range(61)]
        self.assertAlmostEqual(robust_forecast(hist),780)
    def test_forecast_evaluation(self):
        for i in range(181): self.b.ingest(packet(5000+i*5000,600+i))
        s=self.b.stats();self.assertGreater(s['paired_forecast_metrics']['python_robust']['n'],0)
        self.assertAlmostEqual(s['paired_forecast_metrics']['python_robust']['mae_ppm'],0)
        self.assertAlmostEqual(s['paired_forecast_metrics']['persistence']['mae_ppm'],120)
    def test_stale(self):
        self.b.ingest(packet(5000));self.b.ingest(packet(5000,age=16000,control_co2_fresh=False))
        self.assertIsNone(self.b.latest_data()['forecast']);self.assertEqual(self.b.stats()['fresh_co2_samples'],1)
    def test_reboot(self):
        self.b.ingest(packet(100000));old=self.b.session;self.b.ingest(packet(5000))
        self.assertNotEqual(old,self.b.session);self.assertEqual(self.b.stats()['fresh_co2_samples'],1)
    def test_missed_target(self):
        self.b.ingest(packet(5000));self.b.ingest(packet(650000))
        self.assertEqual(self.b.stats()['forecast_status_counts']['missed_target'],1)
        self.assertIsNone(self.b.latest_forecast['python_robust'])
    def test_offline(self):
        self.b.ingest(packet(5000));self.b.fail('timeout');self.assertFalse(self.b.latest_data()['connection']['online']);self.assertIsNone(self.b.latest_data()['forecast'])
    def test_export(self):
        self.b.ingest(packet(5000));self.assertIn(b'co2_ppm',self.b.export('telemetry'))
    def test_bad_schema(self):
        with self.assertRaises(ValueError):self.b.ingest({'hello':'world'})

if __name__=='__main__':unittest.main(verbosity=2)
