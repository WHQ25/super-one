"""
Derives the native keyword font from the desktop's Tiny5 subset (A-Z only):

- a-z map to the capitals, so a keyword renders in pixel capitals while the
  draft keeps what was typed (UIKit and Android spans have no text-transform);
- the line box shrinks to the capitals plus one pixel each way, so a keyword at
  16/15 of the editor size never makes its line taller;
- it is renamed, as a Modified Version under the SIL OFL (OFL.txt).

Run from this directory: python3 build-font.py (writes ../fonts/)
"""
from fontTools.ttLib import TTFont

SOURCE = '../../../../desktop/src/renderer/src/assets/fonts/tiny5-keywords.woff2'
FAMILY = 'SuperOne Keyword Pixel'
POSTSCRIPT = 'SuperOneKeywordPixel-Regular'
PIXEL = 128  # 1/8 em at 1024 units

font = TTFont(SOURCE)
font.flavor = None
# Loading the outlines lets save() recompute the head bounding box: Android reads
# a font's top and bottom from it.
font['glyf']
for table in font['cmap'].tables:
    if table.isUnicode():
        for upper in range(ord('A'), ord('Z') + 1):
            if upper in table.cmap:
                table.cmap[upper + 32] = table.cmap[upper]
ascent, descent = font['OS/2'].sCapHeight + PIXEL, -PIXEL
font['hhea'].ascent, font['hhea'].descent, font['hhea'].lineGap = ascent, descent, 0
os2 = font['OS/2']
os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, descent, 0
os2.usWinAscent, os2.usWinDescent = ascent, -descent
os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
names = {1: FAMILY, 3: f'{POSTSCRIPT};SuperOne', 4: FAMILY, 6: POSTSCRIPT}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID]
font.save('../fonts/superone-keyword-pixel.ttf')
