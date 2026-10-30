import { Shape, Path, ExtrudeGeometry } from "three";
import { writeSTL } from "../src/mesh.js";
export function plate({ radius = 2.4, depth = 5, tilted = false } = {}) {
  const shape = new Shape();
  shape.moveTo(-12, -10);
  shape.lineTo(12, -10);
  shape.lineTo(12, 10);
  shape.lineTo(-12, 10);
  shape.closePath();
  const hole = new Path();
  hole.absarc(0, 0, radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geom = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 32,
  });
  if (tilted) {
    geom.rotateX(0.63);
    geom.rotateY(0.37);
    geom.translate(200, 300, -40);
  }
  const pos = geom.getAttribute("position"),
    vertices = [],
    faces = [];
  for (let i = 0; i < pos.count; i++)
    vertices.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  for (let i = 0; i < vertices.length; i += 3) faces.push([i, i + 1, i + 2]);
  geom.dispose();
  return writeSTL({ vertices, faces });
}
