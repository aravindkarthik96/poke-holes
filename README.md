# Holemorph

A browser-based STL editor for adjusting cylindrical hole diameters. Import your own model, select holes in the 3D view or list, make them bigger or smaller, preview the result, and download a new STL.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faravindkarthik96%2Fholemorph)

## Use it locally

Requires **Node.js 22.12 or newer** and npm.

```sh
git clone https://github.com/aravindkarthik96/holemorph.git
cd holemorph
npm ci
npm run dev
```

Open the printed local URL, import a binary or ASCII `.stl`, select one or more detected holes, and choose **Make smaller** or **Make bigger**. Enter the diameter change in millimetres. For example, making a 4.8 mm hole smaller by 0.5 mm produces a 4.3 mm hole. The preview is checked before download is enabled. Each edit starts from the imported original; importing an exported STL allows another round of edits.

Drag to orbit, scroll to zoom, and right-drag to pan. Top, Front, Side, and 3D buttons reset the camera. A colored hole wall is clickable when it is visible; use the checkbox list when the wall is hidden. Multiple files can be imported and switched between; selections reset when switching models.

## Deploy on Vercel

Use the deploy button above, or import this repository from the Vercel dashboard. The included `vercel.json` configures:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Node.js | 22.x or newer |
| Environment variables | None |

No Python service, API server, database, account system, or file storage is required. Vercel serves the static app; STL parsing and editing run in a Web Worker on the visitor's device. Model data is not uploaded. The app has no analytics or remote runtime dependencies.

## Supported geometry and limits

You can import your own STL files, but automatic hole editing does **not** support every possible opening:

- Detection targets complete, inward-facing cylindrical walls, including tilted axes, through holes, blind holes, and cylindrical sections of stepped bores. Separate sections are selected separately. It does not infer which holes are intended for inserts.
- Partial cylinders, slots, tapered/countersunk surfaces, irregular openings, inconsistent normals, damaged meshes, and coarse facets may not be detected. Normalize normals and repair meshes in a CAD tool if needed.
- STL does not store units. This app assumes millimetres. Import limit: 50 MB and 350,000 triangles per file, 150 MB total per browser session. Reload to clear the session. Coincident vertices are welded within 0.0001 mm.
- The change is a diameter adjustment, not a radius adjustment. Radial hole-wall vertices move by half the requested diameter change. Hole axes, axial depth, and original export position are retained. Shared end-ring vertices and adjoining faces move with the wall.
- When a change inverts thin triangles on an adjoining planar surface, the app triangulates that surface again. Unsupported curved repairs, conflicting shared vertices, detected crossing boundaries, and repairs that open an originally closed mesh are rejected.
- This is a mesh editor, **not a full solid CAD kernel**. It does not certify wall thickness, eliminate every possible self-intersection, or guarantee printability. Large enlargements can compromise adjacent geometry. Inspect the downloaded STL in your slicer/CAD tool and test fit before printing the final part.

Original files are never overwritten. Imported models and selections are held in memory and disappear on refresh. The repository includes generated test geometry rather than third-party STL packs.

## Development

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests check shrinking/enlarging, tilted cylinders, closed output meshes, unchanged unselected vertices, invalid input, and ASCII STL. Browser tests import a generated model, select holes, download and re-read both smaller and larger edits, check invalid diameters, and verify the mobile layout. GitHub Actions runs tests and the production build on pushes and pull requests.

`src/mesh.js` contains parsing, cylinder detection, radial editing, planar repair, and binary STL export. `src/worker.js` runs mesh work off the UI thread. `src/app.js` owns the Three.js viewer and controls.

## License

MIT. Third-party dependencies retain their own licenses. Use only models you have permission to modify.
