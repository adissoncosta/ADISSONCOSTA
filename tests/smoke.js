const { chromium } = require('playwright');
const assert = (c,m) => { console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:375,height:760}});
  // Relógio fixo para o teste não depender da data real
  const fixClock = iso => `(()=>{const R=Date,t=new R('${iso}').getTime();Date=class extends R{constructor(...a){super(...(a.length?a:[t]))}static now(){return t}}})()`;
  await ctx.addInitScript(fixClock('2026-11-02T12:00:00'));
  const p = await ctx.newPage(); const errs=[];
  p.on('pageerror', e => errs.push(e.message));
  const url='file://'+require("path").resolve(__dirname,"../index.html");
  await p.goto(url); await p.waitForTimeout(300);
  // miles tab: VCP→LIM (5/11) still valid on 02/11; clicking a miles deal sets one-way + date
  await p.click('#tabMiles');
  const titles = await p.$$eval('.deal h3', a=>a.map(x=>x.textContent));
  assert(titles.length===6, 'miles deals shown: '+titles.length);
  await p.click('.deal button[data-i="1"]');
  let st = await p.evaluate(()=>({from:from.value,to:to.value,dep:dep.value,ow:ow.getAttribute('aria-pressed'),ret:ret.disabled,sum:summary.textContent}));
  assert(st.from==='FLN'&&st.to==='AEP'&&st.dep==='2026-12-15'&&st.ow==='true'&&st.ret, 'miles deal fills one-way + date: '+st.sum);
  // cash deal returns to round trip
  await p.click('#tabCash'); await p.click('.deal button[data-i="3"]');
  st = await p.evaluate(()=>({rt:rt.getAttribute('aria-pressed'),sum:summary.textContent}));
  assert(st.rt==='true', 'cash deal sets round trip: '+st.sum);
  // last-day badge on CWB→POA (until 2026-11-02 == today)
  assert(await p.$$eval('.deal li', a=>a.some(x=>x.textContent==='Último dia da oferta')), 'last-day badge');
  // past date -> error and links disabled
  await p.fill('#dep','2020-01-01'); await p.dispatchEvent('#dep','change');
  st = await p.evaluate(()=>({err:err.textContent,pe:document.querySelector('.results').style.pointerEvents}));
  assert(/já passou/.test(st.err) && st.pe==='none', 'past date blocked: '+st.err);
  // persistence: valid search survives reload
  await p.fill('#dep','2027-03-10'); await p.dispatchEvent('#dep','change');
  await p.fill('#from','REC'); await p.dispatchEvent('#from','input');
  await p.reload(); await p.waitForTimeout(300);
  st = await p.evaluate(()=>summary.textContent);
  assert(/^REC → MCO · 10\/03\/2027/.test(st), 'search restored: '+st);
  // expiry: fake clock after 2026-11-17 hides expired deals
  const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
  await p2.addInitScript(fixClock('2026-11-20T12:00:00'));
  await p2.goto(url); await p2.click('#tabMiles');
  const m2 = await p2.$$eval('.deal h3', a=>a.map(x=>x.textContent));
  assert(m2.length===3, 'expired miles deals hidden on 20/11: '+m2.length);
  // chart scale
  await p.fill('#tMonths input >> nth=0','4.400'); await p.dispatchEvent('#tMonths input >> nth=0','change');
  const axis = await p.$$eval('#tChart .axis', a=>a.map(x=>x.textContent));
  assert(axis.includes('R$ 6.000') && !axis.includes('R$ 8.000'), 'chart y-max 6000 for 4400');
  assert(errs.length===0, 'no page errors '+errs.join(';'));
  await b.close();
})();
