import {describe,it,expect} from 'vitest'
import g from '../../training/golden.json'
import {gasState,dustState,gasStep,dustStep,occupancyStep,signature,predict,type Point} from '../src/models'
import {initial,match,metrics} from '../src/engine'
function compare(actual:(number|null)[],expected:(number|null)[],tolerance:number){
  expect(actual.length).toBe(expected.length)
  actual.forEach((v,i)=>{if(expected[i]===null)expect(v).toBeNull();else {expect(v).not.toBeNull();expect(Math.abs(v!-expected[i]!)).toBeLessThanOrEqual(tolerance)}})
}
describe('unchanged Phase 1 golden traces',()=>{
  it('46 occupancy and 46 linear outputs',()=>{
    const h:Point[]=[]
    for(const [i,v] of g.occupancy.entries()){
      const o=occupancyStep(h,v.ms,v.ppm)
      compare([o.mean,o.delta,o.rate,o.estimate,o.even,+o.outside],v.expected,1e-4)
      compare([predict(h,o).linear],[g.linear_forecast[i].expected],1e-4)
    }
  })
  it('12 MQ scores, statuses, votes and resets',()=>{
    const s=gasState()
    for(const v of g.mq135){
      const r=gasStep(s,v.ms,v.seq,v.age_ms,v.rs,v.t,v.rh,{...g.mq_anchor,model_sig:signature()})
      compare([r.residual,r.z,r.ewma,r.positive,+r.alert],v.expected,1e-5);expect(r.status).toBe(v.status)
    }
  })
  it('48 Sharp aggregates including invalid rows',()=>{
    const s=dustState()
    for(const v of g.sharp){
      const r=dustStep(s,v.ms,v.on_mv,v.valid)
      compare([r.filtered,r.z,r.history,+r.ready,+r.high],v.expected,1e-5)
    }
  })
  it('legacy ramp, exact targets and signed matched metrics',()=>{
    const s=initial(),gld=g.forecast,history:Point[]=[]
    for(let i=0;i<gld.evaluation_count;i++){
      const t=i*gld.interval_ms,y=gld.start_ppm+i*gld.step_ppm
      match(s,t,y);history.push({t,y})
      const f=predict(history.slice(-61),occupancyStep(s.occ,t,y))
      if(i===gld.ramp_count-1)expect(f.robust).toBe(gld.robust_expected)
      s.pending.push({target:t+600000,prediction:f})
    }
    expect(metrics(s).robust).toEqual({n:1,mae:0,rmse:0,bias:0})
    expect(metrics(s).persistence.mae).toBe(gld.persistence_mae)
    expect(metrics(s).persistence.bias).toBe(-120)
    match(s,9999999,800);expect(s.missed).toBeGreaterThan(0)
  })
})
