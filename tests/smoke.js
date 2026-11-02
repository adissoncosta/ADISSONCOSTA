// Navegador do teste: BROWSER=chromium (padrão, Chrome/Edge), firefox ou webkit (Safari)
const BROWSER = process.env.BROWSER || 'chromium';
const engine = require('playwright')[BROWSER];
if(!engine) throw new Error('BROWSER inválido: '+BROWSER+' (use chromium, firefox ou webkit)');
const assert = (c,m) => { console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1; };
(async () => {
  console.log('Navegador: '+BROWSER);
  const b = await engine.launch();
  // Por padrão a página roda sem servidor de preços (resultados previsíveis); o bloco do
  // servidor simulado liga um endereço próprio depois deste script.
  const newContext = b.newContext.bind(b);
  b.newContext = async (...args) => { const c = await newContext(...args); await c.addInitScript(() => { if(!('RADAR_API' in window)) window.RADAR_API = ''; }); return c; };
  const ctx = await b.newContext({viewport:{width:375,height:760}});
  // Relógio fixo para o teste não depender da data real
  const fixClock = iso => `(()=>{const R=Date,t=new R('${iso}').getTime();Date=class extends R{constructor(...a){super(...(a.length?a:[t]))}static now(){return t}}})()`;
  await ctx.addInitScript(fixClock('2026-11-02T12:00:00'));
  const p = await ctx.newPage(); const errs=[];
  p.on('pageerror', e => errs.push(e.message));
  // SITE_URL testa o site publicado (ex.: https://adissoncosta.github.io/ADISSONCOSTA/); sem ela, o arquivo local
  const url=process.env.SITE_URL||'file://'+require("path").resolve(__dirname,"../index.html");
  await p.goto(url); await p.waitForTimeout(300);
  // miles tab: VCP→LIM (5/11) still valid on 02/11; clicking a miles deal sets one-way + date
  await p.click('#tabMiles');
  const titles = await p.$$eval('.deal h3', a=>a.map(x=>x.textContent));
  assert(titles.length===6, 'miles deals shown: '+titles.length);
  const grp = async () => p.evaluate(() => ['nat','int'].map(id => [...document.querySelectorAll('#deals-'+id+' .deal')].map(x => x.querySelector('.city').textContent.trim().split(' ')[0]).join(',')));
  let gm = await grp();
  assert(gm[0]==='Passo' && gm[1].split(',').length===5, 'miles deals split national/international: '+gm.join(' / '));
  await p.click('.deal button[data-i="3"]');
  let st = await p.evaluate(()=>({from:from.value,to:to.value,dep:dep.value,ow:ow.getAttribute('aria-pressed'),ret:ret.disabled,sum:summary.textContent}));
  assert(st.from==='FLN'&&st.to==='AEP'&&st.dep==='2026-12-15'&&st.ow==='true'&&st.ret, 'miles deal fills one-way + date: '+st.sum);
  // cash deal returns to round trip
  await p.click('#tabCash');
  gm = await grp();
  assert(gm[0]==='Ribeirão,Florianópolis,Porto,Salvador' && gm[1].split(',').length===4 && !/Ribeirão|Florianópolis|Salvador/.test(gm[1]), 'cash deals split national/international: '+gm.join(' / '));
  // um logotipo só por oferta: o da companhia do menor preço
  const whos = await p.$$eval('#deals .deal .who', a => a.map(x => x.querySelectorAll('.logos img').length+':'+x.querySelector('span:not([class])').textContent));
  assert(whos.length===8 && whos.every(w => w.startsWith('1:')) && !whos.some(w => /Várias|,| e /.test(w)), 'one airline logo per cash deal: '+whos.join(' | '));
  assert(whos[0]==='1:LATAM' && whos[3]==='1:Azul' && whos[4]==='1:Avianca', 'cheapest airline per deal: '+whos.join(' | '));
  const logoOk = await p.$$eval('#deals .logos img', a => a.every(i => i.complete && i.naturalWidth > 0));
  assert(logoOk, 'logo images load');
  await p.click('.deal button[data-i="4"]');
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
  assert(m2.length===5, 'expired miles deals hidden on 20/11: '+m2.length);
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
  // cidades com mais de um aeroporto: código do aeroporto ou da cidade lista todos
  for(const [q, exp] of [['GRU','GRU,CGH,VCP'],['CGH','CGH,GRU,VCP'],['SAO','GRU,CGH,VCP'],['sao paulo','GRU,CGH,VCP'],['RIO','GIG,SDU'],['SDU','SDU,GIG'],['NYC','JFK,EWR'],['EWR','EWR,JFK'],['BUE','EZE,AEP'],['TYO','NRT,HND'],['toquio','NRT,HND']]){
    const r = (await p.evaluate(q=>searchAirports(q), q)).join(',');
    assert(r.startsWith(exp), `"${q}" lists all city airports: ${r}`);
  }
  assert(await p.evaluate(() => codeOf('GRU')==='GRU' && codeOf('SAO')==='' && codeOf('salvador')==='SSA'), 'airport code picks it; city code asks to choose');
  await p.fill('#to',''); await p.click('#to'); await p.keyboard.type('gru');
  opts = await p.$$eval('#toList li[data-c]', a=>a.map(x=>x.dataset.c));
  assert(opts.join(',')==='GRU,CGH,VCP', 'typing an airport code shows the other airports of the city: '+opts);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  assert(await p.inputValue('#to')==='CGH', 'can pick another airport of the same city');
  await p.fill('#to','SSA'); await p.dispatchEvent('#to','input');
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
  const buy = await p.$('.deal a[data-buy="3"]'); await buy.dispatchEvent('pointerdown');
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
  assert(await pl.isHidden('#savedWrap'), 'saved routes hidden when empty');
  // CGH→SSA tem preço lido nos sites: salvar pelo botão da busca mostra o preço no cartão
  await pl.click('#saveFav');
  assert(await pl.getAttribute('#saveFav','aria-pressed')==='true', 'save current search toggles on');
  await pl.reload(); await pl.waitForTimeout(300);
  let favs = await pl.$$eval('#favList .fav', a => a.map(x => x.querySelector('.city').textContent.trim()+' | '+x.querySelector('.info').textContent.trim()));
  assert(favs.length===1 && /Salvador/.test(favs[0]) && /R\$\s980/.test(favs[0]), 'saved route persists with site price: '+favs.join(' || '));
  // promoções: foto grande com destino, origem e preço
  const deal = await pl.$eval('.deal', x => ({city:x.querySelector('.city').textContent.trim(), orig:x.querySelector('.orig').textContent.trim(), price:x.querySelector('.price').textContent}));
  assert(deal.city.startsWith('Ribeirão Preto') && /Saindo de São Paulo/.test(deal.orig) && /R\$ 284/.test(deal.price), 'deal card shows destination, origin and price: '+JSON.stringify(deal));
  const wide = await pl.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert(wide, 'no horizontal page scroll at 375px');
  assert(errsL.length===0, 'no page errors with routes '+errsL.join(';'));
  // ---- Para onde vamos viajar? origem → destinos mais baratos ----
  const ctxEx = await b.newContext({viewport:{width:375,height:760}});
  await ctxEx.addInitScript(fixClock('2026-11-02T12:00:00'));
  await ctxEx.addInitScript(() => {
    window.RADAR_WAIT_MS = 5;
    const PRICE = {SSA:'R$ 612', LIS:'R$ 3.480', GIG:'R$ 389', REC:'R$ 701,40', EZE:'R$ 1.120', MIA:'R$ 2.950'};
    let cur = ''; window.__urls = [];
    window.claude = {use: async cap => cap === 'mcp' ? {
      listTools: async () => ({servers:[{server:'host:claude_browser'}]}),
      callTool: async (srv, tool, args) => {
        if(args && args.url){ cur = decodeURIComponent(args.url); window.__urls.push(cur); return {payload:{tabId:3}}; }
        const m = cur.match(/ to ([A-Z]{3}) on/); return {content:[{type:'text', text: m && PRICE[m[1]] ? 'Melhores voos a partir de '+PRICE[m[1]] : 'Sem resultados'}]};
      }} : null};
  });
  const px = await ctxEx.newPage(); const errsX = []; px.on('pageerror', e => errsX.push(e.message));
  await px.goto(url); await px.waitForTimeout(300);
  assert((await px.textContent('#favsTitle')).trim()==='Para onde vamos viajar?', 'headline shown');
  await px.fill('#exFrom','curitiba'); await px.dispatchEvent('#exFrom','input'); await px.keyboard.press('Enter');
  await px.waitForFunction(() => !exRun && Object.keys((exData||{}).prices||{}).length > 0, null, {timeout:15000});
  const ex = await px.$$eval('#exList .fav', a => a.map(x => x.querySelector('.city').textContent.trim().split(' ')[0]+':'+x.querySelector('.info b').textContent.trim()));
  assert(/^Rio:R\$\s389$/.test(ex[0]) && /^Salvador:R\$\s612$/.test(ex[1]) && /^Recife:R\$\s701,40$/.test(ex[2]), 'choosing origin searches automatically, cheapest first: '+ex.slice(0,4).join(' | '));
  assert(ex.length===10 && /Toque|Sem preço/.test(ex[9]), 'ten destinations, unpriced last: '+ex[9]);
  const q = await px.evaluate(() => window.__urls[0]);
  assert(/Flights from CWB to GIG on 2026-12-02 through 2026-12-09/.test(q), 'searches from chosen origin, default 1 month ahead, 7 days: '+q);
  assert(await px.$eval('#exList .fav', x => x.classList.contains('best')), 'cheapest destination highlighted');
  await px.click('#exList .fav button[data-ex="SSA"]');
  const sx = await px.evaluate(() => [from.value,to.value,dep.value,ret.value].join(' '));
  assert(sx==='CWB SSA 2026-12-02 2026-12-09', 'tapping a destination fills the search: '+sx);
  await px.click('#exList button[data-star="LIS"]');
  assert(await px.isVisible('#favList .fav') && /Lisboa/.test(await px.textContent('#favList')), 'star saves the route');
  await px.reload(); await px.waitForTimeout(400);
  const ex2 = await px.$$eval('#exList .fav .info b', a => a.slice(0,2).map(x => x.textContent.trim()));
  assert(/389/.test(ex2[0]) && (await px.inputValue('#exFrom')).includes('CWB'), 'origin and prices remembered after reload: '+ex2);
  assert(errsX.length===0, 'no page errors in explore '+errsX.join(';'));
  // botão de busca sem servidor de preços
  await p.click('#searchBtn');
  assert(!(await p.isHidden('#bestBox')) && /Para ver o preço aqui/.test(await p.textContent('#bestBox')), 'search button without price server explains where prices appear');
  // ---- ajuste automático à tela: do celular de 320px ao monitor ----
  for(const [w,h] of [[320,640],[375,812],[414,896],[768,1024],[1366,768],[1920,1080]]){
    const cr = await b.newContext({viewport:{width:w,height:h}}); await cr.addInitScript(fixClock('2026-11-02T12:00:00'));
    const pr = await cr.newPage(); await pr.goto(url); await pr.waitForTimeout(300);
    const m = await pr.evaluate(() => ({sw: document.documentElement.scrollWidth, vw: innerWidth, wrap: Math.round(document.querySelector('.wrap').getBoundingClientRect().width)}));
    assert(m.sw <= m.vw, `no horizontal page scroll at ${w}px (página ${m.sw}px, conteúdo ${m.wrap}px)`);
    if(w >= 1366){
      assert(m.wrap >= 1100, `wide screens use more width at ${w}px: ${m.wrap}px`);
      const nav = await pr.$('#deals-int .cnav');
      assert(nav && await nav.isVisible(), 'carousel arrows shown for mouse users');
      const before = await pr.$eval('#deals-int .deal-grid', g => g.scrollLeft);
      await pr.click('#deals-int .cnav button[data-d="1"]'); await pr.waitForTimeout(700);
      const after = await pr.$eval('#deals-int .deal-grid', g => g.scrollLeft);
      assert(after > before, `arrow scrolls the carousel (${before} → ${after})`);
    }
    if(w === 320){
      const ex = await pr.evaluate(() => { const i = document.querySelector('.ex-from').getBoundingClientRect(), s = document.getElementById('exWhen').getBoundingClientRect(); return i.width >= 280 && s.top >= i.bottom; });
      assert(ex, 'narrow phones: departure field full width, "Quando" below it');
    }
    await cr.close();
  }
  // instalável: manifesto e ícones
  const man = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); if(!l) return null; try{ const j = await (await fetch(l.href)).json(); return j; } catch(e){ return 'erro: '+e.message; } });
  if(url.startsWith('file:')){
    const j = JSON.parse(require('fs').readFileSync(require('path').resolve(__dirname,'../manifest.webmanifest'),'utf8'));
    assert(j.icons.length >= 2 && j.icons.every(i => require('fs').existsSync(require('path').resolve(__dirname,'..',i.src))), 'manifest icons exist');
  } else assert(man && man.name === 'Radar de Passagens' && man.icons.length >= 2, 'manifest served online: '+JSON.stringify(man).slice(0,80));
  // ---- preços reais pelo servidor (RADAR_API), com a API simulada ----
  const ctxApi = await b.newContext({viewport:{width:375,height:760}});
  await ctxApi.addInitScript(fixClock('2026-11-02T12:00:00'));
  await ctxApi.addInitScript(() => { window.RADAR_API = 'https://precos.test/'; });
  const apiCalls = [];
  await ctxApi.route('https://precos.test/**', route => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams); apiCalls.push(q);
    const H = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
    if(q.to === 'FOR') return route.fulfill({status:502, headers:H, body:JSON.stringify({error:'upstream', message:'Travelpayouts respondeu 500'})});
    if('ofertas' in q) return route.fulfill({status:200, headers:H, body:JSON.stringify({at:'2026-11-02T11:55:00Z',
      campaigns:[{name:'Anoiteceu Azul', url:'https://passagens.voeazul.com.br/pt/anoiteceu', price:'R$ 219,90', points:'8.000 pontos', cond:'No cartão Azul Itau. Consulte condições.', when:'É só essa noite, das 18h às 23h59!'}],
      cash:[{source:'azul', campaign:'Anoiteceu Azul', url:'https://passagens.voeazul.com.br/pt/anoiteceu', from:'GRU', to:'GIG', fromName:'São Paulo', toName:'Rio de Janeiro', price:214.53, dep:'2027-03-04', ret:'', oneWay:true, seen:'3 horas atrás', airline:'AD'},
            {source:'azul', campaign:'Anoiteceu Azul', url:'https://passagens.voeazul.com.br/pt/anoiteceu', from:'MCP', to:'BEL', fromName:'Macapá', toName:'Belém', price:240.92, dep:'2027-04-29', ret:'', oneWay:true, seen:'1 dia atrás', airline:'AD'},
            {source:'md', title:'Santa Catarina bem barato! Passagens para Florianópolis a partir de R$ 278 ida e volta', url:'https://www.melhoresdestinos.com.br/promocao/sc', pub:'Mon, 02 Nov 2026 09:00:00 +0000', from:'POA', to:'FLN', price:278, roundTrip:true, airline:'AD'},
            {source:'md', title:'Lisboa a partir de R$ 3.599 ida e volta', url:'https://md/2', pub:'', from:'', to:'LIS', price:3599, roundTrip:true, airline:'LA'}], errors:[]})});
    if(q.days){ // modo 12 meses: menor preço de cada mês
      const M = {LIS10:{'2027-09':{price:2990,airline:'TP',departure_at:'2027-09-20T08:00:00-03:00',return_at:'2027-09-30T08:00:00-03:00'}}, GIG:{'2026-12':{price:350,airline:'G3',departure_at:'2026-12-05T08:00:00-03:00',return_at:'2026-12-12T08:00:00-03:00'},'2027-03':{price:299,airline:'G3',departure_at:'2027-03-14T08:00:00-03:00',return_at:'2027-03-21T08:00:00-03:00'}},
                 SSA:{'2027-05':{price:540,airline:'AD',departure_at:'2027-05-02T08:00:00-03:00',return_at:'2027-05-09T08:00:00-03:00'}},
                 LIS:{'2027-09':{price:2990,airline:'TP',departure_at:'2027-09-20T08:00:00-03:00',return_at:'2027-09-27T08:00:00-03:00'}}};
      return route.fulfill({status:200, headers:H, body:JSON.stringify({months: (q.days==='10' && M[q.to+'10']) || M[q.to] || {}})});
    }
    const P = {GIG:{G3:{price:389,transfers:0}, LA:{price:412.5,transfers:1}, AV:{price:350,transfers:1}}, SSA:{AD:{price:612}}, LIS:{TP:{price:3480}}, REC:{G3:{price:701}}};
    // Recife: o preço encontrado é de 3 dias depois da data pedida
    const depAt = q.to === 'REC' && q.dep ? new Date(Date.parse(q.dep+'T12:00:00Z') + 3*864e5).toISOString().slice(0,10) : (q.dep||'');
    const airlines = Object.fromEntries(Object.entries(P[q.to]||{}).map(([k,v]) => [k, {departure_at:depAt+'T08:00:00-03:00', ...v}]));
    return route.fulfill({status:200, headers:H, body:JSON.stringify({scope: q.to==='REC' ? 'month' : 'date', airlines})});
  });
  const pa = await ctxApi.newPage(); const errsA = []; pa.on('pageerror', e => errsA.push(e.message));
  await pa.goto(url); await pa.waitForTimeout(300);
  await pa.fill('#from','CWB'); await pa.dispatchEvent('#from','input');
  await pa.fill('#to','GIG'); await pa.dispatchEvent('#to','input');
  await pa.fill('#dep','2027-01-01'); await pa.dispatchEvent('#dep','change');
  await pa.fill('#ret','2027-01-08'); await pa.dispatchEvent('#ret','change');
  await pa.waitForFunction(() => document.querySelectorAll('#cash .lp:not(.wait)').length >= 3, null, {timeout:8000});
  const api = await pa.$$eval('#cash a.go', a => a.map(x => x.querySelector('strong').childNodes[0].textContent+':'+((x.querySelector('.lp')||{}).textContent||'')));
  assert(/^Avianca:R\$\s350$/.test(api[0]) && /^GOL:R\$\s389$/.test(api[1]) && /^LATAM:R\$\s412,50$/.test(api[2]) && /Sem preço recente/.test(api[3]), 'real prices on airline buttons, cheapest first (extra airline added): '+api.join(' | '));
  assert(await pa.$eval('#cash a.go', x => x.classList.contains('best')), 'cheapest airline highlighted');
  assert(/direto/.test(await pa.textContent('#cash a.go:nth-child(2)')) && /por adulto/.test(await pa.textContent('#cash a.go:nth-child(2)')), 'shows stops and per adult');
  const q1 = apiCalls.find(q => q.from==='CWB' && q.to==='GIG' && q.dep==='2027-01-01');
  assert(q1 && q1.ret==='2027-01-08' && q1.cabin==='economy', 'asks the server for the chosen route and dates');
  assert(/menores preços encontrados/.test(await pa.textContent('#cashH')), 'heading says prices found');
  assert(await pa.isHidden('#liveOff'), 'no "open in the Claude app" note when the site has prices');
  // botão "Buscar passagens": busca de novo e mostra o menor preço em destaque
  const callsBefore = apiCalls.filter(q => q.from==='CWB' && q.to==='GIG' && q.dep==='2027-01-01').length;
  await pa.click('#searchBtn');
  await pa.waitForFunction(() => /R\$/.test(document.getElementById('bestBox').textContent) && !document.querySelector('#bestBox .spin'), null, {timeout:8000});
  const bb = await pa.evaluate(() => ({t: document.getElementById('bestBox').textContent.replace(/\s+/g,' ').trim(), href: (document.querySelector('#bestBox a.buy')||{}).href||'', top: document.querySelector('.results').getBoundingClientRect().top}));
  const callsAfter = apiCalls.filter(q => q.from==='CWB' && q.to==='GIG' && q.dep==='2027-01-01').length;
  assert(/Menor preço encontrado/.test(bb.t) && /R\$\s350/.test(bb.t) && /Avianca/.test(bb.t) && /1 parada/.test(bb.t) && /avianca/.test(bb.href), 'search button shows the cheapest fare with airline and buy link: '+bb.t.slice(0,160));
  assert(callsAfter > callsBefore, 'search button asks the server again');
  assert(bb.top < 200, 'search button scrolls to the results');
  await pa.fill('#to','FOR'); await pa.dispatchEvent('#to','input'); await pa.click('#searchBtn');
  await pa.waitForFunction(() => !document.querySelector('#bestBox .spin') && /preço recente/.test(document.getElementById('bestBox').textContent), null, {timeout:8000}).catch(()=>{});
  assert(/Não há preço recente/.test(await pa.textContent('#bestBox')), 'route without fares explains it');
  // preço de outro dia: o botão de comprar abre a companhia nesse dia
  await pa.fill('#to','REC'); await pa.dispatchEvent('#to','input'); await pa.click('#searchBtn');
  await pa.waitForFunction(() => /R\$/.test(document.getElementById('bestBox').textContent) && !document.querySelector('#bestBox .spin'), null, {timeout:8000}).catch(()=>{});
  const od = await pa.evaluate(() => ({t: document.getElementById('bestBox').textContent.replace(/\s+/g,' '), href: (document.querySelector('#bestBox a.buy')||{}).href||''}));
  assert(/Comprar na GOL · ida/.test(od.t) && /voegol/.test(od.href), 'buy button uses the day the fare is for: '+od.t.slice(0,120));
  await pa.fill('#to','GIG'); await pa.dispatchEvent('#to','input');
  // promoções ao vivo (Azul e Melhores Destinos)
  await pa.waitForFunction(() => !document.getElementById('dealsLive').hidden, null, {timeout:8000}).catch(()=>{});
  const live = await pa.evaluate(() => ({banner: document.getElementById('dealsLive').textContent.replace(/\s+/g,' ').trim(), stamp: document.getElementById('dealsStamp').textContent,
    nat: [...document.querySelectorAll('#deals-nat .deal')].map(x => x.querySelector('h3').textContent+' | '+x.querySelector('.price').textContent+' | '+x.querySelector('.who').textContent.replace(/\s+/g,' ').trim()),
    intl: [...document.querySelectorAll('#deals-int .deal h3')].map(x => x.textContent)}));
  assert(/Ao vivo/.test(live.banner) && /Anoiteceu Azul: passagens a partir de R\$ 219,90 ou 8\.000 pontos/.test(live.banner) && /essa noite/.test(live.banner), 'live Azul campaign banner: '+live.banner);
  assert(/Atualizado às/.test(live.stamp), 'deals stamp shows update time: '+live.stamp);
  assert(live.nat.length === 3 && /^São Paulo a Rio de Janeiro pela Azul \| R\$ 214,53só ida/.test(live.nat[0]) && /Macapá a Belém pela Azul/.test(live.nat[1]) && /Azul/.test(live.nat[0].split(' | ')[2]) && /voo em 04\/03/.test(live.nat[0]), 'live deals replace the stored list, cheapest first: '+live.nat.join(' || '));
  assert(live.intl.length === 1 && /Lisboa/.test(live.intl[0]), 'live international deal: '+live.intl.join());
  const azBuy = await pa.$('#deals-nat .deal a[data-buy]'); await azBuy.dispatchEvent('pointerdown');
  const azHref = await azBuy.getAttribute('href');
  assert(/voeazul.*c\[0\]\.ds=GRU.*c\[0\]\.as=GIG/.test(azHref) && azHref.includes('03%2F04%2F2027') || /voeazul/.test(azHref) && /2027/.test(azHref), 'Azul deal buy button opens Azul on the deal date: '+azHref.slice(0,160));
  // Para onde vamos viajar? pelo servidor
  await pa.evaluate(() => scrollTo(0,0));
  await pa.fill('#exFrom','curitiba'); await pa.dispatchEvent('#exFrom','input'); await pa.keyboard.press('Enter');
  // padrão: próximos 12 meses
  await pa.waitForFunction(() => !exRun && exData && exData.key.startsWith('CWB|ano') && Object.keys(exData.prices).length >= 3, null, {timeout:8000});
  const exY = await pa.$$eval('#exList .fav', a => a.slice(0,3).map(x => x.querySelector('.city').textContent.trim().split(' ')[0]+':'+x.querySelector('.info b').textContent.trim()+':'+x.querySelector('.info span').textContent.trim()));
  assert(/^Rio:R\$\s299:mais barato do ano · ida 14\/03\/27 · volta 21\/03$/.test(exY[0]) && /^Salvador:R\$\s540:.*02\/05\/27/.test(exY[1]) && /^Lisboa:R\$\s2\.990/.test(exY[2]), 'explore finds the cheapest of the next 12 months, with its date: '+exY.join(' | '));
  assert(apiCalls.some(q => q.from==='CWB' && q.to==='GIG' && q.days==='7' && !q.dep), 'year mode asks the server for 12 months');
  assert(/próximos 12 meses/.test(await pa.textContent('#exMsg')), 'message says next 12 months: '+await pa.textContent('#exMsg'));
  await pa.click('#exList .fav button[data-ex="GIG"]');
  const fy = await pa.evaluate(() => [from.value,to.value,dep.value,ret.value].join(' '));
  assert(fy==='CWB GIG 2027-03-14 2027-03-21', 'tapping fills the search with the cheapest dates: '+fy);
  // data fixa continua disponível
  await pa.evaluate(() => scrollTo(0,0));
  await pa.selectOption('#exWhen','30');
  await pa.waitForFunction(() => !exRun && exData && exData.key.startsWith('CWB|2026-12-02') && Object.keys(exData.prices).length >= 3, null, {timeout:8000});
  const exA = await pa.$$eval('#exList .fav', a => a.slice(0,4).map(x => x.querySelector('.city').textContent.trim().split(' ')[0]+':'+x.querySelector('.info b').textContent.trim()));
  assert(/^Rio:R\$\s350$/.test(exA[0]) && /^Salvador:R\$\s612$/.test(exA[1]) && /^Recife:R\$\s701$/.test(exA[2]) && /^Lisboa/.test(exA[3]), 'fixed date still works, cheapest first: '+exA.join(' | '));
  const recNote = await pa.$$eval('#exList .fav', a => (a.find(x => /Recife/.test(x.querySelector('.city').textContent))||{}).textContent||'');
  assert(/melhor de nov\/26 · ida 02\/11/.test(recNote) || /melhor de dez\/26/.test(recNote), 'month-scope destination price says which month/date: '+recNote.replace(/\s+/g,' ').trim().slice(-60));
  // Preço ao longo do ano: acompanha a busca de cima e preenche os 12 meses sozinho
  await pa.waitForLoadState('networkidle'); await pa.waitForTimeout(500);
  await pa.reload(); await pa.waitForTimeout(400);
  await pa.waitForFunction(() => (document.getElementById('tp-2027-03')||{}).value === '299', null, {timeout:8000}).catch(()=>{});
  const tr = await pa.evaluate(() => ({route: [tFrom.value, tTo.value, tDep.value, tDays.value].join(' '), v: document.getElementById('tp-2027-03').value, note: document.querySelector('.mo-s[data-s="2027-03"]').textContent, dez: document.getElementById('tp-2026-12').value+' '+document.querySelector('.mo-s[data-s="2026-12"]').textContent, empty: document.querySelector('.mo-s[data-s="2027-01"]').textContent, axis: document.querySelectorAll('#tChart .axis').length}));
  assert(tr.route === 'CWB GIG 2027-03-14 7', 'yearly chart follows the search above (route, date, ~duration): '+tr.route);
  assert(tr.v === '299' && /GOL · ida 14\/03/.test(tr.note) && /^350 GOL · ida 05\/12/.test(tr.dez) && /sem preço recente/.test(tr.empty) && tr.axis > 0, 'each month filled by itself with airline and day: '+JSON.stringify(tr));
  // mudar a busca de cima muda o gráfico
  await pa.fill('#from','GRU'); await pa.dispatchEvent('#from','input');
  await pa.fill('#to','LIS'); await pa.dispatchEvent('#to','input');
  await pa.fill('#dep','2026-12-02'); await pa.dispatchEvent('#dep','change');
  await pa.fill('#ret','2026-12-12'); await pa.dispatchEvent('#ret','change');
  await pa.waitForFunction(() => (document.getElementById('tp-2027-09')||{}).value === '2.990', null, {timeout:8000}).catch(()=>{});
  await pa.waitForTimeout(800);
  const tr2 = await pa.evaluate(() => ({route: [tFrom.value, tTo.value, tDep.value, tDays.value].join(' '), v: document.getElementById('tp-2027-09').value, note: document.querySelector('.mo-s[data-s="2027-09"]').textContent}));
  assert(tr2.route === 'GRU LIS 2026-12-02 10' && tr2.v === '2.990' && /TAP Air Portugal · ida 20\/09/.test(tr2.note), 'changing the search updates the yearly chart: '+JSON.stringify(tr2));
  assert(apiCalls.some(q => q.from==='GRU' && q.to==='LIS' && q.days==='10'), 'chart asks the server for the new route');
  assert(await pa.evaluate(() => exOrigin) === 'GRU' && /GRU/.test(await pa.inputValue('#exFrom')), 'departure city of the search also drives "Para onde vamos viajar?"');
  await pa.fill('#tp-2026-12','1500'); await pa.dispatchEvent('#tp-2026-12','change');
  await pa.click('#tAutoBtn'); await pa.waitForTimeout(600);
  const tMan = await pa.evaluate(() => ({v: document.getElementById('tp-2026-12').value, note: document.querySelector('.mo-s[data-s="2026-12"]').textContent, auto: document.getElementById('tp-2027-09').value}));
  assert(tMan.v === '1.500' && /anotado por você/.test(tMan.note) && tMan.auto === '2.990', 'refreshing keeps what you typed: '+JSON.stringify(tMan));
  assert(errsA.length===0, 'no page errors with price server '+errsA.join(';'));
  await b.close();
})();
