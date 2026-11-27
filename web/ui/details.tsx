'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, useRead } from './actions'
import { Frame } from './frame'
import { useVigil } from './live'
import { ages, reasons, statusOf } from './state'
import forecastSpec from '../../training/specs/forecast.json'
import type { Analytics } from '../src/readback'

const number=(v:number|null|undefined,digits=1)=>v==null?'—':v.toFixed(digits)
type ChartRow = {t:number,[series:string]:number|null}
type Series = {key:string,label:string,colour:string,dash?:string}
const forest='var(--text)', sage='var(--status-fresh)', amber='var(--status-stuffy)', rose='var(--status-poor)'

function Chart({title,unit,rows,series}: {title:string,unit:string,rows:ChartRow[],series:Series[]}) {
  const available=rows.some(row=>series.some(({key})=>row[key]!=null))
  return <section className="chart" aria-label={title}>
    <h3>{title}</h3>
    {!available?<p className="empty">No observations in this session window.</p>:<>
      <div className="chart-legend">{series.map(entry=><span key={entry.key}><i style={{borderColor:entry.colour,borderStyle:entry.dash?'dashed':'solid'}}/>{entry.label}</span>)}</div>
      <div className="plot">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:480,height:230}}>
          <LineChart data={rows} accessibilityLayer margin={{left:0,right:12,top:8,bottom:4}}>
            <CartesianGrid vertical={false} stroke="var(--surface)"/>
            <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tickFormatter={t=>Math.round(t/60000)+'m'}
              tick={{fontSize:12,fill:forest}} minTickGap={28}/>
            <YAxis width={50} domain={['auto','auto']} tick={{fontSize:12,fill:forest}}/>
            <Tooltip labelFormatter={t=>'Device uptime '+(Number(t)/60000).toFixed(1)+' min'}
              formatter={(value,name)=>[typeof value==='number'?value.toFixed(1)+' '+unit:value,name]}
              contentStyle={{background:'var(--background)',color:forest,borderColor:'var(--surface)'}}/>
            {series.map(s=><Line key={s.key} data={rows.filter(row=>Object.hasOwn(row,s.key))} dataKey={s.key} name={s.label} stroke={s.colour} strokeDasharray={s.dash}
              strokeWidth={2} dot={false} activeDot={{r:4}} isAnimationActive={false} connectNulls={false}/>)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>}
  </section>
}

function points(archive:Analytics|null){
  const recent=archive?.rows??[]
  let previous=recent[0]?.t ?? 0
  const readings:ChartRow[]=recent.flatMap(row=>{
    const point={t:row.t,co2:row.co2,people:row.people,temp:row.temperature,rh:row.humidity,
      on:row.dustOn,filtered:row.dustFiltered}
    const output:ChartRow[]=row.gap? [{t:(previous+row.t)/2},point] : [point]
    previous=row.t
    return output
  })
  const target=new Map<number,ChartRow>()
  let lastScd:number|null=null
  let observedAt:number|null=null
  for(const row of recent){
    if(row.co2===null || row.scd===lastScd) continue
    lastScd=row.scd
    const at=row.t-((row.t-row.scd)>>>0)
    if(observedAt!==null && (row.gap || at-observedAt>ages.control)){
      const gap=(observedAt+at)/2
      target.set(gap,{...target.get(gap),t:gap,observed:null})
    }
    observedAt=at
    target.set(at,{...target.get(at),t:at,observed:row.co2})
    if(row.forecast){
      const future=at+forecastSpec.horizon_minutes*60000
      target.set(future,{...target.get(future),t:future,...row.forecast})
    }
  }
  return {readings,forecasts:[...target.values()].sort((a,b)=>a.t-b.t)}
}

