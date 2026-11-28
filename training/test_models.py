import json
import math
import unittest
from statistics import mean, median

from build import HERE, features, fit_mq, sharp_analysis


def load(path):
    return json.loads((HERE / path).read_text())


GOLD = load("golden.json")


def robust(history, horizon):
    slopes = [(y2-y1)/(t2-t1) for i,(t1,y1) in enumerate(history)
              for t2,y2 in history[i+1:]]
    return history[-1][1] + horizon*median(slopes)


class ModelTests(unittest.TestCase):
    def test_occupancy_firmware_trace(self):
        s = load("specs/occupancy.json")
        p = s["parameters"]
        history = []
        horizon = load("specs/forecast.json")["horizon_minutes"]
        for v, forecast in zip(GOLD["occupancy"], GOLD["linear_forecast"], strict=True):
            now = v["ms"]
            if history and now-history[-1][0] > s["gap_reset_ms"]:
                history.clear()
            history.append((now,v["ppm"]))
            history = [(t,y) for t,y in history[-s["window_capacity"]:]
                       if now-t <= 1000*p["HISTORY_SECONDS"]]
            avg = mean(y for _,y in history)
            delta = avg-p["HISTORICAL_EMPTY_CO2_PPM"]
            rate = estimate = None
            even, outside = -1, False
            if len(history)>=s["min_samples"] and now-history[0][0]>=1000*p["MIN_HISTORY_SECONDS"]:
                mid = mean(t for t,_ in history)
                rate = 60000*sum((t-mid)*(y-avg) for t,y in history)/sum((t-mid)**2 for t,_ in history)
                raw = (p["INTERCEPT"] + p["BETA_DELTA"]*delta/p["DELTA_SCALE_PPM"]
                       + p["BETA_RATE"]*rate/p["RATE_SCALE_PPM_PER_MIN"])
                estimate = min(p["MAX_PEOPLE"],max(0,raw))
                even = 2*math.floor(estimate/2+0.5)
                outside = (not p["TRAIN_DELTA_MIN"]<=delta<=p["TRAIN_DELTA_MAX"] or
                           not p["TRAIN_RATE_MIN"]<=rate<=p["TRAIN_RATE_MAX"])
            if rate is None:
                self.assertIsNone(forecast["expected"])
            else:
                self.assertAlmostEqual(max(0,avg+horizon*rate),forecast["expected"],delta=1e-4)
            for a,b in zip([avg,delta,rate,estimate,even,outside],v["expected"]):
                if b is None:
                    self.assertIsNone(a)
                else:
                    self.assertAlmostEqual(a,b,delta=1e-4)

    def test_mq135_firmware_trace(self):
        s = load("specs/mq135.json")
        anchor = GOLD["mq_anchor"]
        ewma, last, used = 0,0,0
        votes = []
        for v in GOLD["mq135"]:
            now,t,h = v["ms"],v["t"],v["rh"]
            residual = z = None
            status = None
            if now<s["warm_ms"]:
                status="WARMING_UP"
            elif v["age_ms"]>s["adc_age_limit_ms"] or v["seq"]==used:
                status="ADC_INVALID_OR_STALE"
            else:
                used=v["seq"]
                if not (s["temperature_range"][0]<=t<=s["temperature_range"][1] and
                        s["humidity_range"][0]<=h<=s["humidity_range"][1]):
                    status="OUTSIDE_PROVISIONAL_COVERAGE"
            if status or now-last>s["gap_ms"]:
                votes,ewma,last=[],0,0
            if status is None:
                diff=features(t,h)-features(anchor["t0"],anchor["h0"])
                residual=math.log(anchor["r0"]/v["rs"])-anchor["x0"]-diff@s["beta"]
                z=(residual-s["residual_median"])/s["residual_scale"]
                ewma=s["alpha"]*max(0,z)+(1-s["alpha"])*ewma
                votes=(votes+[ewma>s["limit"]])[-s["window"]:]
                last=now
                status=("VOTE_WARMUP" if len(votes)<s["window"] else
                        "UNUSUAL_RESPONSE" if sum(votes)>=s["confirmation"] else "NO_CONFIRMED_RESPONSE")
            self.assertEqual(v["status"],status)
            for a,b in zip([residual,z,ewma,sum(votes),status=="UNUSUAL_RESPONSE"],v["expected"]):
                if b is None:
                    self.assertIsNone(a)
                else:
                    self.assertAlmostEqual(a,b,delta=1e-5)

    def test_sharp_firmware_trace(self):
        s=load("specs/sharp.json")
        window,previous,start=[],0,None
        for v in GOLD["sharp"]:
            now=v["ms"]
            if not v["valid"] or now-previous>s["reset_gap_ms"]:
                window,start=[],None
            filtered=z=None
            if v["valid"]:
                window=(window+[v["on_mv"]])[-s["median_window"]:]
                filtered=median(window)
                z=(filtered-s["baseline_mv"])/s["robust_sd_mv"]
            ready=len(window)==s["median_window"]
            if ready and filtered>=s["high_mv"]:
                if start is None:
                    start=now
            else:
                start=None
            high=start is not None and now-start>=s["persistent_high_ms"]
            previous=now
            for a,b in zip([filtered,z,len(window),ready,high],v["expected"]):
                if b is None:
                    self.assertIsNone(a)
                else:
                    self.assertAlmostEqual(a,b,delta=1e-5)

    def test_reference_forecasts(self):
        v=GOLD["forecast"]
        horizon=load("specs/forecast.json")["horizon_minutes"]*60000
        points=[(i*v["interval_ms"],v["start_ppm"]+i*v["step_ppm"]) for i in range(v["evaluation_count"])]
        self.assertEqual(robust(points[:61],horizon),780)
        actual=dict(points)
        errors=[]
        for i in range(60,len(points)):
            t,y=points[i]
            if t+horizon in actual:
                target=actual[t+horizon]
                errors.append((abs(robust(points[i-60:i+1],horizon)-target),abs(y-target)))
        self.assertGreater(len(errors),0)
        self.assertEqual(mean(e[0] for e in errors),0)
        self.assertEqual(mean(e[1] for e in errors),120)

    def test_candidates_reproduce(self):
        self.assertEqual(fit_mq(),load("mq135_candidate.json"))
        self.assertEqual(sharp_analysis(),load("sharp_comparison.json"))
