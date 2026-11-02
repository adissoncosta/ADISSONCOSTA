#!/usr/bin/env python3
"""Baixa fotos reais dos pontos turísticos (Wikimedia Commons, licenças livres)
e grava em img/<CHAVE>.jpg, atualizando o bloco PHOTOS dentro de index.html.

Uso:  python3 scripts/fetch_photos.py            (baixa só as que faltam)
      python3 scripts/fetch_photos.py --force    (baixa todas de novo)
Requer acesso a en.wikipedia.org, commons.wikimedia.org e upload.wikimedia.org.
"""
import io, json, re, sys, html, urllib.parse, urllib.request, pathlib
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
  "FRA": ("Römer (Frankfurt)", "Römer, Frankfurt"), "AMS": ("Canals of Amsterdam", "Canais de Amsterdã"),
  "ZRH": ("Grossmünster", "Grossmünster, Zurique"), "BRU": ("Grand-Place", "Grand-Place"),
  "MIA": ("South Beach", "South Beach, Miami"), "MCO": ("Cinderella Castle", "Magic Kingdom, Orlando"),
  "NYC": ("Statue of Liberty", "Estátua da Liberdade"), "LAX": ("Hollywood Sign", "Letreiro de Hollywood"),
  "ATL": ("Centennial Olympic Park", "Centennial Olympic Park, Atlanta"), "IAH": ("Space Center Houston", "Space Center Houston"),
  "DFW": ("Reunion Tower", "Reunion Tower, Dallas"), "YYZ": ("CN Tower", "CN Tower"),
  "BUE": ("Obelisco de Buenos Aires", "Obelisco"), "SCL": ("Gran Torre Santiago", "Santiago e os Andes"),
  "CJC": ("Valle de la Luna (Chile)", "Vale da Lua, Atacama"), "MVD": ("Palacio Salvo", "Palacio Salvo"),
  "LIM": ("Machu Picchu", "Machu Picchu"), "BOG": ("Monserrate", "Monserrate"),
  "PTY": ("Panama Canal", "Canal do Panamá"), "CUN": ("Chichen Itza", "Chichén Itzá"),
  "MEX": ("Angel of Independence", "Anjo da Independência"), "ASU": ("Palacio de los López", "Palacio de los López"),
  "DXB": ("Burj Khalifa", "Burj Khalifa"), "DOH": ("Museum of Islamic Art, Doha", "Museu de Arte Islâmica, Doha"),
  "IST": ("Sultan Ahmed Mosque", "Mesquita Azul"), "JNB": ("Nelson Mandela Bridge", "Ponte Nelson Mandela"),
  "TYO": ("Mount Fuji", "Monte Fuji"), "ICN": ("N Seoul Tower", "N Seoul Tower"), "BKK": ("Wat Arun", "Wat Arun"),
  "RIO": ("Sugarloaf Mountain", "Pão de Açúcar"), "SAO": ("Paulista Avenue", "Avenida Paulista"),
  "BSB": ("National Congress of Brazil", "Congresso Nacional"), "SSA": ("Lacerda Elevator", "Elevador Lacerda"),
  "REC": ("Marco Zero (Recife)", "Marco Zero, Recife"), "FOR": ("Iracema Beach", "Praia de Iracema"),
  "NAT": ("Ponta Negra Beach (Natal)", "Ponta Negra, Natal"), "MCZ": ("Pajuçara", "Pajuçara, Maceió"),
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

def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)

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
                "iiprop": "url|extmetadata", "iiurlwidth": 900}))["query"]["pages"]
            ii = next(iter(info.values())).get("imageinfo", [{}])[0]
            if not ii.get("thumburl"):
                print(f"{k}: arquivo {fname} fora do Commons"); continue
            meta = ii.get("extmetadata", {})
            with urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=60) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGB")
            im.thumbnail((900, 900))
            im.save(IMG / f"{k}.jpg", "JPEG", quality=74, optimize=True, progressive=True)
            manifest[k] = {
                "n": todo[k][1],
                "a": strip_html(meta.get("Artist", {}).get("value")) or "Autor desconhecido",
                "l": strip_html(meta.get("LicenseShortName", {}).get("value")) or "ver página",
                "u": ii.get("descriptionurl", ""),
            }
            print(f"{k}: ok ({fname})")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True))
    # Copia o manifesto para dentro do index.html (a página não pode carregar scripts externos)
    page = (ROOT / "index.html").read_text()
    block = "const PHOTOS = " + json.dumps(manifest, ensure_ascii=False, sort_keys=True) + ";"
    page = re.sub(r"const PHOTOS = \{.*?\};", lambda _: block, page, count=1, flags=re.S)
    (ROOT / "index.html").write_text(page)
    print(f"{len(manifest)} fotos no manifesto")

if __name__ == "__main__":
    main(force="--force" in sys.argv)
