'use client'

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type ChartRow = {t:number,[series:string]:number|null}
type Series = {key:string,label:string,colour:string,dash?:string}
const forest='var(--text)'

export function Chart({title,unit,rows,series,compact=false,animate=true}: {title:string,unit:string,rows:ChartRow[],series:Series[],compact?:boolean,animate?:boolean}) {
  // Keep each series on its own time grid. Gap-only rows break every line.
  const dataByKey = useMemo(() => {
    const keys = new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 't')))
    return Object.fromEntries([...keys].map(key => [key, rows.filter(row =>
      Object.hasOwn(row,key) || Object.keys(row).length === 1)]))
  }, [rows])
  const available=rows.some(row=>series.some(({key})=>row[key]!=null))
  return <section className={compact ? "chart compact-chart" : "chart"} aria-label={title}>
    {!compact && <h3>{title}</h3>}
    {!available?<p className="empty">No observations in this session window.</p>:<>
      {!compact && <div className="chart-legend">{series.map(entry=><span key={entry.key}><span className="legend-mark" style={{borderTopColor:entry.colour,borderTopStyle:entry.dash?'dashed':'solid'}} aria-hidden="true"/>{entry.label}</span>)}</div>}
      <div className="plot">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:480,height:215}}>
          <LineChart data={rows} accessibilityLayer margin={{left:0,right:12,top:8,bottom:4}}>
            <CartesianGrid vertical={false} stroke="var(--soft-rule)" />
            <XAxis dataKey="t" type="number" domain={['dataMin','dataMax']} tickFormatter={t=>Math.round(t/60000)+'m'}
              tick={{fontSize:12,fill:'var(--muted)'}} axisLine={false} tickLine={false} minTickGap={28}/>
            <YAxis width={40} domain={['auto','auto']} tick={{fontSize:12,fill:'var(--muted)'}} axisLine={false} tickLine={false}/>
            <Tooltip labelFormatter={t=>'Device uptime '+(Number(t)/60000).toFixed(1)+' min'}
              formatter={(value,name)=>[typeof value==='number'?value.toFixed(1)+' '+unit:value,name]}
              contentStyle={{background:'var(--background)',color:forest,border:'1px solid var(--rule)',borderRadius:12,boxShadow:'none'}}/>
            {series.map(s=><Line key={s.key} data={dataByKey[s.key]} dataKey={s.key} name={s.label} stroke={s.colour} strokeDasharray={s.dash}
              strokeWidth={1.35} dot={rows.length===1 ? {r:2} : false} activeDot={{r:3}} animationDuration={360} isAnimationActive={animate ? 'auto' : false} connectNulls={false}/>)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>}
  </section>
}
