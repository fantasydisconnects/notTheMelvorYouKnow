# Super Awesome Expansion!

Super Awesome Expansion (SAE) is a content mod for [Melvor Idle](https://melvoridle.com/), created by EdwinNarwhal.
It expands the game with new items, monsters, combat challenges, spells, and skilling content, alongside changes to
existing content and balance.

## Features

- Equipment, consumables, recipes, and other items across combat and non-combat skills.
- Monsters, combat areas, dungeons, and strongholds.
- Spells, combat effects, and skill upgrades.
- Additional farming, cooking, and other skilling content.
- Conditional content integrations for Throne of the Herald, Atlas of Discovery, and selected mods.

SAE is an evolving mod: content and balance can change between updates. Back up your saves regularly.

## Installation

Install SAE through Melvor Idle's mod manager. The [official mod.io page](https://mod.io/g/melvoridle/m/super-awesome-expansion)
contains the mod description, downloads, and discussion.

## Development

The mod's entry point and loaded data files are declared in `manifest.json`. Game data and runtime patches live in
`src/`; images live in `assets/`.

The build tools require Node.js 22 or newer:

```sh
npm ci
npm run assets -- check
npm test
npm run build -- --bundled
```

Generated ZIPs and build reports are written to `dist/`. Builds support bundled images or externally hosted images.
See the [build and asset hosting guide](.info/MAINTAINER.md) for R2 configuration, uploads, image replacement, and
remote ZIP builds.

## Documentation

- [Changelog](.info/CHANGELOG.txt)
- [Content reference](.info/wiki.md)
- [Art credits](.info/ART%20CREDITS.txt)
- [Build and asset hosting](.info/MAINTAINER.md)
