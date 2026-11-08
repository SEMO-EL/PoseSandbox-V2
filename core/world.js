// core/world.js
// The scene items besides the figure: props, custom lights and imported models.
// Every item keeps a uid and stays in the registry after it is removed from the scene, so undo can put it back.

import * as THREE from "three";
import { uid } from "./helpers.js";

export const PROP_TYPES = {
  cube:     { label: "Cube",     color: 0x24d2ff, geo: () => new THREE.BoxGeometry(0.4, 0.4, 0.4) },
  sphere:   { label: "Sphere",   color: 0x7c5cff, geo: () => new THREE.SphereGeometry(0.22, 32, 20) },
  cylinder: { label: "Cylinder", color: 0x42f5b0, geo: () => new THREE.CylinderGeometry(0.15, 0.15, 0.6, 32) },
  cone:     { label: "Cone",     color: 0xffc04a, geo: () => new THREE.ConeGeometry(0.2, 0.5, 32) },
  pyramid:  { label: "Pyramid",  color: 0xffc04a, geo: () => new THREE.ConeGeometry(0.26, 0.5, 4) },
  torus:    { label: "Torus",    color: 0xff5c8a, geo: () => new THREE.TorusGeometry(0.22, 0.07, 16, 40) },
  block:    { label: "Seat",     color: 0x9aa4b2, geo: () => new THREE.BoxGeometry(0.45, 0.45, 0.45) },
  step:     { label: "Step",     color: 0x9aa4b2, geo: () => new THREE.BoxGeometry(0.7, 0.2, 0.4) },
  pole:     { label: "Pole",     color: 0xd9b38c, geo: () => new THREE.CylinderGeometry(0.018, 0.018, 1.8, 16) },
  wall:     { label: "Wall",     color: 0x8a93a6, geo: () => new THREE.BoxGeometry(2, 2.4, 0.08) },
  icosa:    { label: "Icosa",    color: 0x9aa4b2, geo: () => new THREE.IcosahedronGeometry(0.24, 0) },
  plane:    { label: "Plane",    color: 0x9aa4b2, geo: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) },
  // v1 types, kept so old pose files load
  ring:     { label: "Ring",     color: 0xff5c8a, geo: () => new THREE.RingGeometry(0.14, 0.3, 40).rotateX(-Math.PI / 2) },
  disc:     { label: "Disc",     color: 0xff5c8a, geo: () => new THREE.CircleGeometry(0.32, 40).rotateX(-Math.PI / 2) },
  octa:     { label: "Octa",     color: 0x9aa4b2, geo: () => new THREE.OctahedronGeometry(0.26, 0) },
  dodeca:   { label: "Dodeca",   color: 0x9aa4b2, geo: () => new THREE.DodecahedronGeometry(0.26, 0) },
  tetra:    { label: "Tetra",    color: 0x9aa4b2, geo: () => new THREE.TetrahedronGeometry(0.3, 0) }
};

export function createWorld(scene) {
  const items = new Map(); // uid -> Object3D

  return {
    items,
    add(obj) {
      obj.userData.uid ||= uid();
      items.set(obj.userData.uid, obj);
      if (obj.parent !== scene) scene.add(obj);
      return obj;
    },
    remove(obj) {
      scene.remove(obj);
    },
    /** Items currently in the scene, optionally of one kind ("prop" | "light" | "import"). */
    live(kind) {
      return [...items.values()].filter((o) => o.parent === scene && (!kind || o.userData.kind === kind));
    }
  };
}

function markItem(root, kind) {
  root.userData.kind = kind;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = !o.userData.helper;
    o.userData.pickable = true;
    o.userData.selectRoot = root;
  });
}

/** A prop resting on the floor. */
export function createProp(type, { color } = {}) {
  const t = PROP_TYPES[type] ? type : "cube";
  const geo = PROP_TYPES[t].geo();
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // origin at the base: y = 0 is "standing on the floor"
  const mat = new THREE.MeshStandardMaterial({ color: color ?? PROP_TYPES[t].color, roughness: 0.6, metalness: 0.05, side: ["plane", "ring", "disc"].includes(t) ? THREE.DoubleSide : THREE.FrontSide });
  const g = new THREE.Group();
  g.name = PROP_TYPES[t].label;
  g.userData.type = t;
  g.add(new THREE.Mesh(geo, mat));
  markItem(g, "prop");
  return g;
}

export function propColor(prop) {
  let c = null;
  prop.traverse((o) => { if (!c && o.isMesh) c = o.material.color; });
  return c;
}

export function markImport(root, name) {
  root.name = name;
  markItem(root, "import");
  return root;
}
