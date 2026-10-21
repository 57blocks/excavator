/**
 * A small DOM for the viewer tests: enough of createElement, createElementNS, text nodes, attributes,
 * children and style for the page code to build a tree that a test can read. Anything that would parse
 * markup throws, so a test also shows that the code never reaches for it.
 */

export function fakeDom() {
  const trap = (name) => { throw new Error(`${name} was used`); };
  const make = (tag, ns) => {
    const node = { tag, ns, attributes: {}, children: [], style: {}, listeners: {} };
    return new Proxy(node, {
      get(target, prop) {
        if (prop === 'setAttribute') return (name, value) => { target.attributes[name] = String(value); };
        if (prop === 'appendChild') return (child) => { target.children.push(child); return child; };
        if (prop === 'removeChild') return (child) => { target.children.splice(target.children.indexOf(child), 1); return child; };
        if (prop === 'addEventListener') return (type, fn) => { target.listeners[type] = fn; };
        if (prop === 'firstChild') return target.children[0] || null;
        if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(prop)) return trap(prop);
        return target[prop];
      },
      set(target, prop, value) {
        if (['innerHTML', 'outerHTML'].includes(prop)) return trap(prop);
        target[prop] = value;
        return true;
      },
    });
  };
  return {
    createElement: (tag) => make(tag, null),
    createElementNS: (ns, tag) => make(tag, ns),
    createTextNode: (text) => ({ text }),
  };
}

/** Every node of a tree, the node first. */
export const all = (node) => (node === null || node === undefined ? [] : [node, ...(node.children || []).flatMap(all)]);

/** The text of a tree, node text joined with nothing between. */
export const textOf = (node) => all(node).filter((n) => n.text !== undefined).map((n) => n.text).join('');

export const byTag = (node, tag) => all(node).filter((n) => n.tag === tag);
