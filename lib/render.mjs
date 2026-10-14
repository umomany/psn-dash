// Drops the library into the page template as inline JSON.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function render(library, template) {
  const json = JSON.stringify(library)
    .replace(/</g, "\\u003c")
    .replaceAll(LS, "\\u2028")
    .replaceAll(PS, "\\u2029");
  if (!template.includes("/*__LIBRARY__*/null")) {
    throw new Error("template.html is missing the data placeholder");
  }
  return template.replace("/*__LIBRARY__*/null", () => json);
}
