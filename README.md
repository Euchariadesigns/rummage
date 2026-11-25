# Rummage

A search with no search bar. You find things the way you would at home: open a bag, dig through the pile, throw things aside, and pick up what you're after.

**Try it on your phone:** https://euchariadesigns.github.io/rummage/

## How it works

- **Bags are categories.** Pick a bag and you look down into it, onto a real pile.
- **Drag to dig.** Pinch a piece anywhere and it lifts out, hanging from where you hold it. Whatever was on top of it slides off.
- **Flick to throw.** Let go mid-swipe and the piece flies up toward you, tumbles and falls back onto the pile.
- **Tap to pick up.** The piece lifts out so you can look at it. Keep it or toss it back in.
- **Looking for something.** The card at the bottom names one piece hidden in the pile. Its meter goes from *Buried deep* to *Right on top* as you uncover it. Leave the pile alone for a few seconds and the piece rustles under the others. Tap the card to look for something else.
- **Shake** the bag and everything jumps and lands in a new order.

Buried pieces sit in shadow and come out of the dark as you uncover them. The pile uses real physics: [three.js](https://threejs.org) draws it and [Rapier](https://rapier.rs) moves it.

## Adding your own clothes

1. Photograph each piece from above, on the floor, one piece per photo. A floor that contrasts with the piece helps.
2. Put the photos in `photos/`. A subfolder named `everyday`, `fabrics` or `occasion` puts the piece in that bag.
3. Run `python3 tools/prepare_photos.py` (macOS). It cuts each piece out of its photo with the Mac's built-in subject lifting, shrinks it for phones and adds it to `assets/clothes/`.
4. Name the pieces in `assets/clothes/clothes.json`, then run the script again.

Your original photos stay in `photos/`, which is never committed. Only the cut-out pieces are published.

Until there are photos, the bags use sample drawings.

## Run it locally

The page loads modules and textures, so serve the folder instead of opening the file:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html`: screens (bags, pile, pick-up card, basket)
- `css/styles.css`: styles, light and dark
- `js/app.js`: screens, the thing you're looking for, basket
- `js/pile3d.js`: the 3D bag and its physics
- `js/looks.js`: loads each piece's image and works out its shape and colours
- `js/data.js`: bags and the sample wardrobe
- `js/garments.js`: the sample drawings
- `tools/prepare_photos.py`, `tools/cutout.swift`: turn photos into cut-out pieces
