// core/share.js
// A whole scene in a link: the pose document, deflated and base64url-encoded into the URL's #p=… part.
// Nothing is uploaded anywhere; the link itself is the data. Imported models can't travel this way.

const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** "z…" = deflated, "j…" = plain (browsers without CompressionStream). */
export async function encodeShare(doc) {
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream === "undefined") return "j" + b64(raw);
  return "z" + b64(await pipe(raw, new CompressionStream("deflate-raw")));
}

export async function decodeShare(text) {
  const bytes = unb64(text.slice(1));
  const raw = text[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}
