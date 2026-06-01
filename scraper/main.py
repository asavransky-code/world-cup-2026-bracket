#!/usr/bin/env python3
"""Scrape the World Cup Wikipedia page into the bracket extension's ACTUAL shape.

Outputs results.json:
  {
    "status": "pre" | "live" | "complete",
    "updated": "<ISO8601>",
    "source": "<wikipedia url>",
    "groups": { "A": ["mx","kr","cz","za"], ... },  # only groups that are FINAL
    "thirdQualifiers": ["cz","ci",...],              # 8 advancing thirds, when known
    "r16": [...], "qf": [...], "sf": [...], "final": [...],  # flag codes, reach-sets
    "champion": "ar" | null
  }

Run locally:  python3 main.py --page 2022_FIFA_World_Cup --validate
              python3 main.py            # defaults to the 2026 page, writes results.json
"""
import argparse, datetime, json, re, sys, urllib.request
from bs4 import BeautifulSoup

DEFAULT_PAGE = "2026_FIFA_World_Cup"
UA = "wc-bracket-results/1.0 (asavransky@mozilla.com)"

# Wikipedia rendered name -> flagcdn code. Base map is generated from the
# extension's data.js TEAMS; ALIASES cover names Wikipedia may render differently.
NAME2CODE = {
    "Mexico": "mx", "South Africa": "za", "South Korea": "kr", "Czech Republic": "cz",
    "Canada": "ca", "Bosnia and Herzegovina": "ba", "Qatar": "qa", "Switzerland": "ch",
    "Brazil": "br", "Morocco": "ma", "Haiti": "ht", "Scotland": "gb-sct",
    "United States": "us", "Paraguay": "py", "Australia": "au", "Turkey": "tr",
    "Germany": "de", "Curacao": "cw", "Ivory Coast": "ci", "Ecuador": "ec",
    "Netherlands": "nl", "Japan": "jp", "Sweden": "se", "Tunisia": "tn",
    "Belgium": "be", "Egypt": "eg", "Iran": "ir", "New Zealand": "nz",
    "Spain": "es", "Cape Verde": "cv", "Saudi Arabia": "sa", "Uruguay": "uy",
    "France": "fr", "Senegal": "sn", "Iraq": "iq", "Norway": "no",
    "Argentina": "ar", "Algeria": "dz", "Austria": "at", "Jordan": "jo",
    "Portugal": "pt", "DR Congo": "cd", "Uzbekistan": "uz", "Colombia": "co",
    "England": "gb-eng", "Croatia": "hr", "Ghana": "gh", "Panama": "pa",
}
ALIASES = {
    "Czechia": "cz", "Türkiye": "tr", "Turkiye": "tr", "Curaçao": "cw",
    "Côte d'Ivoire": "ci", "Cote d'Ivoire": "ci", "Cabo Verde": "cv",
    "Korea Republic": "kr", "Democratic Republic of the Congo": "cd",
    "DR Congo": "cd", "IR Iran": "ir", "United States of America": "us",
    # 2022-only teams (so --validate against 2022 resolves cleanly)
    "Wales": "gb-wls", "Denmark": "dk", "Costa Rica": "cr", "Serbia": "rs",
    "Cameroon": "cm", "Poland": "pl",
}

UNRESOLVED = set()

# Pre/mid-tournament bracket boxes hold slot placeholders, not teams. These are
# expected and must be skipped silently rather than flagged as unknown teams.
PLACEHOLDER = re.compile(
    r"^(Winner|Runner-up|Loser|3rd|Third|Best|TBD)\b|\bMatch\s+\d+\b|\bGroup\s+[A-L]\b",
    re.IGNORECASE)

def code_for(name):
    name = (name or "").strip()
    if name in NAME2CODE:
        return NAME2CODE[name]
    if name in ALIASES:
        return ALIASES[name]
    if name and not PLACEHOLDER.search(name):
        UNRESOLVED.add(name)
    return None

def fetch(page):
    api = ("https://en.wikipedia.org/w/api.php?action=parse&page=%s"
           "&prop=text&format=json&formatversion=2" % page)
    req = urllib.request.Request(api, headers={"User-Agent": UA})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    return BeautifulSoup(data["parse"]["text"], "html.parser")

def section_tables(soup, heading_ids, klass):
    """Tables with `klass` between the first matching heading and the next h2/h3."""
    h = None
    for hid in heading_ids:
        h = soup.find(["h2", "h3", "h4"], id=hid)
        if h:
            break
    if not h:
        return []
    out, level = [], h.name
    for sib in h.find_all_next():
        if sib.name in ("h2", "h3") and sib is not h:
            break
        if sib.name == "table" and klass in (sib.get("class") or []):
            out.append(sib)
    return out

