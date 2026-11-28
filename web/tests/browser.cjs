// Run against a disposable copy of the actual routes with only the owner provider exchanged.
// Playwright and Chromium are test tools supplied by the host.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require(process.env.PHASE5_PLAYWRIGHT || 'playwright-core')
const repo = path.resolve(__dirname,'../..')
const web = path.join(repo,'web')
const evidence = path.join(repo,'docs/redesign-screenshots')
const base = 'http://127.0.0.1:3987'

async function startFixture() {
  const cache = path.join(repo,'.next')
  await fs.mkdir(cache,{recursive:true})
  const root = await fs.mkdtemp(path.join(cache,'browser-'))
  const work = path.join(root,'web')
  await fs.mkdir(work)
  for (const dir of ['inputs','training']) await fs.symlink(path.join(repo,dir),path.join(root,dir),'dir')
  await fs.symlink(path.join(web,'node_modules'),path.join(work,'node_modules'),'dir')
  for (const item of ['app','ui','tests','src','public','package.json','tsconfig.json','next.config.ts']) {
    await fs.cp(path.join(web,item),path.join(work,item),{recursive:true})
  }
  const layout = path.join(work,'app/layout.tsx')
  const original = await fs.readFile(layout,'utf8')
  const fixture = original.replace("import { VigilProvider } from '../ui/live'",
    "import { FixtureProvider as VigilProvider } from '../tests/browser-fixture'")
  assert.notEqual(fixture, original, 'The isolated build uses the fixture provider')
  await fs.writeFile(layout, fixture)
  const server = spawn(process.execPath,[path.join(web,'node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p','3987'],{
    cwd:work,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:'inherit',
  })
  try {
    for(let i=0;i<120;i++){
      if(server.exitCode!==null)throw Error('Fixture server exited')
      if(await fetch(base).then(res=>res.ok).catch(()=>false))return server
      await delay(300)
    }
    throw Error('Fixture server unavailable')
  } catch(error){ server.kill(); throw error }
}

async function verify(page) {
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const routes = {welcome:'/',dashboard:'/breathe',details:'/details',settings:'/settings',calibration:'/calibrate',authentication:'/?screen=login'}
  const visit = async (url) => {
    await page.goto(base+url,{timeout:90000})
    await page.getByText('Synthetic test data',{exact:true}).waitFor()
    await page.evaluate(()=>document.fonts.ready)
    await page.addStyleTag({content:'nextjs-portal { display:none !important; }'})
  }
  const shots = new Set()
  for (const width of [1440,390,768,1024,1920]) {
    await page.setViewportSize({width,height:width===390?844:1000})
    for (const [screen,url] of Object.entries(routes)) {
      await visit(url)
      if(screen==='authentication') await page.getByLabel('Password',{exact:true}).waitFor()
      if(screen==='calibration') {
        await page.getByRole('checkbox').check()
        await page.getByRole('button',{name:'Start calibration',exact:true}).click()
        await page.getByText('34 of 60 seconds measured',{exact:false}).waitFor()
        assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'57')
        assert.equal(await page.locator('iframe').count(),0)
      }
      if(screen==='dashboard') {
        await page.getByRole('heading',{name:'Fresh',exact:true}).waitFor()
        const portrait=page.locator('.portrait img')
        await portrait.evaluate(img=>img.decode())
        assert.equal(await portrait.evaluate(img=>getComputedStyle(img).filter),'grayscale(1)')
        assert.equal(await page.locator('.fan-icon').getAttribute('data-running'),'false')
        await page.locator('.recharts-line-curve').first().waitFor()
      }
      if(screen==='details') await page.locator('.recharts-line-curve').first().waitFor()
      if(screen==='settings') await page.getByText(/Occupancy · passed/).waitFor()
      await page.locator('.brand img').evaluate(img=>img.decode())
      const checks = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().width && el.getBoundingClientRect().height)
        const text = nodes.filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim()))
        const styles = text.map(el=>getComputedStyle(el))
        return {
          overflow:document.documentElement.scrollWidth>innerWidth,
          clipped:text.filter(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+1 || r.left < -1}).map(el=>el.textContent.trim()).slice(0,4),
          type:styles.every(s=>s.fontFamily.toLowerCase().includes('syne') && s.fontWeight==='400' && s.fontStyle==='normal'),
          font:[...document.fonts].some(f=>f.family.toLowerCase().includes('syne')&&f.status==='loaded'&&f.weight==='400'),
          gradients:nodes.some(el=>['', '::before','::after'].some(p=>getComputedStyle(el,p||null).backgroundImage.includes('gradient('))),
          reduced:getComputedStyle(document.querySelector('main')).animationName,
        }
      })
      assert.deepEqual(checks,{overflow:false,clipped:[],type:true,font:true,gradients:false,reduced:'none'},screen+' '+width+' '+JSON.stringify(checks))
      if([390,1440].includes(width) || screen==='dashboard'){
        const name=screen+'-'+width+'.png'
        await page.screenshot({path:path.join(evidence,name),fullPage:true,animations:'disabled'})
        shots.add(name)
      }
    }
    console.log('PASS six screens at '+width+'px')
  }
  await visit('/breathe')
  await page.getByRole('button',{name:'Off',exact:true}).click()
  await page.getByText('Off requested. Waiting for device telemetry.').waitFor()
  await visit('/breathe?screen=fail')
  await page.getByRole('button',{name:'Freshen now',exact:true}).click()
  await page.getByText(/command could not be confirmed/).waitFor()
  await page.getByRole('button',{name:'Retry command'}).click()
  await page.getByText(/Freshen now requested/).waitFor()
  await page.emulateMedia({reducedMotion:'no-preference'})
  await visit('/breathe?screen=override')
  await page.getByText(/Local CO₂ safety takes precedence/).waitFor()
  assert.equal(await page.locator('.fan-icon svg').evaluate(el=>getComputedStyle(el).animationName),'turn')
  await page.emulateMedia({reducedMotion:'reduce'})
  assert.equal(await page.locator('.fan-icon svg').evaluate(el=>getComputedStyle(el).animationName),'none')
  await visit('/breathe?screen=stale')
  await page.getByRole('heading',{name:'Unavailable',exact:true}).waitFor()
  await page.getByText(/Last valid CO₂/).waitFor()
  assert.equal(await page.locator('.reading-change,.signal[data-live=true],.fan-icon[data-running=true]').count(),0)
  await visit('/breathe?screen=missing')
  await page.getByText('Waiting for device',{exact:true}).waitFor()
  await visit('/calibrate')
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Start calibration',exact:true}).click()
  await page.getByRole('button',{name:'Abort calibration'}).click()
  await page.getByRole('heading',{name:'Calibration aborted'}).waitFor()
  await visit('/?screen=login')
  await page.getByLabel('Email',{exact:true}).fill('owner@example.invalid')
  await page.getByLabel('Password',{exact:true}).fill('synthetic')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Sign-in failed'}).waitFor()
  await visit('/?screen=blocked')
  await page.getByRole('heading',{name:'Owner access required'}).waitFor()
  await visit('/')
  await page.getByRole('heading',{name:/Take a breath/}).waitFor()
  for(let i=0;i<5&&!await page.locator('.skip').evaluate(n=>n===document.activeElement);i++)await page.keyboard.press('Tab')
  assert(await page.locator('.skip').evaluate(n=>n===document.activeElement))
  await page.getByRole('link',{name:'Breathe',exact:true}).click()
  await page.getByRole('navigation').getByRole('link',{name:'Monitor',exact:true}).waitFor()
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.locator('.nav-indicator').evaluate(n=>window.testIndicator=n)
  await page.getByRole('navigation').getByRole('link',{name:'Details',exact:true}).click()
  await page.getByRole('heading',{name:'Air in detail',exact:true}).waitFor()
  assert(await page.locator('.nav-indicator').evaluate(n=>n===window.testIndicator && getComputedStyle(n).transitionProperty.includes('transform')))
  await page.getByText('No matched forecast observations are available.').waitFor()
  const download = page.waitForEvent('download')
  await page.getByRole('button',{name:'Download CSV',exact:true}).click()
  assert.match((await download).suggestedFilename(),/^synthetic-/)
  await page.locator('.account summary').click()
  await page.locator('.account').getByRole('link',{name:'Settings'}).click()
  await page.getByText(/Occupancy · passed/).click()
  await page.getByRole('button',{name:'Restore previous calibration'}).click()
  await page.getByRole('button',{name:'Confirm restore'}).click()
  await page.getByText('Previous version restored.').waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS navigation, account, auth, stale/missing telemetry, guarded fan motion, requests/retry, calibration start/abort, analytics, CSV and rollback. '+shots.size+' screenshots.')
}

;(async()=>{
  await fs.mkdir(evidence,{recursive:true})
  const server=await startFixture()
  let browser
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']})
    const page=await browser.newPage({reducedMotion:'reduce',timezoneId:'UTC',locale:'en-US'})
    await verify(page)
  } finally {
    if(browser)await browser.close()
    server.kill()
  }
})().catch(error=>{console.error(error);process.exitCode=1})
