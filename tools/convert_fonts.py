#!/usr/bin/env python3
"""Convert NEXUS repo woff2 variable fonts -> static TTF instances (merged Latin+Cyrillic)."""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.merge import Merger

SRC = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fonts')
OUT = os.path.join(os.path.dirname(__file__), 'fonts')
os.makedirs(OUT, exist_ok=True)

def decompress(path):
    f = TTFont(path)
    f.flavor = None
    return f

def static_instance(font, wght):
    try:
        instantiateVariableFont(font, {'wght': wght}, inplace=True)
    except Exception as e:
        print(f"  (instancer note: {e})")
    return font

def merge_pair(cyr_path, lat_path, wght, out_base):
    cyr = static_instance(decompress(cyr_path), wght)
    lat = static_instance(decompress(lat_path), wght)
    cyr_tmp = os.path.join(OUT, '_cyr.tmp.ttf')
    lat_tmp = os.path.join(OUT, '_lat.tmp.ttf')
    cyr.save(cyr_tmp)
    lat.save(lat_tmp)
    try:
        merged = Merger().merge([cyr_tmp, lat_tmp])
        merged.save(os.path.join(OUT, out_base + '.ttf'))
        print(f'  merged -> {out_base}.ttf')
    except Exception as e:
        print(f'  MERGE FAILED {out_base}: {e} — keeping cyr+lat separately')
        os.rename(cyr_tmp, os.path.join(OUT, out_base + '-cyr.ttf'))
        os.rename(lat_tmp, os.path.join(OUT, out_base + '-lat.ttf'))

for w, name in [(400, 'Inter-Regular'), (500, 'Inter-Medium'), (600, 'Inter-SemiBold'), (700, 'Inter-Bold'), (800, 'Inter-ExtraBold')]:
    merge_pair(f'{SRC}/inter-cyrillic-wght-normal.woff2', f'{SRC}/inter-latin-wght-normal.woff2', w, name)

for w, name in [(400, 'JBMono-Regular'), (500, 'JBMono-Medium'), (700, 'JBMono-Bold')]:
    merge_pair(f'{SRC}/jetbrains-mono-cyrillic-wght-normal.woff2', f'{SRC}/jetbrains-mono-latin-wght-normal.woff2', w, name)

for w, name in [(400, 'SpaceGrotesk-Regular'), (500, 'SpaceGrotesk-Medium'), (700, 'SpaceGrotesk-Bold')]:
    f = static_instance(decompress(f'{SRC}/space-grotesk-latin-wght-normal.woff2'), w)
    f.save(os.path.join(OUT, name + '.ttf'))
    print(f'  -> {name}.ttf')

print('done')
