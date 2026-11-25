# Rummage

A search with no search bar. You find things the way you would at home: open a bag, push things aside, and pick up what you're after.

**Try it on your phone:** https://euchariadesigns.github.io/rummage/

## How it works

- **Bags are categories.** Pick Everyday, Fabrics or Occasion and the bag opens onto a pile.
- **Drag to dig.** Pull a piece and it comes to the top. Whatever was lying on it gets dragged along a little.
- **Flick to toss.** Let go mid-swipe and it slides away, spinning from where you held it.
- **Tap to pick up.** The piece lifts out so you can see the fabric, size and colours. Keep it or toss it back.
- **Looking for something.** The card at the bottom names one piece hidden in the pile. Its meter goes from *Buried deep* to *Right on top* as you uncover it. Leave the pile alone for a few seconds and the piece twitches. Tap the card to look for something else.
- **Shake** the bag to reshuffle everything.

Pieces deeper in the pile sit in shadow and brighten as you uncover them.

## Run it locally

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Files

- `index.html`: screens (closet, pile, pick-up card, basket)
- `css/styles.css`: styles, light and dark
- `js/data.js`: the sample wardrobe
- `js/garments.js`: garment shapes and fabric patterns, drawn as SVG
- `js/app.js`: pile physics, digging, picking up, basket
