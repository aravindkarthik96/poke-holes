import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSTL, editMesh, writeSTL } from "../src/mesh.js";
import { plate } from "./fixture.js";
function edges(faces) {
  const result = new Map();
  for (const f of faces)
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3],
        k = [Math.min(a, b), Math.max(a, b)].join(",");
      result.set(k, (result.get(k) || 0) + 1);
    }
  return [...result.values()];
}
for (const tilted of [false, true])
  for (const delta of [-0.5, 0.5])
    test(`resizes ${tilted ? "tilted" : "straight"} hole by ${delta} mm and exports a closed mesh`, () => {
      const model = parseSTL(plate({ tilted }));
      assert.equal(model.holes.length, 1);
      assert.ok(Math.abs(model.holes[0].diameter - 4.8) < 0.001);
      const edited = editMesh(model, [0], delta),
        again = parseSTL(writeSTL(edited));
      assert.equal(again.holes.length, 1);
      assert.ok(Math.abs(again.holes[0].diameter - (4.8 + delta)) < 0.001);
      assert.ok(edges(again.faces).every((n) => n === 2));
      const moved = new Set(model.holes[0].vertex_ids);
      model.vertices.forEach((p, i) => {
        if (!moved.has(i)) assert.deepEqual(edited.vertices[i], p);
      });
      const originalBox = model.vertices.reduce(
        (acc, p) =>
          acc.map((r, j) => [Math.min(r[0], p[j]), Math.max(r[1], p[j])]),
        [
          [Infinity, -Infinity],
          [Infinity, -Infinity],
          [Infinity, -Infinity],
        ],
      );
      assert.ok(originalBox.every((r) => r[1] > r[0]));
      assert.deepEqual(edited.offset, model.offset);
    });
test("rejects invalid input and collapsed diameters", () => {
  assert.throws(() => parseSTL(new ArrayBuffer(5)));
  assert.throws(() =>
    parseSTL(new TextEncoder().encode("this is not an stl file").buffer),
  );
  const model = parseSTL(plate());
  assert.throws(() => editMesh(model, [0], -4.7));
  assert.throws(() => editMesh(model, [], 0.5));
  assert.throws(() => editMesh(model, [99], 0.5));
  assert.throws(() => editMesh(model, [0], NaN));
});
test("supports ASCII STL with no holes", () => {
  const buffer = new TextEncoder().encode(
    "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle",
  ).buffer;
  const model = parseSTL(buffer);
  assert.equal(model.faces.length, 1);
  assert.equal(model.holes.length, 0);
});

test("rejects an enlargement crossing the outside boundary", () => {
  const model = parseSTL(plate());
  assert.throws(
    () => editMesh(model, [0], 25),
    /intersects|open mesh|collapse/,
  );
});
