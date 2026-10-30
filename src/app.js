import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
let serial = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const task = pending.get(data.id);
  if (!task) return;
  pending.delete(data.id);
  data.error ? task.reject(Error(data.error)) : task.resolve(data.result);
};
worker.onerror = () => {
  for (const task of pending.values())
    task.reject(
      Error("Mesh processing stopped. Reload the page and try a smaller STL."),
    );
  pending.clear();
};
function request(type, data = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...data }, transfer);
  });
}
let parts = [],
  partId = null,
  model = null,
  selected = new Set(),
  mesh,
  overlays = [],
  loadToken = 0,
  loading = false,
  exactPreview = null,
  previewToken = 0,
  previewTimer,
  exporting = false;
const viewport = $("viewport"),
  scene = new THREE.Scene();
scene.background = new THREE.Color("#e3edf3");
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000);
camera.up.set(0, 0, 1);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  $("status").textContent =
    "WebGL is unavailable. Enable hardware acceleration or try another browser.";
  throw Error("WebGL unavailable");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x69889c, 2.6));
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(100, -80, 140);
scene.add(light);
const fill = new THREE.DirectionalLight(0xc9e7ff, 2);
fill.position.set(-100, 70, 50);
scene.add(fill);
let size = 50,
  center = new THREE.Vector3();
const normalMat = new THREE.MeshStandardMaterial({
  color: 0xadc2cf,
  roughness: 0.65,
  metalness: 0.13,
  side: THREE.DoubleSide,
});
const holeMats = [0x087ea4, 0xd57833].map(
  (color) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
);
function delta() {
  const amount = Number($("reduction").value);
  return Number.isFinite(amount) && amount > 0 && amount <= 100
    ? amount * Number($("direction").value)
    : null;
}
function geometry(vertices, faces) {
  const arr = new Float32Array(faces.length * 9);
  faces.forEach((f, i) =>
    f.forEach((vi, j) => arr.set(vertices[vi], i * 9 + j * 3)),
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}
function clearScene() {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  }
  overlays.forEach((o) => {
    scene.remove(o);
    o.geometry.dispose();
  });
  overlays = [];
}
function draw() {
  clearScene();
  if (!model) return;
  const current = $("preview").checked && exactPreview ? exactPreview : model;
  mesh = new THREE.Mesh(geometry(current.vertices, current.faces), normalMat);
  scene.add(mesh);
  for (const h of model.holes) {
    const o = new THREE.Mesh(
      geometry(
        current.vertices,
        h.face_ids.map((i) => model.faces[i]),
      ),
      holeMats[selected.has(h.id) ? 1 : 0],
    );
    o.userData.holeId = h.id;
    scene.add(o);
    overlays.push(o);
  }
}
function fit(view = "iso") {
  if (!model) return;
  const dirs = {
    top: [0, 0, 1],
    front: [0, -1, 0],
    side: [1, 0, 0],
    iso: [1, -1, 1],
  };
  const direction = new THREE.Vector3(...dirs[view]).normalize();
  camera.up.set(...(view === "top" ? [0, 1, 0] : [0, 0, 1]));
  const aspect = viewport.clientWidth / viewport.clientHeight;
  const distance =
    (size / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
    Math.max(1, 1 / aspect) *
    1.2;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.001, size / 10000);
  camera.far = size * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}
