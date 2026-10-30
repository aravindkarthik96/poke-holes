import { parseSTL, editMesh, writeSTL } from "./mesh.js";
let model;
self.onmessage = ({ data }) => {
  try {
    let result;
    if (data.type === "import") {
      model = parseSTL(data.buffer);
      result = model;
    } else {
      if (!model) throw Error("Import an STL first.");
      result = editMesh(model, data.selected, data.delta);
      if (data.type === "export") result = writeSTL(result);
    }
    self.postMessage(
      { id: data.id, result },
      result instanceof ArrayBuffer ? [result] : [],
    );
  } catch (e) {
    self.postMessage({
      id: data.id,
      error: e.message || "The mesh could not be processed.",
    });
  }
};
