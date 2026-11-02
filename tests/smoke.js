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
  // ---- busca por cidade ----
  await p.reload(); await p.waitForTimeout(200);
  await p.click('#to'); await p.keyboard.type('salvador');
  let opts = await p.$$eval('#toList li[data-c]', a=>a.map(x=>x.dataset.c));
  assert(opts[0]==='SSA', 'typing "salvador" suggests SSA: '+opts.join(','));
  await p.keyboard.press('Enter');
  assert(await p.inputValue('#to')==='SSA' && await p.textContent('#toName')==='Salvador', 'Enter picks SSA');
  await p.fill('#from',''); await p.click('#from'); await p.keyboard.type('sao paulo');
  opts = await p.$$eval('#fromList li[data-c]', a=>a.map(x=>x.dataset.c));
  assert(['GRU','CGH','VCP'].every(c=>opts.includes(c)), 'São Paulo lists GRU/CGH/VCP: '+opts.join(','));
  assert(/Escolha/.test(await p.textContent('#err')), 'ambiguous city asks to choose');
  await p.click('#fromList li[data-c="CGH"]');
  assert(await p.inputValue('#from')==='CGH', 'click picks CGH');
  for (const [q,c] of [['floripa','FLN'],['lisboa','LIS'],['nova york','EWR'],['toquio','HND'],['Brasília','BSB'],['bh','CNF'],['disney','MCO']]) {
    const r = await p.evaluate(q=>searchAirports(q), q);
    assert(r.includes(c), `"${q}" finds ${c}: ${r.join(',')}`);
  }
  // ---- links de compra direto nas companhias ----
  const hosts = async () => p.$$eval('.results a[href^="http"], .deals a[href^="http"], #trend a[href^="http"]', a=>[...new Set(a.map(x=>new URL(x.href).hostname))]);
  const THIRD = /google|skyscanner|kayak|momondo|seats\.aero|melhoresdestinos|pontospravoar/;
  let h = await hosts();
  assert(!h.some(x=>THIRD.test(x)), 'no third-party links: '+h.join(','));
  let names = await p.$$eval('#cash strong', a=>a.map(x=>x.textContent));
  assert(names.join()==='LATAM,GOL,Azul', 'CGH→SSA carriers: '+names);
  const latam = await p.getAttribute('#cash a >> nth=0','href');
  assert(/latamairlines\.com\/br\/pt\/oferta-voos\?origin=CGH&.*destination=SSA&.*trip=RT/.test(latam), 'LATAM deep link prefilled');
  await p.click('#ow');
  const azul = await p.getAttribute('#cash a >> nth=2','href');
  assert(/voeazul.*c\[0\]\.ds=CGH.*c\[0\]\.as=SSA/.test(azul) && !azul.includes('c[1]'), 'Azul one-way link');
  await p.fill('#to','LIS'); await p.dispatchEvent('#to','input'); await p.click('#rt');
  names = await p.$$eval('#cash strong', a=>a.map(x=>x.textContent));
  assert(names[0]==='LATAM' && names.includes('Azul') && names.includes('TAP Air Portugal') && !names.includes('GOL'), 'CGH→LIS carriers: '+names);
  const miles = await p.$$eval('#miles strong', a=>a.map(x=>x.textContent));
  assert(miles.length===3 && miles.includes('Smiles'), 'miles programs: '+miles);
  // oferta em milhas abre o programa com a data da oferta
  await p.click('#tabMiles');
  const buy = await p.$('.deal a[data-buy="1"]'); await buy.dispatchEvent('pointerdown');
  const smiles = await buy.getAttribute('href');
  assert(/smiles\.com\.br.*originAirport=FLN.*destinationAirport=AEP/.test(smiles) && smiles.includes(String(new Date('2026-12-15T12:00:00').getTime())), 'miles deal → Smiles link with deal date');
  h = await hosts();
  assert(!h.some(x=>THIRD.test(x)), 'no third-party links after interactions: '+h.join(','));
  assert(errs.length===0, 'no page errors '+errs.join(';'));
  await b.close();
})();
