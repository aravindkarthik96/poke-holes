import { Matrix, EigenvalueDecomposition, solve } from "ml-matrix";
import { ShapeUtils, Vector2 } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
const normal = (v, f) => cross(sub(v[f[1]], v[f[0]]), sub(v[f[2]], v[f[0]]));
const average = (ps) => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
function edgesOf(faces) {
  const edges = new Map();
  faces.forEach((f, i) =>
    f.forEach((a, j) => {
      const k = key(a, f[(j + 1) % 3]);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(i);
    }),
  );
  return edges;
}
export function parseSTL(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 15)
    throw Error("This file is too short to be an STL.");
  if (buffer.byteLength > 50 * 1024 * 1024)
    throw Error("Choose an STL under 50 MB.");
  // Avoid allocating an enormous binary mesh from a malformed triangle count.
  const binary =
    buffer.byteLength >= 84 &&
    84 + new DataView(buffer).getUint32(80, true) * 50 === buffer.byteLength;
  if (
    !binary &&
    !/^\s*solid\b/i.test(new TextDecoder().decode(buffer.slice(0, 256)))
  )
    throw Error("Choose a valid binary or ASCII STL file.");
  let geometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    throw Error(
      "This STL could not be read. Try exporting it again from your CAD tool.",
    );
  }
  const positions = geometry.getAttribute("position");
  if (!positions || positions.count < 3 || positions.count % 3)
    throw Error("The STL contains no valid triangles.");
  if (positions.count / 3 > 350000) {
    geometry.dispose();
    throw Error(
      "This mesh exceeds 350,000 triangles. Decimate it before importing.",
    );
  }
  const vertices = [],
    faces = [],
    lookup = new Map();
  let face = [];
  for (let i = 0; i < positions.count; i++) {
    const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    if (!point.every(Number.isFinite)) {
      geometry.dispose();
      throw Error("The STL contains invalid coordinates.");
    }
    const cell = point.map((x) => Math.floor(x / 1e-4));
    let id;
    for (let x = -1; x <= 1 && id === undefined; x++)
      for (let y = -1; y <= 1 && id === undefined; y++)
        for (let z = -1; z <= 1 && id === undefined; z++) {
          for (const candidate of lookup.get(
            [cell[0] + x, cell[1] + y, cell[2] + z].join(","),
          ) || [])
            if (Math.hypot(...sub(point, vertices[candidate])) <= 1e-4) {
              id = candidate;
              break;
            }
        }
    if (id === undefined) {
      id = vertices.length;
      vertices.push(point);
      const k = cell.join(",");
      if (!lookup.has(k)) lookup.set(k, []);
      lookup.get(k).push(id);
    }
    face.push(id);
    if (face.length === 3) {
      if (
        new Set(face).size === 3 &&
        Math.hypot(...normal(vertices, face)) > 1e-10
      )
        faces.push(face);
      face = [];
    }
  }
  geometry.dispose();
  if (!faces.length) throw Error("The STL contains only collapsed triangles.");
  // Recenter for numerical accuracy; export adds the original offset back.
  const offset = average(vertices);
  for (const p of vertices) for (let j = 0; j < 3; j++) p[j] -= offset[j];
  const holes = detectHoles(vertices, faces);
  return { vertices, faces, holes, offset };
}
export function detectHoles(vertices, faces) {
  const normals = faces.map((f) => unit(normal(vertices, f))),
    edges = edgesOf(faces),
    adj = faces.map(() => []);
  for (const pair of edges.values())
    if (pair.length === 2) {
      const [a, b] = pair;
      if (dot(normals[a], normals[b]) > Math.cos((32 * Math.PI) / 180)) {
        adj[a].push(b);
        adj[b].push(a);
      }
    }
  const seen = new Set(),
    holes = [];
  for (let start = 0; start < faces.length; start++) {
    if (seen.has(start)) continue;
    const group = [],
      todo = [start];
    seen.add(start);
    while (todo.length) {
      const a = todo.pop();
      group.push(a);
      for (const b of adj[a])
        if (!seen.has(b)) {
          seen.add(b);
          todo.push(b);
        }
    }
    if (group.length < 12) continue;
    const cov = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (const fi of group)
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          cov[i][j] += (normals[fi][i] * normals[fi][j]) / group.length;
    const ev = new EigenvalueDecomposition(new Matrix(cov), {
      assumeSymmetric: true,
    });
    const order = [0, 1, 2].sort(
      (a, b) => ev.realEigenvalues[a] - ev.realEigenvalues[b],
    );
    if (
      ev.realEigenvalues[order[0]] > 0.002 ||
      ev.realEigenvalues[order[1]] < 0.12
    )
      continue;
    const axis = ev.eigenvectorMatrix.getColumn(order[0]),
      u = ev.eigenvectorMatrix.getColumn(order[1]),
      w = ev.eigenvectorMatrix.getColumn(order[2]);
    const vertex_ids = [...new Set(group.flatMap((fi) => faces[fi]))],
      points = vertex_ids.map((i) => vertices[i]),
      base = average(points);
    const xy = points.map((p) => [dot(sub(p, base), u), dot(sub(p, base), w)]);
    let fit;
    try {
      fit = solve(
        new Matrix(xy.map((p) => [2 * p[0], 2 * p[1], 1])),
        Matrix.columnVector(xy.map((p) => dot(p, p))),
        true,
      ).to1DArray();
    } catch {
      continue;
    }
    const radius = Math.sqrt(Math.max(0, fit[2] + fit[0] ** 2 + fit[1] ** 2));
    if (
      !Number.isFinite(radius) ||
      radius < 0.1 ||
      xy.reduce(
        (max, p) =>
          Math.max(
            max,
            Math.abs(Math.hypot(p[0] - fit[0], p[1] - fit[1]) - radius),
          ),
        0,
      ) > Math.max(0.025, radius * 0.001)
    )
      continue;
    const heights = points.map((p) => dot(sub(p, base), axis));
    const depth =
      heights.reduce((max, x) => Math.max(max, x), -Infinity) -
      heights.reduce((min, x) => Math.min(min, x), Infinity);
    if (depth < 0.1) continue;
    const center = add(base, add(mul(u, fit[0]), mul(w, fit[1])));
    const inward =
      group.reduce((sum, fi) => {
        const d = sub(average(faces[fi].map((i) => vertices[i])), center);
        return sum + dot(sub(d, mul(axis, dot(d, axis))), normals[fi]);
      }, 0) / group.length;
    if (inward > -radius * 0.7) continue;
    const angles = xy
      .map(
        (p) =>
          (Math.atan2(p[1] - fit[1], p[0] - fit[0]) + 2 * Math.PI) %
          (2 * Math.PI),
      )
      .sort((a, b) => a - b);
    let gap = angles[0] + 2 * Math.PI - angles.at(-1);
    for (let i = 1; i < angles.length; i++)
      gap = Math.max(gap, angles[i] - angles[i - 1]);
    if (gap > 0.65) continue;
    holes.push({
      id: holes.length,
      diameter: 2 * radius,
      depth,
      center,
      axis,
      vertex_ids,
      face_ids: group,
    });
  }
  return holes;
}
function repair(vertices, original, faces, bad) {
  const normals = faces.map((f) => unit(normal(original, f))),
    edges = edgesOf(faces),
    adj = faces.map(() => []);
  for (const pair of edges.values())
    if (pair.length === 2) {
      const [a, b] = pair;
      if (dot(normals[a], normals[b]) > 1 - 1e-3) {
        adj[a].push(b);
        adj[b].push(a);
      }
    }
  const removed = new Set(),
    replacements = [];
  for (const start of bad) {
    if (removed.has(start)) continue;
    // A thin triangle's normal can be noisy in float32 STL coordinates. Use
    // the largest nearby face as a stable reference and keep growth planar.
    const local = new Set([start, ...adj[start]]);
    for (const fi of [...local]) for (const next of adj[fi]) local.add(next);
    const reference = [...local].reduce(
      (best, fi) =>
        Math.hypot(...normal(original, faces[fi])) >
        Math.hypot(...normal(original, faces[best]))
          ? fi
          : best,
      start,
    );
    const planeNormal = unit(normal(original, faces[reference])),
      planePoint = original[faces[reference][0]];
    const planar = (fi) =>
      dot(normals[fi], planeNormal) > 0.99 &&
      faces[fi].every(
        (vi) =>
          Math.abs(dot(sub(original[vi], planePoint), planeNormal)) < 0.0001,
      );
    const group = new Set([start]),
      todo = [start];
    while (todo.length)
      for (const b of adj[todo.pop()])
        if (!group.has(b) && planar(b)) {
          group.add(b);
          todo.push(b);
        }
    if (group.size < 2 || !planar(start))
      throw Error(
        "This change would distort a curved surface. Try a smaller diameter change.",
      );
    const following = new Map();
    let boundaryCount = 0;
    for (const fi of group)
      faces[fi].forEach((a, j) => {
        const b = faces[fi][(j + 1) % 3];
        if (edges.get(key(a, b)).filter((x) => group.has(x)).length === 1) {
          following.set(a, b);
          boundaryCount++;
        }
      });
    if (following.size !== boundaryCount)
      throw Error(
        "The surrounding surface has a non-manifold boundary. Repair the source STL first.",
      );
    const loops = [];
    while (following.size) {
      const first = following.keys().next().value,
        loop = [];
      let current = first;
      do {
        loop.push(current);
        if (!following.has(current))
          throw Error("The surrounding surface is open.");
        const next = following.get(current);
        following.delete(current);
        current = next;
      } while (current !== first);
      loops.push(loop);
    }
    const n = planeNormal,
      drop = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),
      dims = [0, 1, 2].filter((i) => i !== drop);
    const xy = (id) => dims.map((i) => vertices[id][i]);
    const area = (loop) =>
      Math.abs(
        loop.reduce((s, id, i) => {
          const a = xy(id),
            b = xy(loop[(i + 1) % loop.length]);
          return s + a[0] * b[1] - a[1] * b[0];
        }, 0),
      );
    loops.sort((a, b) => area(b) - area(a));
    // Earcut expects one exterior and inner loops without crossings.
    const segments = loops.flatMap((loop) =>
      loop.map((a, i) => [a, loop[(i + 1) % loop.length]]),
    );
    const orient = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (segments.length > 5000)
      throw Error(
        "This planar surface is too complex to repair in the browser.",
      );
    for (let i = 0; i < segments.length; i++)
      for (let j = i + 1; j < segments.length; j++) {
        const [a, b] = segments[i],
          [c, d] = segments[j];
        if (a === c || a === d || b === c || b === d) continue;
        const pa = xy(a),
          pb = xy(b),
          pc = xy(c),
          pd = xy(d);
        if (
          orient(pa, pb, pc) * orient(pa, pb, pd) < -1e-12 &&
          orient(pc, pd, pa) * orient(pc, pd, pb) < -1e-12
        )
          throw Error(
            "The new hole boundary intersects another boundary. Use a smaller diameter change.",
          );
      }
    const points = loops.flat();
    const result = ShapeUtils.triangulateShape(
      loops[0].map((i) => new Vector2(...xy(i))),
      loops.slice(1).map((loop) => loop.map((i) => new Vector2(...xy(i)))),
    );
    if (!result.length)
      throw Error("The surrounding surface could not be rebuilt.");
    for (const tri of result) {
      const f = tri.map((i) => points[i]),
        newNormal = normal(vertices, f);
      if (Math.hypot(...newNormal) < 1e-10)
        throw Error("This change would collapse a triangle.");
      if (dot(newNormal, n) < 0) f.reverse();
      replacements.push(f);
    }
    for (const fi of group) removed.add(fi);
  }
  const result = faces.filter((_, i) => !removed.has(i)).concat(replacements);
  if (
    [...edges.values()].every((x) => x.length === 2) &&
    ![...edgesOf(result).values()].every((x) => x.length === 2)
  )
    throw Error(
      "This edit would leave an open mesh. Try a smaller diameter change.",
    );
  return result;
}
export function editMesh(model, selected, delta) {
  if (!Number.isFinite(delta) || delta === 0)
    throw Error("Enter a diameter change greater than zero.");
  if (!selected.length || new Set(selected).size !== selected.length)
    throw Error("Select at least one hole.");
  const vertices = model.vertices.map((p) => [...p]),
    moved = new Map();
  for (const id of selected) {
    const h = model.holes[id];
    if (!h) throw Error("Unknown hole selection.");
    if (h.diameter + delta < 0.2)
      throw Error("The resulting hole must be at least 0.2 mm in diameter.");
    for (const vi of h.vertex_ids) {
      const d = sub(model.vertices[vi], h.center),
        rad = sub(d, mul(h.axis, dot(d, h.axis))),
        shift = mul(unit(rad), delta / 2);
      if (moved.has(vi) && Math.hypot(...sub(moved.get(vi), shift)) > 1e-5)
        throw Error("These holes share vertices. Edit them separately.");
      moved.set(vi, shift);
    }
  }
  for (const [vi, shift] of moved) vertices[vi] = add(vertices[vi], shift);
  const bad = [];
  for (let i = 0; i < model.faces.length; i++) {
    const f = model.faces[i];
    if (dot(normal(vertices, f), normal(model.vertices, f)) <= 1e-12)
      bad.push(i);
  }
  const faces = bad.length
    ? repair(vertices, model.vertices, model.faces, bad)
    : model.faces;
  return { vertices, faces, offset: model.offset };
}
export function writeSTL(model) {
  const bytes = new ArrayBuffer(84 + 50 * model.faces.length),
    view = new DataView(bytes);
  new Uint8Array(bytes).set(
    new TextEncoder().encode("pokeholes | millimetres"),
  );
  view.setUint32(80, model.faces.length, true);
  model.faces.forEach((face, i) => {
    let pos = 84 + i * 50;
    const values = [
      ...unit(normal(model.vertices, face)),
      ...face.flatMap((id) =>
        add(model.vertices[id], model.offset || [0, 0, 0]),
      ),
    ];
    for (const value of values) {
      view.setFloat32(pos, value, true);
      pos += 4;
    }
    view.setUint16(pos, 0, true);
  });
  return bytes;
}
