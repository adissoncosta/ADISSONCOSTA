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
  // ---- preços lidos nos sites das companhias (navegador do app Claude simulado) ----
  const ctxLive = await b.newContext({viewport:{width:375,height:760}});
  await ctxLive.addInitScript(fixClock('2026-11-02T12:00:00'));
  await ctxLive.addInitScript(() => {
    window.RADAR_WAIT_MS = 10;
    const PAGES = {'latamairlines':'Voos a partir de R$ 1.250,90 por pessoa', 'voegol':'Menor tarifa R$ 980 ida e volta. Normalmente custa R$ 700 a R$ 900', 'voeazul':'Não encontramos voos'};
    let cur = '';
    window.claude = {use: async cap => cap === 'mcp' ? {
      listTools: async () => ({servers:[{server:'host:claude_browser'}]}),
      callTool: async (srv, tool, args) => {
        if(tool === 'preview_start' || tool === 'navigate'){ cur = args.url; return {payload:{tabId:7}}; }
        const k = Object.keys(PAGES).find(h => cur.includes(h));
        return {content:[{type:'text', text: k ? PAGES[k] : ''}]};
      }} : null};
  });
  const pl = await ctxLive.newPage(); const errsL = []; pl.on('pageerror', e => errsL.push(e.message));
  await pl.goto(url); await pl.waitForTimeout(300);
  await pl.fill('#from','CGH'); await pl.dispatchEvent('#from','input');
  await pl.fill('#to','SSA'); await pl.dispatchEvent('#to','input');
  await pl.fill('#dep','2026-12-10'); await pl.dispatchEvent('#dep','change');
  await pl.fill('#ret','2026-12-17'); await pl.dispatchEvent('#ret','change');
  await pl.click('#liveBtn');
  await pl.waitForFunction(() => !liveRun, null, {timeout:15000});
  const cards = await pl.$$eval('#cash a.go', a => a.map(x => ({n:x.querySelector('strong').childNodes[0].textContent, lp:(x.querySelector('.lp')||{}).textContent||'', best:x.classList.contains('best')})));
  assert(cards.map(c=>c.n).join()==='GOL,LATAM,Azul', 'cash cards sorted by site price: '+cards.map(c=>c.n+' '+c.lp).join(' | '));
  assert(/980/.test(cards[0].lp) && /1\.250,90/.test(cards[1].lp) && cards[0].best && !cards[1].best, 'prices shown, cheapest highlighted (ignores "normalmente custa")');
  assert(/não mostrou preço/.test(cards[2].lp), 'carrier without price marked');
  await pl.reload(); await pl.waitForTimeout(300);
  const after = await pl.$$eval('#cash strong', a => a.map(x => x.childNodes[0].textContent));
  assert(after.join()==='GOL,LATAM,Azul', 'site prices kept after reload: '+after);
  assert(errsL.length===0, 'no page errors with live prices '+errsL.join(';'));
  // ---- Suas rotas ----
  await pl.evaluate(() => localStorage.removeItem('radar-rotas')); await pl.reload(); await pl.waitForTimeout(300);
  assert(await pl.$('#favEmpty') !== null, 'empty routes message');
  await pl.fill('#favFrom','recife'); await pl.dispatchEvent('#favFrom','input'); await pl.keyboard.press('Enter');
  await pl.fill('#favTo','lisboa'); await pl.dispatchEvent('#favTo','input'); await pl.keyboard.press('Enter');
  await pl.click('#favForm button[type=submit]');
  let favTxt = await pl.$$eval('.fav .city', a => a.map(x => x.textContent.trim()));
  assert(favTxt.length===1 && /Lisboa/.test(favTxt[0]), 'route added from form: '+favTxt+' / '+await pl.textContent('#favMsg'));
  await pl.click('#favForm button[type=submit]');
  assert(/Escolha/.test(await pl.textContent('#favMsg')), 'empty form asks to choose');
  // CGH→SSA tem preço lido nos sites: salvar pelo botão da busca mostra o preço no cartão
  await pl.click('#saveFav');
  assert(await pl.getAttribute('#saveFav','aria-pressed')==='true', 'save current search toggles on');
  await pl.reload(); await pl.waitForTimeout(300);
  const favs = await pl.$$eval('.fav', a => a.map(x => x.querySelector('.city').textContent.trim()+' | '+x.querySelector('.info').textContent.trim()));
  assert(favs.length===2 && /Salvador/.test(favs[0]) && /R\$\s980/.test(favs[0]) && /Lisboa/.test(favs[1]), 'routes persist, newest first, with site price: '+favs.join(' || '));
  await pl.click('.fav button[data-f="1"]');
  const st2 = await pl.evaluate(() => from.value+'>'+to.value);
  assert(st2==='REC>LIS', 'tapping a route fills the search: '+st2);
  await pl.click('.fav button[data-rm="1"]');
  assert((await pl.$$('.fav')).length===1, 'route removed');
  // promoções: foto grande com destino, origem e preço
  const deal = await pl.$eval('.deal', x => ({city:x.querySelector('.city').textContent.trim(), orig:x.querySelector('.orig').textContent.trim(), price:x.querySelector('.price').textContent}));
  assert(deal.city.startsWith('Salvador') && /Saindo de várias cidades/.test(deal.orig) && /R\$ 267/.test(deal.price), 'deal card shows destination, origin and price: '+JSON.stringify(deal));
  const wide = await pl.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert(wide, 'no horizontal page scroll at 375px');
  assert(errsL.length===0, 'no page errors with routes '+errsL.join(';'));
  await b.close();
})();
