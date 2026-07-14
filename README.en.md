# HF Action Editor

[中文](README.md) | **English** | [日本語](README.ja.md)

A local browser-based action and texture editor for Hero Fighter / HF-EX. It
replaces manual editing of the `Spt.json` / `Lmi` data exported by HFWorkshop:
edit action frames, texture variants, and hitboxes visually, then export
HFWorkshop-importable zip files.

## Key Features

- Supports character data exported from HFE v1.0.2 and HF-EX v0.2.5.
- Runs entirely in a local browser with no build step or CDN. Open
  `index.html` directly to start.
- Real-time Canvas preview with draw order, skeleton points, ground line,
  onion skinning, and hitbox overlays.
- Actions and frames: action list, timeline playback, frame duplication and
  deletion, and action duplication.
- Pose editing: select, rotate, move, and scale parts with an FK linkage toggle.
- Part management: add unused parts to the current frame, add an already used
  part again, and remove part entries.
- Hitbox editing: edit `editBody`, `editAttack`, and `editAttackB` visually,
  then rebake runtime hitboxes.
- Texture tools: browse variants, replace PNG files, add LimbPic variants, and
  edit anchors and joints.
- Multi-Lmi support: automatically loads all `*Lmi` folders beside the selected
  character, including parts shared across characters.
- Zip export: creates an Spt zip and one zip for each Lmi folder.

## Interface Preview

| Action Timeline and Character Preview | Pose Editing |
|---|---|
| ![Action timeline and character preview](docs/screenshots/overview.png) | ![Select a part and rotate the pose](docs/screenshots/pose-editing.png) |
| Hitbox Visualization | Texture Variants |
| ![Attack and hurt hitboxes](docs/screenshots/hitboxes.png) | ![Texture variants and anchor tools](docs/screenshots/textures.png) |

## Repository Layout

```text
HF Action Editor/
├─ index.html              # Entry page
├─ css/app.css             # UI styles
├─ docs/screenshots/       # README screenshots
├─ js/
│  ├─ app.js               # Main controller, state, save, and editing entry points
│  ├─ model.js             # Spt/Lmi model, multiple Lmi files, dirty-file tracking
│  ├─ jsonio.js            # HFWorkshop JSON parser and serializer preserving key order and number text
│  ├─ as3math.js           # AS3 Matrix compatibility, construction, and decomposition
│  ├─ skeleton.js          # Skeleton tables, default draw order, and part names
│  ├─ pose.js              # Frame poses, FK/non-linked reconstruction, and ref-reused frames
│  ├─ render.js            # Canvas rendering and hit testing
│  ├─ rebake.js            # Clip bounds, footY, matrices, and hitbox rebaking
│  ├─ fsio.js              # Folder reading and writing
│  ├─ zip.js               # Zip generation and export
│  └─ ui/                  # UI panels
├─ test/
│  ├─ all.js               # Node test entry point
│  ├─ roundtrip.js         # JSON round-trip tests
│  ├─ matrix.js            # Matrix regression tests
│  └─ browser/e2e.js       # Browser end-to-end tests
├─ 使用说明.md             # Chinese end-user guide
├─ 进度记录.md             # Implementation and verification notes
├─ README.md
├─ README.en.md
├─ README.ja.md
├─ CHANGELOG.md
└─ 维护说明.md
```

## Usage

1. Open `index.html` in Edge or Chrome.
2. Click **Open Character**, then choose the parent directory containing the
   character's exported Spt/Lmi folders. For example:

   ```text
   Character directory/
   ├─ 197 - Data.Global_taylorSpt/
   │  └─ Spt.json
   ├─ 465 - Data.Global_taylorLmi/
   │  ├─ Limb_*.json
   │  ├─ LimbPic_*.json
   │  └─ *.png
   └─ Other borrowed *Lmi/   # Optional; all sibling Lmi folders are loaded
   ```

3. Edit actions, frames, parts, hitboxes, or textures.
4. Click **Save** to write changes back to the source folders, or **Export zip**
   to create HFWorkshop-importable zip files.

### Multiple Lmi Files and Missing Parts

Hero Fighter registers Limbs globally, so a character can reference parts from
another character or a shared-effect Lmi. For example, Taylor can borrow
Lucas's fist, and Rudolf can reference another Lmi containing `rudolf_*` parts.

When the editor reports a missing part:

1. Note the Limb name shown in the warning, such as `Lucas_07LeftFist`.
2. Export the `* - Data.Global_*Lmi` that contains that Limb with HFWorkshop.
3. Place the extracted Lmi folder next to the current character directory.
4. Open the character again.

The editor loads every sibling `*Lmi` folder and parses each image pool
independently.

## Development and Testing

### Node Data and Matrix Tests

```bash
cd <repo>
node test/all.js
```

This runs:

- `test/roundtrip.js`: confirms that writing parsed HFE/HFEX sample JSON back
  out produces byte-identical files.
- `test/matrix.js`: confirms matrix decomposition and reconstruction error stays
  below `1e-6` for every frame part.

### Browser End-to-End Tests

Install dependencies once. The project uses `puppeteer-core`, so it does not
download a browser:

```bash
cd <repo>/test/browser
npm install
```

Run the tests:

```bash
cd <repo>
node test/browser/e2e.js
```

The tests drive the system Edge browser and cover loading, rendering, playback,
FK, non-linked editing, adding and removing parts, hitboxes, textures, zip
export, and multiple Lmi files.

## Git Maintenance

The repository tracks source code, tests, and documentation only. `.gitignore`
excludes:

- `node_modules/`
- `test/browser/downloads/`
- `test/browser/shots/`
- Manually exported `*.zip` files
- Temporary logs and editor state

After changing functionality, run:

```bash
node test/all.js
node test/browser/e2e.js
```

Changes involving export, footY, skeletons, hitboxes, or multiple Lmi files
also need an in-game import test.
