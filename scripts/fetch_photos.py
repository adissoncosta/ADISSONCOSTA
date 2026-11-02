#!/usr/bin/env python3
"""Baixa fotos reais dos pontos turísticos (Wikimedia Commons, licenças livres)
e grava em img/<CHAVE>.jpg, atualizando o bloco PHOTOS dentro de index.html.

Uso:  python3 scripts/fetch_photos.py            (baixa só as fotos e logotipos que faltam)
      python3 scripts/fetch_photos.py --force    (baixa todas de novo)
      python3 scripts/fetch_photos.py --logos    (só os logotipos das companhias, de pics.avs.io)
Requer acesso a en.wikipedia.org, commons.wikimedia.org e upload.wikimedia.org.
"""
import io, json, re, sys, time, html, subprocess, urllib.parse, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "img"
UA = {"User-Agent": "RadarDePassagens/1.0 (https://github.com/adissoncosta/ADISSONCOSTA)"}

# chave usada no site -> (artigo da Wikipédia em inglês, nome mostrado no cartão)
LANDMARKS = {
  "LIS": ("Belém Tower", "Torre de Belém"), "OPO": ("Dom Luís I Bridge", "Ponte Luís I"),
  "MAD": ("Puerta de Alcalá", "Puerta de Alcalá"), "BCN": ("Sagrada Família", "Sagrada Família"),
  "CDG": ("Eiffel Tower", "Torre Eiffel"), "FCO": ("Colosseum", "Coliseu"),
  "MXP": ("Milan Cathedral", "Duomo de Milão"), "LHR": ("Big Ben", "Big Ben"),
  "FRA": ("Römer", "Römer, Frankfurt"), "AMS": ("Canals of Amsterdam", "Canais de Amsterdã"),
  "ZRH": ("Grossmünster", "Grossmünster, Zurique"), "BRU": ("Grand-Place", "Grand-Place"),
  "MIA": ("South Beach", "South Beach, Miami"), "MCO": ("Cinderella Castle", "Magic Kingdom, Orlando"),
  "NYC": ("Statue of Liberty", "Estátua da Liberdade"), "LAX": ("Hollywood Sign", "Letreiro de Hollywood"),
  "ATL": ("Atlanta", "Atlanta"), "IAH": ("Space Center Houston", "Space Center Houston"),
  "DFW": ("Reunion Tower", "Reunion Tower, Dallas"), "YYZ": ("Toronto", "Toronto e a CN Tower"),
  "BUE": ("Obelisco de Buenos Aires", "Obelisco"), "SCL": ("Gran Torre Santiago", "Santiago e os Andes"),
  "CJC": ("Valle de la Luna (Chile)", "Vale da Lua, Atacama"), "MVD": ("Plaza Independencia", "Plaza Independencia, Montevidéu"),
  "LIM": ("Machu Picchu", "Machu Picchu"), "BOG": ("Monserrate", "Monserrate"),
  "PTY": ("Panama Canal expansion project", "Canal do Panamá"), "CUN": ("Chichen Itza", "Chichén Itzá"),
  "MEX": ("Angel of Independence", "Anjo da Independência"), "ASU": ("Palacio de los López", "Palacio de los López"),
  "DXB": ("Burj Khalifa", "Burj Khalifa"), "DOH": ("Doha", "Doha"),
  "IST": ("Sultan Ahmed Mosque", "Mesquita Azul"), "JNB": ("Nelson Mandela Bridge", "Ponte Nelson Mandela"),
  "TYO": ("Mount Fuji", "Monte Fuji"), "ICN": ("Namsan", "Namsan e N Seoul Tower"), "BKK": ("Wat Arun", "Wat Arun"),
  "RIO": ("Sugarloaf Mountain", "Pão de Açúcar"), "SAO": ("Paulista Avenue", "Avenida Paulista"),
  "BSB": ("Palácio do Congresso Nacional", "Congresso Nacional"), "SSA": ("Lacerda Elevator", "Elevador Lacerda"),
  "REC": ("Recife Antigo", "Recife Antigo"), "FOR": ("Fortaleza", "Fortaleza"),
  "NAT": ("Ponta Negra", "Ponta Negra, Natal"), "MCZ": ("Pajuçara", "Pajuçara, Maceió"),
  "JPA": ("Cabo Branco Lighthouse", "Farol do Cabo Branco"), "FEN": ("Fernando de Noronha", "Fernando de Noronha"),
  "IGU": ("Iguazu Falls", "Cataratas do Iguaçu"), "BPS": ("Porto Seguro", "Porto Seguro"),
  "MAO": ("Amazon Theatre", "Teatro Amazonas"), "FLN": ("Hercílio Luz Bridge", "Ponte Hercílio Luz"),
  "CWB": ("Botanical Garden of Curitiba", "Jardim Botânico"), "POA": ("Usina do Gasômetro", "Usina do Gasômetro"),
  "CNF": ("Church of Saint Francis of Assisi (Belo Horizonte)", "Igreja da Pampulha"), "BEL": ("Ver-o-Peso", "Ver-o-Peso"),
  "AJU": ("Aracaju", "Aracaju"), "SLZ": ("Lençóis Maranhenses National Park", "Lençóis Maranhenses"),
  "THE": ("Teresina", "Teresina"), "NVT": ("Balneário Camboriú", "Balneário Camboriú"),
  "GYN": ("Goiânia", "Goiânia"), "CGB": ("Chapada dos Guimarães National Park", "Chapada dos Guimarães"),
  "CGR": ("Bonito, Mato Grosso do Sul", "Bonito"), "VIX": ("Convento da Penha", "Convento da Penha"),
  "PMW": ("Palmas, Tocantins", "Palmas"), "LDB": ("Londrina", "Londrina"), "CPV": ("Campina Grande", "Campina Grande"),
}