function DetailsPanel() {
  const {latest, connected, now}=useVigil()
  const live=statusOf(latest,now,connected)
  const data=useRead<Analytics>(latest?'/api/export/'+latest.boot_id+'?view=analytics':null)
  const charts=useMemo(()=>points(data.data),[data.data])
  const sample=latest?.sample
  const metrics=data.data?.versions ? data.data.metrics : undefined
  const fanChanges=(data.data?.rows??[]).filter((row,i,all)=>i===0 || row.fan!==all[i-1].fan || row.fanReason!==all[i-1].fanReason).slice(-8).reverse()
  return <div className="page-section">
    <div className="page-heading"><p className="eyebrow">Room observations</p><h1>Air in detail</h1>
      <p>Explore the measurements behind VIGIL’s room status.</p>
      <div className="actions">
        {latest&&<Download id={latest.boot_id}/>}
        {latest&&<button className="button" onClick={data.reload}>Refresh history</button>}
        <Link className="button" href="/settings">Models &amp; calibration ↗</Link>
      </div>
    </div>
    {data.error&&<p className="notice" role="alert">{data.error}</p>}
    {data.pending&&<p role="status">Loading history…</p>}
    {!latest&&<p className="notice">History will appear after the first available device session.</p>}
    {data.data?.rows.length===0&&<p className="notice">No observations in this history window.</p>}
    {latest&&!live.deviceLive&&<p className="notice">The device is offline. History and the last reported snapshot are shown below.</p>}
    <div className="section-heading"><h2>Measurement history</h2><p>Latest hour of this boot · time since device start</p></div>
    <div className="chart-grid">
      <Chart title="CO₂" unit="ppm" rows={charts.readings} series={[{key:'co2',label:'Observed',colour:forest}]}/>
      <Chart title="Approximate occupancy" unit="people" rows={charts.readings} series={[{key:'people',label:'Model estimate',colour:forest}]}/>
      <Chart title="Temperature" unit="°C" rows={charts.readings} series={[{key:'temp',label:'Observed',colour:forest}]}/>
      <Chart title="Relative humidity" unit="% RH" rows={charts.readings} series={[{key:'rh',label:'Observed',colour:forest}]}/>
    </div>
    <div className="section-heading"><h2>10-minute CO₂ forecast</h2><p>Predictions are positioned at their target time. Observations are solid and forecast methods are dashed.</p></div>
    <Chart title="Forecast versus observations" unit="ppm" rows={charts.forecasts}
      series={[{key:'observed',label:'Observed',colour:forest},{key:'persistence',label:'Persistence',colour:sage,dash:'4 4'},
        {key:'linear',label:'Linear',colour:amber,dash:'6 3'},{key:'robust',label:'Robust',colour:rose,dash:'2 3'}]}/>
    {latest?.forecast&&<dl className="value-list forecasts">
      {Object.entries(latest.forecast).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{live.co2!==null&&value!=null?number(value,0)+' ppm':'—'}</dd></div>)}
    </dl>}
    <div className="data-table"><table><caption>Matched forecast error · current model window</caption>
      <thead><tr><th>Method</th><th>Matches</th><th>MAE</th><th>RMSE</th><th>Bias</th></tr></thead>
      <tbody>{['persistence','linear','robust'].map(method=>{
        const result=metrics?.[method]
        return <tr key={method}><th scope="row">{method}</th><td>{result?.n??'—'}</td>
          {[result?.mae,result?.rmse,result?.bias].map((value,index)=><td key={index}>{result?.n?number(value)+' ppm':'—'}</td>)}</tr>
      })}</tbody>
    </table></div>
    {!Object.values(metrics??{}).some(metric=>metric.n>0)&&<p className="support">No matched forecast observations are available.</p>}
    <div className="section-heading"><h2>Sensor response</h2><p>Last reported values and validity flags</p></div>
    <details className="disclosure"><summary>CO₂ and climate</summary><dl className="value-list">
      <div><dt>CO₂</dt><dd>{number(sample?.scd40.co2_ppm,0)} ppm</dd></div>
      <div><dt>Temperature</dt><dd>{number(sample?.scd40.temperature_c)} °C</dd></div>
      <div><dt>Relative humidity</dt><dd>{number(sample?.scd40.rh_pct)}%</dd></div>
      <div><dt>Observation</dt><dd>{live.co2!==null?'Current':sample?.scd40.valid?'Stale':'Unavailable'}</dd></div>
    </dl></details>
    <details className="disclosure"><summary>Fumes · MQ135 gas response</summary><dl className="value-list">
      <div><dt>ADC mean</dt><dd>{number(sample?.mq135.adc_raw)}</dd></div>
      <div><dt>GPIO voltage</dt><dd>{number(sample?.mq135.gpio_v,3)} V</dd></div>
      <div><dt>Sensor voltage</dt><dd>{number(sample?.mq135.ao_v,3)} V</dd></div>
      <div><dt>Resistance</dt><dd>{number(sample?.mq135.rs_kohm,3)} kΩ</dd></div>
      <div><dt>Residual</dt><dd>{number(latest?.gas?.residual,4)}</dd></div>
      <div><dt>Robust score</dt><dd>{number(latest?.gas?.z,3)}</dd></div>
      <div><dt>Smoothed score</dt><dd>{number(latest?.gas?.ewma,3)}</dd></div>
      <div><dt>Current response</dt><dd>{live.fumes}</dd></div>
    </dl></details>
    <details className="disclosure"><summary>Dust · Sharp optical response</summary><dl className="value-list">
      <div><dt>Raw ON</dt><dd>{number(sample?.sharp.on_mv)} mV</dd></div>
      <div><dt>Filtered ON</dt><dd>{number(latest?.dust.filtered)} mV</dd></div>
      <div><dt>Raw OFF</dt><dd>{number(sample?.sharp.off_mv)} mV</dd></div>
      <div><dt>ON − OFF</dt><dd>{number(sample?.sharp.delta_mv)} mV</dd></div>
      <div><dt>Maximum pulse</dt><dd>{number(sample?.sharp.max_pulse_us,0)} µs</dd></div>
      <div><dt>Current response</dt><dd>{live.optical}</dd></div>
    </dl>
    <Chart title="Raw and filtered optical response" unit="mV" rows={charts.readings}
      series={[{key:'on',label:'Observed ON',colour:forest},{key:'filtered',label:'Filtered ON',colour:sage}]}/></details>
    <details className="disclosure"><summary>Fan operation</summary>
      {fanChanges.length?<ul className="event-list">{fanChanges.map(row=><li key={row.t}>
        <strong>{(row.t/60000).toFixed(1)} min · {row.fan?'On':'Off'}</strong> {reasons[row.fanReason]??row.fanReason}
      </li>)}</ul>:<p>No reported fan events in this history window.</p>}
      <p className="support">Requested mode is shown on the monitor. Command history is unavailable.</p>
    </details>
  </div>
}
export function Details() {return <Frame><DetailsPanel/></Frame>}