def parse_groups(soup):
    """Return {group: {"order": [codes], "final": bool}}. order is 1st..4th."""
    groups = {}
    for g in "ABCDEFGHIJKL":
        tbls = section_tables(soup, [f"Group_{g}"], "wikitable")
        standings = next(
            (t for t in tbls if "Pld" in t.get_text() and "Pts" in t.get_text()), None)
        if not standings:
            continue
        order, plds = [], []
        for tr in standings.select("tr"):
            cells = tr.find_all(["td", "th"])
            if len(cells) < 5:
                continue
            team = None
            for i, c in enumerate(cells[:3]):
                a = c.find("a")
                if a and len(a.get_text(strip=True)) > 2:
                    team = a.get_text(strip=True)
                    # Pld is the first plain numeric cell after the team cell
                    for nxt in cells[i + 1:]:
                        txt = nxt.get_text(strip=True)
                        if txt.isdigit():
                            plds.append(int(txt))
                            break
                    break
            if team:
                code = code_for(team)
                if code and code not in order:
                    order.append(code)
        final = len(order) == 4 and len(plds) >= 4 and all(p >= 3 for p in plds[:4])
        groups[g] = {"order": order[:4], "final": final}
    return groups

def teams_in_section(soup, heading_ids):
    """All team codes appearing in match boxes under a knockout section."""
    teams = []
    for box in section_tables(soup, heading_ids, "fevent"):
        for cls in ("fhome", "faway"):
            cell = box.find(["td", "th"], class_=cls)
            if cell:
                code = code_for(cell.get_text(" ", strip=True))
                if code and code not in teams:
                    teams.append(code)
    return teams

def derive_thirds(groups, r32_teams):
    """The advancing third-placed teams = group 3rd-place finishers who are in
    the Round of 32. More robust than parsing the (rowspan/colour-coded)
    third-place ranking table, and reuses the proven standings + match-box parses."""
    r32 = set(r32_teams)
    out = []
    for g, v in groups.items():
        order = v["order"]
        if v["final"] and len(order) >= 3 and order[2] in r32 and order[2] not in out:
            out.append(order[2])
    return out

ROUND_IDS = {
    "r16": ["Round_of_16"],
    "qf": ["Quarterfinals", "Quarter-finals"],
    "sf": ["Semifinals", "Semi-finals"],
    "final": ["Final"],
}

def parse_reach(soup):
    """{round: [codes]} for teams appearing in each round's match boxes."""
    reach = {}
    for key, ids in ROUND_IDS.items():
        teams = []
        for box in section_tables(soup, ids, "fevent"):
            for cls in ("fhome", "faway"):
                cell = box.find(["td", "th"], class_=cls)
                if cell:
                    code = code_for(cell.get_text(" ", strip=True))
                    if code and code not in teams:
                        teams.append(code)
        reach[key] = teams
    return reach

def parse_champion(soup):
    # Primary signal: the article infobox "Champions" row (robust, handles
    # penalty-decided finals where the match box shows a level score).
    ib = soup.find("table", class_="infobox")
    if ib:
        for tr in ib.select("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if th and td and th.get_text(strip=True).startswith("Champion"):
                a = td.find("a")
                code = code_for((a.get_text(strip=True) if a else td.get_text(strip=True)))
                if code:
                    return code
    # Fallback: the Final match box, when a side has a strictly higher score.
    boxes = section_tables(soup, ["Final"], "fevent")
    if not boxes:
        return None
    box = boxes[0]
    home = box.find(class_="fhome"); away = box.find(class_="faway")
    score = box.find(class_="fscore")
    if not (home and away and score):
        return None
    nums = [int(n) for n in re.findall(r"\d+", score.get_text(" ", strip=True))[:2]]
    if len(nums) == 2 and nums[0] != nums[1]:
        winner = home if nums[0] > nums[1] else away
        return code_for(winner.get_text(" ", strip=True))
    return None

def build(page):
    soup = fetch(page)
    groups = parse_groups(soup)
    reach = parse_reach(soup)
    r32_teams = teams_in_section(soup, ["Round_of_32"])
    thirds = derive_thirds(groups, r32_teams)
    champion = parse_champion(soup)

    final_groups = {g: v["order"] for g, v in groups.items() if v["final"]}
    any_ko = any(reach.get(k) for k in ("r16", "qf", "sf", "final"))
    if champion:
        status = "complete"
    elif final_groups or any_ko or thirds:
        status = "live"
    else:
        status = "pre"

    return {
        "status": status,
        "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": f"https://en.wikipedia.org/wiki/{page}",
        "groups": final_groups,
        "thirdQualifiers": thirds,
        "r16": reach.get("r16", []),
        "qf": reach.get("qf", []),
        "sf": reach.get("sf", []),
        "final": reach.get("final", []),
        "champion": champion,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default=DEFAULT_PAGE)
    ap.add_argument("--validate", action="store_true",
                    help="print parsed result + sanity checks, don't write file")
    ap.add_argument("--out", default="results.json")
    args = ap.parse_args()

    result = build(args.page)

    if args.validate:
        print(json.dumps(result, indent=2))
        print("\nstatus:", result["status"])
        print("final groups:", len(result["groups"]),
              "| thirds:", len(result["thirdQualifiers"]),
              "| r16/qf/sf/final:",
              [len(result[k]) for k in ("r16", "qf", "sf", "final")],
              "| champion:", result["champion"])
        if UNRESOLVED:
            print("\nUNRESOLVED TEAM NAMES (need an alias):", sorted(UNRESOLVED))
            sys.exit(1)
        print("all team names resolved to flag codes.")
        return

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(f"wrote {args.out} (status={result['status']})")
    if UNRESOLVED:
        print("WARNING unresolved names:", sorted(UNRESOLVED), file=sys.stderr)

if __name__ == "__main__":
    main()
