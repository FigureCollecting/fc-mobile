import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, options, render, type ComponentChildren, type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { releaseReplacedVNodes } from '../releaseReplacedVNodes';

/** Preact 10's own fields on a vnode (mangled): its children and its DOM. */
type Internal = { __k?: (Internal | null)[] | null; __e?: Node | null };

/** Every DOM node a vnode's tree still reaches. */
function reachableDom(vnode: unknown, out: Node[] = []): Node[] {
  const v = vnode as Internal | null;
  if (!v) return out;
  if (v.__e) out.push(v.__e);
  for (const child of v.__k ?? []) reachableDom(child, out);
  return out;
}

const detached = (nodes: Node[]) => nodes.filter((n) => !n.isConnected);

/** A list that drops its first `dropped` items when told to: it renders itself, as the case view culls on a walk. */
let drop: (n: number) => void = () => {};
function Walker({ items }: { items: string[] }) {
  const [dropped, setDropped] = useState(0);
  drop = setDropped;
  return (
    <ul>
      {items.slice(dropped).map((id) => (
        <li key={id} id={id}>
          <span>{id}</span>
        </li>
      ))}
    </ul>
  );
}

/** The JSX the page rendered last: what its parent keeps (props.children) while the walker renders itself. */
let lastPageJsx: VNode | null = null;
function Page({ items }: { items: string[] }) {
  lastPageJsx = <Walker items={items} />;
  return <main>{lastPageJsx}</main>;
}

/** A frame that renders itself and passes its children through untouched (the same vnode objects each time). */
let bump: () => void = () => {};
function Frame({ children }: { children: ComponentChildren }) {
  const [n, setN] = useState(0);
  bump = () => setN((x) => x + 1);
  return <section data-n={n}>{children}</section>;
}

const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f'];

let host: HTMLElement;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  uninstall?.();
  uninstall = undefined;
  lastPageJsx = null;
});

describe('releaseReplacedVNodes', () => {
  it('a component that renders itself leaves its parent no way to the DOM it removed', () => {
    uninstall = releaseReplacedVNodes();
    act(() => render(<Page items={ITEMS} />, host));
    act(() => drop(3));
    expect(host.querySelectorAll('li')).toHaveLength(3);
    // the page's last JSX is the walker's vnode it replaced: it reaches nothing the walker took away
    expect(detached(reachableDom(lastPageJsx))).toEqual([]);
    act(() => drop(5));
    expect(detached(reachableDom(lastPageJsx))).toEqual([]);
  });

  it('keeps every DOM node the component still draws, across its own renders and its parent passing it through', () => {
    uninstall = releaseReplacedVNodes();
    const walker = <Walker items={ITEMS} />;
    act(() => render(<Frame>{walker}</Frame>, host));
    const f = host.querySelector('#f');
    act(() => drop(2));
    // the frame renders itself with the same child vnode: it takes the walker's current tree, not the one it replaced
    act(() => bump());
    expect(host.querySelector('section')!.dataset.n).toBe('1');
    expect([...host.querySelectorAll('li')].map((li) => li.id)).toEqual(['c', 'd', 'e', 'f']);
    act(() => drop(4));
    act(() => bump());
    expect([...host.querySelectorAll('li')].map((li) => li.id)).toEqual(['e', 'f']);
    // the same element all along: nothing was remounted
    expect(host.querySelector('#f')).toBe(f);
    act(() => drop(0));
    expect([...host.querySelectorAll('li')].map((li) => li.id)).toEqual(ITEMS);
    expect(host.querySelector('#f')).toBe(f);
  });

  it('releases the vnode a parent render replaces, keeping the DOM the new one draws', () => {
    uninstall = releaseReplacedVNodes();
    act(() => render(<Page items={ITEMS} />, host));
    const first = lastPageJsx;
    const d = host.querySelector('#d');
    act(() => render(<Page items={ITEMS.slice(3)} />, host));
    // the replaced vnode keeps its own element (the list, still drawn) and nothing under it
    expect(reachableDom(first)).toEqual([host.querySelector('ul')]);
    expect(host.querySelector('#d')).toBe(d);
    expect(detached(reachableDom(lastPageJsx))).toEqual([]);
  });

  it('a class component that renders itself releases its replaced vnode too, and unmounts cleanly', () => {
    uninstall = releaseReplacedVNodes();
    let show: (on: boolean) => void = () => {};
    class Toggle extends Component<object, { on: boolean }> {
      state = { on: true };
      render() {
        show = (on) => this.setState({ on });
        return <div>{this.state.on && <p id="p">on</p>}</div>;
      }
    }
    const jsx = <Toggle />;
    act(() => render(<main>{jsx}</main>, host));
    act(() => show(false));
    expect(host.querySelector('#p')).toBeNull();
    expect(detached(reachableDom(jsx))).toEqual([]);
    act(() => render(null, host));
    expect(host.childNodes).toHaveLength(0);
  });

  it('chains the hook it found and puts it back when uninstalled', () => {
    const before = options.diffed;
    const seen = vi.fn();
    options.diffed = seen;
    try {
      const off = releaseReplacedVNodes();
      act(() => render(<Page items={ITEMS} />, host));
      expect(seen).toHaveBeenCalled();
      off();
      expect(options.diffed).toBe(seen);
    } finally {
      options.diffed = before;
    }
  });

  it('without it, the parent keeps the DOM the component removed (Preact 10 renderComponent)', () => {
    act(() => render(<Page items={ITEMS} />, host));
    // the first render of its own unmounts what it drops from the replaced vnode's tree; from the second on, that tree
    // keeps what the component draws in between and then removes
    act(() => drop(3));
    act(() => drop(5));
    const spans = detached(reachableDom(lastPageJsx)).filter((n) => n.nodeName === 'SPAN');
    expect(spans.map((n) => n.textContent)).toEqual(['d', 'e']);
  });
});