def fetch(url, timeout=30):
    """GET via curl (a Wikimedia limita bem mais o urllib do Python), com novas
    tentativas quando a taxa é limitada (HTTP 429/503)."""
    for attempt in range(10):
        r = subprocess.run(["curl", "-sS", "-L", "--max-time", str(timeout), "-A", UA["User-Agent"],
                            "-w", "\n%{http_code}", url], capture_output=True)
        body, _, code = r.stdout.rpartition(b"\n")
        code = int(code or 0)
        if r.returncode == 0 and code == 200:
            return body
        if code not in (429, 503) or attempt == 9:
            raise RuntimeError(f"HTTP {code} em {url}: {r.stderr.decode()[:200]}")
        wait = min(15 * 2 ** attempt, 300)
        print(f"  limite de taxa ({code}), aguardando {wait}s", flush=True); time.sleep(wait)

# Logotipos das companhias por código IATA (os mesmos de AIRLINES no index.html).
# Fonte: banco de logotipos de companhias aéreas da Travelpayouts (pics.avs.io), versão quadrada.
LOGOS = {"LA":"LATAM","G3":"GOL","AD":"Azul","TP":"TAP Air Portugal","AA":"American Airlines",
  "AR":"Aerolíneas Argentinas","CM":"Copa Airlines","EK":"Emirates","QR":"Qatar Airways","TK":"Turkish Airlines",
  "AF":"Air France","KL":"KLM","IB":"Iberia","LH":"Lufthansa","LX":"Swiss","BA":"British Airways","AZ":"ITA Airways",
  "DL":"Delta","UA":"United","AC":"Air Canada","AV":"Avianca","SA":"South African Airways","H2":"SKY Airline"}
LOGO_URL = "https://pics.avs.io/al_square/240/240/{}.png"

def get_json(url):
    time.sleep(0.5)  # ritmo gentil com a API da Wikimedia
    return json.loads(fetch(url))

def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()

def main(force=False):
    IMG.mkdir(exist_ok=True)
    manifest_path = IMG / "photos.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    todo = {k: v for k, v in LANDMARKS.items() if force or k not in manifest or not (IMG / f"{k}.jpg").exists()}
    keys = list(todo)
    for i in range(0, len(keys), 40):
        chunk = keys[i:i+40]
        titles = "|".join(todo[k][0] for k in chunk)
        q = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "format": "json", "redirects": 1, "prop": "pageimages",
            "piprop": "name", "pilimit": 50, "titles": titles}))["query"]
        alias = {n["from"]: n["to"] for n in q.get("normalized", []) + q.get("redirects", [])}
        files = {p["title"]: p.get("pageimage") for p in q["pages"].values()}
        for k in chunk:
            t = todo[k][0]
            t2 = alias.get(alias.get(t, t), alias.get(t, t))
            fname = files.get(t2)
            if not fname:
                print(f"{k}: sem imagem para '{t}'"); continue
            info = get_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
                "action": "query", "format": "json", "prop": "imageinfo", "titles": "File:" + fname,
                "iiprop": "url|extmetadata", "iiurlwidth": 960}))["query"]["pages"]
            ii = next(iter(info.values())).get("imageinfo", [{}])[0]
            if not ii.get("thumburl"):
                print(f"{k}: arquivo {fname} fora do Commons"); continue
            meta = ii.get("extmetadata", {})
            out = IMG / f"{k}.jpg"
            if force or not out.exists():  # imagem já baixada numa execução interrompida: só falta o crédito
                im = Image.open(io.BytesIO(fetch(ii["thumburl"], timeout=60))).convert("RGB")
                im.thumbnail((900, 900))
                im.save(out, "JPEG", quality=74, optimize=True, progressive=True)
                time.sleep(8)
            manifest[k] = {
                "n": todo[k][1],
                "a": strip_html(meta.get("Artist", {}).get("value")) or "Autor desconhecido",
                "l": strip_html(meta.get("LicenseShortName", {}).get("value")) or "ver página",
                "u": ii.get("descriptionurl", ""),
            }
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True))
            print(f"{k}: ok ({fname})", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True))
    # Copia o manifesto para dentro do index.html (a página não pode carregar scripts externos)
    inject("PHOTOS", manifest)
    print(f"{len(manifest)} fotos no manifesto")

def inject(name, data):
    """Copia um manifesto para dentro do index.html (a página não pode carregar JSON externo)."""
    page = (ROOT / "index.html").read_text()
    block = f"const {name} = " + json.dumps(data, ensure_ascii=False, sort_keys=True) + ";"
    page = re.sub(rf"const {name} = \{{.*?\}};", lambda _: block, page, count=1, flags=re.S)
    (ROOT / "index.html").write_text(page)

def logos(force=False):
    """Baixa o logotipo quadrado de cada companhia para img/logo-<IATA>.png (120 px)."""
    IMG.mkdir(exist_ok=True)
    manifest_path = IMG / "logos.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for k, name in LOGOS.items():
        out = IMG / f"logo-{k}.png"
        if not force and k in manifest and out.exists():
            continue
        url = LOGO_URL.format(k)
        im = Image.open(io.BytesIO(fetch(url, timeout=30))).convert("RGBA")
        im.thumbnail((120, 120))
        im.save(out, "PNG", optimize=True)
        manifest[k] = {"n": name, "a": name, "l": "marca registrada", "u": url}
        print(f"logo {k}: ok", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True))
    inject("LOGOS", manifest)
    print(f"{len(manifest)} logotipos no manifesto")

if __name__ == "__main__":
    force = "--force" in sys.argv
    if "--logos" not in sys.argv:
        main(force=force)
    logos(force=force)
