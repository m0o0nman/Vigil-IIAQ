"""Check the complete timed worker against the audited source and test its gates."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
old = (root / "inputs/code/VIGIL_Phase3_Fixed.ino").read_text()
new = (root / "firmware/VigilV2/acquisition.cpp").read_text()

def worker(text):
    return text[text.index("void adcWorker(void*){"):].split("\n}", 1)[0]

expected = worker(old).replace(
    "filterDust(d);portENTER_CRITICAL(&dataMux);dustShared=d;portEXIT_CRITICAL(&dataMux);",
    "capture(d);").replace("m.pinV=mqMvSum", "m.raw=raw;m.pinV=mqMvSum")
assert expected == worker(new)
print("PASS complete ADC worker matches original apart from two telemetry changes", flush=True)

def expr(key):
    return new.split(key, 1)[1].split(";", 1)[0]

# Execute actual guard expressions rather than a second set of thresholds.
source = """
#include <cassert>
#include <cmath>
using std::isfinite;
constexpr float DUST_LOW=1015.76f,MQ_VCC=5.0f;
struct Reading {float on,aoV;};
bool pulse(int onRaw,int width,int sampleAt){return PULSE;}
bool dust(int good,int missed,Reading d){return DUST;}
bool mq(float raw,Reading m){return GAS;}
int main(){
 assert(pulse(1,300,280) && pulse(4094,340,300));
 assert(!pulse(0,320,280) && !pulse(4095,320,280) && !pulse(10,341,280) && !pulse(10,320,301));
 assert(dust(95,0,{1458,0}) && !dust(94,0,{1458,0}) && !dust(100,1,{1458,0}));
 assert(!dust(100,0,{NAN,0}) && !dust(100,0,{500,0}));
 assert(mq(3,{0,1}) && !mq(2,{0,1}) && !mq(4090,{0,1}) && !mq(100,{0,5}));
}
""".replace("return PULSE;", "return "+expr("bool goodOn=")+";").replace(
    "return DUST;", "return "+expr("d.valid=")+";").replace("return GAS;", "return "+expr("m.valid=")+";")
exe = root / "firmware/build/sensor-check"
exe.parent.mkdir(exist_ok=True)
subprocess.run(["g++","-std=c++17","-x","c++","-","-o",str(exe)],input=source,text=True,check=True)
subprocess.run([exe],check=True)
print("PASS Sharp rail, pulse, aggregate validity and MQ voltage/ADC boundaries")
