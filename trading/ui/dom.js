// Minimal DOM builder so the views can be expressed declaratively without a framework.
// el('div', { class: 'x', onClick: fn }, child, 'text') -> HTMLElement.

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(
      c instanceof Node ? c : document.createTextNode(String(c)),
    );
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
