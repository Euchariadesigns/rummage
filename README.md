# Rummage

A search with no search bar. You find things the way you would at home: open a bag, dig through the pile, throw things aside, and pick up what you're after.

**Try it on your phone:** https://euchariadesigns.github.io/rummage/

## How it works

- **Bags are categories.** Pick a bag and you look down at it, sitting on the floor, full of clothes.
- **Pull a piece up.** Pinch it anywhere and it rises out of the bag toward you, hanging from where you hold it, with its name above it. Whatever was lying on it slides off.
- **Fling it out.** Swipe and let go: it flies over the side and lands on the floor next to the bag. The bag gets emptier, you get deeper. You can dig through the floor pile too.
- **Tap to look.** The piece lifts out so you can see it properly. Keep it or toss it back in.
- **Looking for something.** The card at the bottom names one piece hidden in the pile. Its meter goes from *Buried deep* to *Right on top* as you uncover it. Pull it out and let go gently, and it opens for a proper look. Leave the pile alone for a few seconds and it rustles under the others. Tap the card to look for something else.
- **Shake** the bag and everything inside jumps and lands in a new order. When the bag is nearly empty, the button becomes **Refill** and tips everything on the floor back in.

Buried pieces sit in shadow and come out of the dark as you uncover them. The pile uses real physics: [three.js](https://threejs.org) draws it and [Rapier](https://rapier.rs) moves it.

## The clothes

The 27 pieces in the three bags (Everyday, Fabrics, Outerwear) are cut out of free photos from [Pexels](https://www.pexels.com). [assets/clothes/CREDITS.md](assets/clothes/CREDITS.md) lists the photo behind each one.

## Adding clothes

1. Photograph each piece from above, on the floor. One piece per photo, or several laid apart so they don't touch. A floor that contrasts with the clothes helps.
2. Put the photos in `photos/`. A subfolder named `everyday`, `fabrics` or `outerwear` puts the piece in that bag. The file name becomes the piece's name.
3. Run `python3 tools/prepare_photos.py` (macOS). It cuts each piece out of its photo with the Mac's built-in subject lifting, shrinks it for phones and adds it to `assets/clothes/`.
4. Rename pieces or move them between bags in `assets/clothes/clothes.json`, then run the script again.

To split one photo of several pieces into separate pieces, run `.cache/cutout --split <photo> <name>` first and put the results in `photos/`.

Original photos stay in `photos/`, which is never committed. Only the cut-out pieces are published. With no photos at all, the bags fall back to sample drawings.

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