function update() {
  exactPreview = null;
  const token = ++previewToken;
  clearTimeout(previewTimer);
  const change = delta();
  let valid = change !== null && selected.size > 0 && !loading && !exporting;
  const labels = [];
  for (const h of model?.holes || []) {
    const check = $("hole-" + h.id);
    if (check) check.checked = selected.has(h.id);
    if (selected.has(h.id)) {
      if (h.diameter + change < 0.2) valid = false;
      const text = `${h.diameter.toFixed(2)} → ${(h.diameter + (change || 0)).toFixed(2)} mm`;
      if (!labels.includes(text)) labels.push(text);
    }
  }
  $("export").disabled = true;
  $("change-info").textContent =
    change === null
      ? "Enter a change greater than 0 and up to 100 mm."
      : selected.size
        ? `${selected.size} hole${selected.size === 1 ? "" : "s"} selected. ${labels.join("; ")}${valid ? "" : ". Choose a smaller change."}`
        : "Select a hole to see its new diameter.";
  $("export-status").textContent = "";
  draw();
  if (valid) {
    $("export-status").textContent = "Checking edited geometry…";
    const id = partId,
      chosen = [...selected];
    previewTimer = setTimeout(async () => {
      try {
        const result = await request("preview", {
          selected: chosen,
          delta: change,
        });
        if (token !== previewToken || id !== partId) return;
        exactPreview = result;
        $("export-status").textContent = "";
        $("export").disabled = false;
        draw();
      } catch (e) {
        if (token === previewToken) {
          $("export-status").textContent = e.message;
          $("export").disabled = true;
        }
      }
    }, 180);
  }
}
function toggle(id) {
  if (loading || exporting) return;
  selected.has(id) ? selected.delete(id) : selected.add(id);
  update();
}
function listParts() {
  const query = $("search").value.toLowerCase();
  $("parts").replaceChildren();
  for (const p of parts.filter((p) => p.name.toLowerCase().includes(query))) {
    const b = document.createElement("button");
    b.textContent = p.name;
    b.className = p.id === partId ? "active" : "";
    b.setAttribute("aria-current", p.id === partId ? "true" : "false");
    b.disabled = loading || exporting;
    const meta = document.createElement("span");
    meta.className = "model-meta";
    meta.textContent = `${(p.buffer.byteLength / 1024).toFixed(0)} KB`;
    b.append(meta);
    b.onclick = () => load(p.id);
    $("parts").append(b);
  }
}
function holeList() {
  $("holes").replaceChildren();
  for (const h of model.holes) {
    const label = document.createElement("label");
    label.className = "hole";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "hole-" + h.id;
    input.onchange = () => toggle(h.id);
    const detail = document.createElement("div"),
      title = document.createElement("strong");
    title.textContent = "Hole " + (h.id + 1);
    const subtitle = document.createElement("small");
    subtitle.textContent = `${h.depth.toFixed(2)} mm deep`;
    detail.append(title, subtitle);
    const diameter = document.createElement("span");
    diameter.className = "diameter";
    diameter.textContent = "Ø " + h.diameter.toFixed(2);
    label.append(input, detail, diameter);
    $("holes").append(label);
  }
}
async function load(id) {
  const token = ++loadToken;
  loading = true;
  partId = id;
  exactPreview = null;
  ++previewToken;
  clearTimeout(previewTimer);
  selected.clear();
  model = null;
  clearScene();
  listParts();
  $("holes").replaceChildren();
  $("export").disabled = true;
  $("status").textContent = "Finding cylindrical holes…";
  const part = parts.find((p) => p.id === id);
  $("part-name").textContent = part.name;
  try {
    const buffer = part.buffer.slice(0);
    const data = await request("import", { buffer }, [buffer]);
    if (token !== loadToken) return;
    model = data;
    loading = false;
    const box = new THREE.Box3();
    for (const point of model.vertices)
      box.expandByPoint(new THREE.Vector3(...point));
    box.getCenter(center);
    size = Math.max(0.1, box.getSize(new THREE.Vector3()).length());
    $("part-info").textContent =
      `${model.holes.length} cylindrical holes · ${model.faces.length.toLocaleString()} triangles · mm`;
    $("status").textContent = model.holes.length
      ? ""
      : "No complete cylindrical holes found. Partial, tapered, or irregular openings are not supported.";
    holeList();
    listParts();
    update();
    fit();
  } catch (e) {
    if (token !== loadToken) return;
    loading = false;
    model = null;
    clearScene();
    listParts();
    $("status").textContent = e.message;
    $("part-info").textContent =
      "Import a different STL or repair this mesh in your CAD tool.";
  }
}
async function importFiles(files) {
  if (loading || exporting) return;
  const incoming = [...files];
  let first = null;
  const errors = [];
  for (const file of incoming) {
    if (!/\.stl$/i.test(file.name)) {
      errors.push(`${file.name}: choose an .stl file.`);
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      errors.push(`${file.name}: the limit is 50 MB.`);
      continue;
    }
    if (
      parts.reduce((sum, p) => sum + p.buffer.byteLength, 0) + file.size >
      150 * 1024 * 1024
    ) {
      errors.push(
        "The session limit is 150 MB. Reload to start a new session.",
      );
      break;
    }
    const part = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.stl$/i, ""),
      buffer: await file.arrayBuffer(),
    };
    parts.push(part);
    first ??= part.id;
  }
  listParts();
  if (first) await load(first);
  $("import-status").textContent = errors.join(" ");
}
const importStatus = document.createElement("p");
importStatus.id = "import-status";
importStatus.setAttribute("role", "status");
$("search").after(importStatus);
$("import").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  await importFiles(e.target.files);
  e.target.value = "";
};
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("dragging");
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  await importFiles(e.dataTransfer.files);
});
const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
let down;
renderer.domElement.addEventListener("pointerdown", (e) => {
  down = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (
    e.button !== 0 ||
    !down ||
    Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 ||
    loading ||
    !mesh
  )
    return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects([mesh, ...overlays]);
  if (!hits.length) return;
  const hit = hits.find(
    (x) =>
      x.object.userData.holeId !== undefined &&
      x.distance <= hits[0].distance + Math.max(0.001, size * 0.0001),
  );
  if (hit) toggle(hit.object.userData.holeId);
});
$("search").oninput = listParts;
$("reduction").oninput = update;
$("direction").onchange = update;
$("preview").onchange = () => draw();
$("clear").onclick = () => {
  selected.clear();
  update();
};
$("select-inserts").onclick = () => {
  if (!model || loading) return;
  selected = new Set(model.holes.map((h) => h.id));
  update();
};
$("reset-view").onclick = () => fit();
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => fit(b.dataset.view)));
$("export").onclick = async () => {
  if (!model || loading || exporting || !exactPreview) return;
  const amount = delta(),
    name = parts.find((p) => p.id === partId).name;
  exporting = true;
  $("export").disabled = true;
  listParts();
  try {
    const bytes = await request("export", {
      selected: [...selected],
      delta: amount,
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" })),
      a = document.createElement("a");
    a.href = url;
    a.download = `${name}_holes_${amount > 0 ? "plus" : "minus"}_${Math.abs(amount)}mm.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $("export-status").textContent =
      "Edited STL downloaded. Original file preserved.";
  } catch (e) {
    $("export-status").textContent = e.message;
  } finally {
    exporting = false;
    $("export").disabled = !exactPreview;
    listParts();
  }
};
new ResizeObserver(() => {
  const w = viewport.clientWidth,
    h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(viewport);
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
