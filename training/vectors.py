"""Generate labelled host-firmware traces. Run on Linux with g++ and NumPy."""
import ctypes
import os
import subprocess

from build import F, H, HERE, write


def oracle():
    lines = (HERE.parent / F).read_text().splitlines()
    # Only sensor types, state and inference functions. Exclude NVS/network code.
    ranges = [(18,36),(47,48),(67,90),(93,97),(100,100),(111,128),(131,144)]
    source = """
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <cstring>
using std::isfinite;
float temp, rh;
uint32_t bootMs=0;
""" + f'#include "{H}"\n' + '\n'.join(
        '\n'.join(lines[start-1:end]) for start,end in ranges)
    source += """
extern "C" void occ(unsigned ms,float ppm,float *out){
    updateOcc(ms,ppm);
    float v[]={occMean,occDelta,occSlope,occEstimate,(float)occEven,(float)occOut};
    memcpy(out,v,sizeof(v));
}
extern "C" float ridge(float d,float r){return VigilOccModel::estimate(d,r);}
extern "C" const char* gas(unsigned now,unsigned seq,int age,float rs,float t,float h,float *out){
    r0=5;x0=0;t0=25;h0=75;baselineOK=true;
    temp=t;rh=h;mq={seq,now-age,0,0,rs,true};
    updateMQModel(now);
    float v[]={mqResidual,mqZ,mqEWMA,(float)votePositive,(float)mqAlert};
    memcpy(out,v,sizeof(v));return mqStatus;
}
extern "C" void sharp(unsigned now,float on,bool valid,float *out){
    DustReading d={};d.at=now;d.on=on;d.valid=valid;filterDust(d);
    float v[]={d.filtered,d.z,(float)d.history,(float)d.ready,(float)d.high};
    memcpy(out,v,sizeof(v));
}
"""
    fd = os.memfd_create("vigil-oracle")
    try:
        path = f"/proc/{os.getpid()}/fd/{fd}"
        subprocess.run(["g++","-std=c++17","-shared","-fPIC","-I",str(HERE.parent),
                        "-x","c++","-","-o",path], input=source,text=True,check=True)
        return ctypes.CDLL(path)
    finally:
        os.close(fd)


def generate():
    import math
    lib = oracle()
    number = ctypes.c_float
    lib.gas.restype = ctypes.c_char_p
    lib.ridge.restype = number
    traces = dict(provenance="synthetic deterministic fixtures; C++ host evaluation",
                  occupancy=[], mq135=[], sharp=[])
    def values(out):
        return [v if math.isfinite(v) else None for v in out]

    # Ramp, capped high, gap reset and falling out-of-domain signal.
    history = [(i*5000,511+2*i) for i in range(18)]
    history += [(125000+i*5000,1500-60*i) for i in range(16)]
    history += [(250000+i*5000,380) for i in range(12)]
    for ms,ppm in history:
        out = (number*6)()
        lib.occ(ms,number(ppm),out)
        result = values(out)
        if result[3] is not None:
            assert abs(lib.ridge(number(result[1]),number(result[2]))-result[3]) < 1e-5
        traces["occupancy"].append(dict(ms=ms,ppm=ppm,expected=result))

    # F332 uses the firmware mean and per-minute slope only after warm-up.
    traces["linear_forecast"] = [
        dict(ms=v["ms"], expected=None if v["expected"][2] is None else
             max(0, v["expected"][0] + 10*v["expected"][2]))
        for v in traces["occupancy"]]

    traces["mq_anchor"] = dict(r0=5,x0=0,t0=25,h0=75,accepted=True)
    gas = [(100,1,0,5,25,75)] + [(600000+i*5000,i+2,0,2,26,80) for i in range(7)]
    gas += [(635000,8,0,2,26,80),(640000,9,1600,2,26,80),
            (645000,10,0,5,30,75),(675000,11,0,5,25,75)]
    for ms,seq,age,rs,t,h in gas:
        out = (number*5)()
        status = lib.gas(ms,seq,age,number(rs),number(t),number(h),out).decode()
        traces["mq135"].append(dict(ms=ms,seq=seq,age_ms=age,rs=rs,t=t,rh=h,
                                    status=status,expected=values(out)))
    for i in range(48):
        ms = 1000*(i+1) + (3000 if i>=45 else 0)
        on = 2100+i%2
        out = (number*5)()
        lib.sharp(ms,number(on),ctypes.c_bool(i!=46),out)
        traces["sharp"].append(dict(ms=ms,on_mv=on,valid=i!=46,expected=values(out)))
    traces["output_columns"] = dict(occupancy=["mean","delta","rate","estimate","even","out_of_domain"],
                                    mq135=["residual","z","ewma","positive_votes","alert"],
                                    sharp=["median","z","history","ready","persistent_high"])
    traces["forecast"] = dict(start_ppm=600, step_ppm=1, interval_ms=5000,
                              ramp_count=61, robust_expected=780,
                              evaluation_count=181, robust_mae=0,persistence_mae=120)
    return traces


if __name__ == "__main__":
    write("golden.json",generate())
