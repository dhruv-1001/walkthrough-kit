"""Writes data/<name>-boundaries.json (the rows of the boundary spreadsheet)
from the same official set turbopass serves the Geography step, so the Excel
path uploads exactly the areas the preconfigured path brings in.

turbopass returns polygons without parent links. Parents are found the way
the configurator does it (configurator/src/utils/osmBoundaries.ts): each area's
representative point (area-weighted centroid of its largest polygon, or a
point on its surface when the centroid falls outside) must sit inside the
parent; the smallest containing area one level up wins.

  ../../.venv/bin/python lib/boundaries_from_turbopass.py "Nairobi" "Nairobi — County" data/nairobi-boundaries.json
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter

TURBOPASS = 'http://127.0.0.1:13302'


def get(path):
    with urllib.request.urlopen(TURBOPASS + path, timeout=60) as r:
        return json.load(r)


def rings(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    return [poly[0] for poly in geom['coordinates']]


def inside(pt, ring):
    x, y = pt
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def ring_area_centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][:2]
        x1, y1 = ring[i + 1][:2]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:
        return 0.0, None
    return abs(a) / 2, (cx / (3 * a), cy / (3 * a))


def representative_point(rs):
    outer = max(rs, key=lambda r: ring_area_centroid(r)[0])
    _, c = ring_area_centroid(outer)
    if c and inside(c, outer):
        return c
    y = c[1] if c else outer[0][1]
    xs = sorted(
        x0 + (y - y0) * (x1 - x0) / (y1 - y0)
        for (x0, y0, *_), (x1, y1, *_) in zip(outer, outer[1:])
        if (y0 > y) != (y1 > y)
    )
    return ((xs[0] + xs[1]) / 2, y) if len(xs) >= 2 else tuple(outer[0][:2])


def code_part(name):
    return re.sub(r'[^A-Z0-9]+', '_', name.upper()).strip('_')


def main(query, pick, out):
    hits = get('/boundary/search?' + urllib.parse.urlencode({'q': query, 'source': 'official', 'match': 'substring'}))['features']
    place = next(f for f in hits if f['properties']['formatted'].startswith(pick))
    fc = get('/boundary/fetch?' + urllib.parse.urlencode({'id': place['properties']['place_id'], 'source': 'official'}))
    feats = sorted(fc['features'], key=lambda f: (f['properties']['depth'], f['properties']['name']))
    root = code_part(feats[0]['properties']['name'])
    rows, by_depth = [], {}
    for f in feats:
        p = f['properties']
        verts = [v[:2] for ring in rings(f['geometry']) for v in ring]
        lon = sum(v[0] for v in verts) / len(verts)
        lat = sum(v[1] for v in verts) / len(verts)
        rs = rings(f['geometry'])
        row = {'name': p['name'], 'level': p['level_name'], 'depth': p['depth'], 'lat': round(lat, 5), 'lon': round(lon, 5),
               '_verts': verts, '_rings': rs, '_area': max(ring_area_centroid(r)[0] for r in rs)}
        if p['depth'] > 0:
            pt = representative_point(row['_rings'])
            parents = [c for c in by_depth[p['depth'] - 1] if any(inside(pt, ring) for ring in c['_rings'])]
            if not parents:
                print(f"  dropped {p['name']} ({p['level_name']}): no parent contains it (the configurator drops it too)")
                continue
            row['parent'] = min(parents, key=lambda c: c['_area'])['code']
        row['code'] = root if p['depth'] == 0 else f"{root}_{code_part(p['name'])}"
        if any(r['code'] == row['code'] for r in rows):
            row['code'] += f"_{p['depth']}"
        rows.append(row)
        by_depth.setdefault(p['depth'], []).append(row)
    for r in rows:
        r.pop('_verts'), r.pop('_rings'), r.pop('_area'), r.pop('depth')
    json.dump(rows, open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(f'{out}: ' + ', '.join(f'{n} {lvl}' for lvl, n in Counter(r['level'] for r in rows).items()))
    kids = Counter(r.get('parent') for r in rows if r['level'] == rows[-1]['level'])
    print('children per parent (lowest level):', sorted(kids.values()))


if __name__ == '__main__':
    main(*sys.argv[1:4])
