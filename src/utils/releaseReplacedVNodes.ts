/**
 * MEM-1: Preact 10 (10.29.8, src/component.js renderComponent) draws a component that renders itself into a copy of
 * its vnode and drops the vnode it replaced from the tree, but not from where its parent's last render put it (that
 * render's props.children), and that vnode keeps the children it drew: every DOM node they reach stays alive, detached,
 * after the component removes it, until the parent renders again. The case view walks the wall by rendering itself,
 * so the cabinets and figures it drew when the collection page last rendered stayed alive with their pictures' style
 * (on 4d3333b3, about 7,000 nodes two steps along the wall at the Fold8's open panel: e2e/screens/case-memory.spec.ts).
 * Once a component has drawn a new vnode, the one it replaced lets go of its children: Preact never reads them again
 * (a parent passing the same vnode through takes the component's current children, src/diff/index.js).
 */
import { options, type VNode } from 'preact';

/** Preact 10's own fields (mangled, as in its dist): a vnode's component and children. */
interface Drawn {
  __c?: object | null;
  __k?: unknown[] | null;
}

/** Hooks options.diffed (chaining the hook already there); returns what puts that hook back. */
export function releaseReplacedVNodes(): () => void {
  const last = new WeakMap<object, Drawn>();
  const prior = options.diffed;
  options.diffed = (vnode: VNode) => {
    const drawn = vnode as unknown as Drawn;
    const component = drawn.__c;
    if (component) {
      const replaced = last.get(component);
      if (replaced !== undefined && replaced !== drawn) replaced.__k = null;
      last.set(component, drawn);
    }
    prior?.(vnode);
  };
  return () => {
    options.diffed = prior;
  };
}
