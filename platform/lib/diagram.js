'use strict';

// Architecture diagrams from DSL. One view fits every level: a unit is a
// boundary with its parts inside (expanded to a depth), actors and other
// parts of the model around it, arrows between them. Arrows are references
// of the DSL resolved by the scope rules, and by-name ports of factory
// signatures, projected on what the view shows. Output is Mermaid.

const path = require('node:path');
const { Ref, isRef, isPlainObject, refsOf } = require('./parser.js');
const { ModuleLoader, signature } = require('./modules.js');
const {
  descendants,
  ancestors,
  commonUnit,
  APPLICATION_RANK,
} = require('./loader.js');
const { Resolver, ENTRY_META, pickFactory, hasCode } = require('./planner.js');

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1';
const PASS = new Set(['consumes', 'export']);
const CONTAINER = Symbol('container');
const INSIDE = new Set(['part', 'container']);
const KINDS = ['remote', 'actor', 'use', 'via'];

const consumesId = (unit, name) => `${unit.id}#consumes.${name}`;
const exportId = (unit, name) => `${unit.id}#exposes.${name}`;

// Element of an exposes entry: a re-export, or the part named like it.
const entryId = (unit, name) =>
  isRef(unit.dsl.exposes[name]) ? exportId(unit, name) : `${unit.id}.${name}`;

// Element id of a resolver target; null for definitions and config.
const targetOf = (target) => {
  if (target.kind === 'unit') return target.unit.id;
  if (target.kind === 'component') return target.component.id;
  if (target.kind === 'consumed') return consumesId(target.unit, target.name);
  if (target.kind === 'entry') return entryId(target.unit, target.name);
  return null;
};

const factoryOf = (entry) =>
  isPlainObject(entry)
    ? Object.keys(entry).find((key) => !ENTRY_META.has(key)) || null
    : null;

// Model-wide graph. Elements: units, components, entries declared without
// code ('missing'), actors and pass-throughs (consumes entries and
// re-exports) that views follow to what provides them.
class Graph {
  constructor(model, env) {
    this.model = model;
    this.resolver = new Resolver(model, env);
    this.loader = new ModuleLoader();
    this.elements = new Map();
    this.children = new Map();
    this.edges = [];
    const units = descendants(model.root);
    for (const unit of units) {
      const { id, name, parent } = unit;
      this.elements.set(id, { kind: 'unit', id, name, parent, unit });
    }
    for (const unit of units) this.addParts(unit);
    for (const unit of units) this.addEdges(unit);
  }

  add(element) {
    this.elements.set(element.id, element);
    return element;
  }

  edge(from, to, kind, label = null) {
    if (!from || !to) return null;
    const edge = { from, to, kind, label };
    this.edges.push(edge);
    return edge;
  }

  // Parts of a unit: exposed ones in exposes order, then private ones.
  addParts(unit) {
    for (const child of unit.children.values()) {
      if (child.kind !== 'component') continue;
      const { id, name } = child;
      this.add({ kind: 'component', id, name, parent: unit });
    }
    const exposed = new Set();
    for (const [name, entry] of Object.entries(unit.dsl.exposes)) {
      if (isRef(entry)) {
        if (unit.children.has(entry.head)) exposed.add(entry.head);
        continue;
      }
      if (!isPlainObject(entry)) continue;
      exposed.add(name);
      if (unit.children.has(name)) continue;
      const id = `${unit.id}.${name}`;
      this.add({ kind: 'missing', id, name, parent: unit });
    }
    const names = new Set([...exposed, ...unit.children.keys()]);
    const parts = [];
    for (const name of names) {
      const element = this.elements.get(`${unit.id}.${name}`);
      element.exposed = exposed.has(name);
      parts.push(element);
    }
    this.children.set(unit.id, parts);
  }

  addEdges(unit) {
    const { actors, consumes, exposes } = unit.dsl;
    for (const [name, value] of Object.entries(actors)) {
      const id = `${unit.id}#actors.${name}`;
      this.add({ kind: 'actor', id, name, parent: unit });
      const refs = isPlainObject(value) ? refsOf(value.consumes) : [];
      for (const ref of refs) {
        const known = Object.hasOwn(exposes, ref.head);
        this.edge(id, known ? entryId(unit, ref.head) : null, 'actor');
      }
    }
    for (const [name, value] of Object.entries(consumes)) {
      const id = consumesId(unit, name);
      const element = { kind: 'consumes', id, name, parent: unit };
      this.add(Object.assign(element, { next: null, contract: null }));
      const scope = unit.parent;
      const from = isRef(value) ? value : value?.from;
      if (isRef(from) && scope) {
        const remote = from !== value;
        const at = `${unit.id}.consumes.${name}`;
        const label = remote ? this.endpointLabel(from, scope, at) : null;
        const kind = remote ? 'remote' : 'use';
        element.next = this.edge(id, this.find(from, scope), kind, label);
        if (!element.next) element.contract = String(from);
      } else if (isRef(value?.contract)) {
        element.contract = this.contractLabel(value.contract, unit);
      }
      if (isRef(value?.via)) {
        this.edge(this.find(value.via, unit), id, 'via', 'via');
      }
    }
    for (const [name, entry] of Object.entries(exposes)) {
      if (isRef(entry)) {
        const id = exportId(unit, name);
        const element = this.add({ kind: 'export', id, name, parent: unit });
        element.next = this.edge(id, this.find(entry, unit), 'use');
        continue;
      }
      const factory = factoryOf(entry);
      const ports = factory ? entry[factory] : null;
      if (!isPlainObject(ports)) continue;
      for (const [port, value] of Object.entries(ports)) {
        for (const ref of refsOf(value)) {
          this.edge(`${unit.id}.${name}`, this.find(ref, unit), 'use', port);
        }
      }
    }
    // Components without a port map are wired by name, as the planner does.
    for (const child of unit.children.values()) {
      const entry = exposes[child.name];
      if (child.kind !== 'component' || factoryOf(entry)) continue;
      for (const port of this.portsOf(child)) {
        if (port === 'options') continue;
        if (isPlainObject(entry) && Object.hasOwn(entry, port)) continue;
        this.edge(child.id, this.find(new Ref([port]), unit), 'use', port);
      }
    }
  }

  portsOf(component) {
    try {
      const exports = this.loader.load(component.file, component.boundary);
      return signature(exports[pickFactory(exports, component.id)]) || [];
    } catch {
      return [];
    }
  }

  // Element a reference leads to. A reference through an entry without
  // code (`Api.server.v1`) falls back to its longest resolvable prefix;
  // definitions, config and unresolved names give null.
  find(ref, scope) {
    for (let size = ref.path.length; size > 0; size--) {
      try {
        const prefix = new Ref(ref.path.slice(0, size));
        return targetOf(this.resolver.resolve(prefix, scope));
      } catch {
        // a shorter prefix
      }
    }
    return null;
  }

  endpointLabel(ref, scope, where) {
    try {
      const { def, version, transport } = this.resolver.endpoint(
        ref,
        scope,
        where,
      );
      const contract = version ? `${def.name} ${version}` : def.name;
      return transport ? `${contract} · ${transport}` : contract;
    } catch {
      return String(ref);
    }
  }

  contractLabel(ref, unit) {
    try {
      const { def, version } = this.resolver.resolve(ref, unit);
      if (!def) return String(ref);
      return version ? `${def.name} ${version}` : def.name;
    } catch {
      return String(ref);
    }
  }

  // Second line of a node: level, or contract and transport of an entry.
  describe(element) {
    if (element.kind === 'unit') {
      const { unit } = element;
      const design = unit.rank >= APPLICATION_RANK && !hasCode(unit);
      return design ? `${unit.level} · no code` : unit.level;
    }
    const entry = element.parent.dsl.exposes[element.name];
    const parts = [];
    if (isPlainObject(entry)) {
      if (isRef(entry.contract)) {
        parts.push(this.contractLabel(entry.contract, element.parent));
      }
      if (typeof entry.transport === 'string') parts.push(entry.transport);
    }
    if (element.kind === 'missing') parts.push('no code');
    return parts.join(' · ') || 'component';
  }

  // Units below `unit` in the order views show them.
  order(unit) {
    const units = this.children
      .get(unit.id)
      .filter((element) => element.kind === 'unit')
      .flatMap((element) => this.order(element.unit));
    return [unit, ...units];
  }
}

// View of a unit expanded `depth` levels: nodes inside are parts, nodes
// outside are actors, other parts of the model and requirements.
class View {
  constructor(graph, unit, depth = 1) {
    this.graph = graph;
    this.unit = unit;
    this.depth = depth;
    this.enclosing = ancestors(unit).slice(0, -1);
    this.containers = new Set();
    this.inside = new Map();
    this.outside = new Map();
    this.edges = new Map();
    this.root = this.expand(unit, 0);
    for (const edge of graph.edges) this.project(edge);
    // Dependencies of the unit are shown even when no part uses them yet.
    for (const name of Object.keys(unit.dsl.consumes)) {
      for (const { node } of this.arrive(consumesId(unit, name), [])) {
        this.add(node);
      }
    }
  }

  expand(unit, level) {
    this.containers.add(unit.id);
    const items = [];
    for (const element of this.graph.children.get(unit.id)) {
      const parts =
        element.kind === 'unit' ? this.graph.children.get(element.id) : [];
      if (parts.length > 0 && level + 1 < this.depth) {
        items.push(this.expand(element.unit, level + 1));
        continue;
      }
      const node = { id: element.id, kind: 'part', element };
      this.inside.set(element.id, node);
      items.push(node);
    }
    return { unit, items };
  }

  // Node inside the view holding an element, CONTAINER for an expanded
  // unit and pass-throughs it owns, null outside.
  locate(element) {
    let current = element;
    while (current) {
      const node = this.inside.get(current.id);
      if (node) return node;
      if (current.kind === 'unit' && this.containers.has(current.id)) {
        return CONTAINER;
      }
      current = current.parent && this.graph.elements.get(current.parent.id);
    }
    return null;
  }

  // An outside element is drawn where it meets the view: the child of the
  // lowest unit enclosing both, or itself when it is a part of that unit.
  external(element) {
    const unit = element.kind === 'unit' ? element.unit : element.parent;
    const common = commonUnit([unit, this.unit]);
    const chain = ancestors(unit);
    const shown =
      unit === common
        ? element
        : this.graph.elements.get(chain[chain.indexOf(common) + 1].id);
    return { id: shown.id, kind: 'external', element: shown };
  }

  // Nodes an arrow to element `id` ends at, with the edges it passed:
  // pass-throughs of expanded and outside units are followed to their
  // providers, an expanded unit used as a whole is its boundary, a unit
  // enclosing the view stands for its exposes.
  arrive(id, trail, seen = new Set()) {
    const element = this.graph.elements.get(id);
    if (!element || seen.has(id)) return [];
    seen.add(id);
    const place = this.locate(element);
    if (place && place !== CONTAINER) return [{ node: place, trail }];
    if (PASS.has(element.kind)) {
      const { next } = element;
      if (next) return this.arrive(next.to, [...trail, next], seen);
      return [{ node: { id, kind: 'requirement', element }, trail }];
    }
    const { unit } = element;
    if (place === CONTAINER) {
      return [{ node: { id, kind: 'container', element }, trail }];
    }
    if (this.enclosing.includes(unit)) {
      return Object.keys(unit.dsl.exposes).flatMap((name) =>
        this.arrive(entryId(unit, name), trail, seen),
      );
    }
    return [{ node: this.external(element), trail }];
  }

  // Node an arrow starts at. Pass-throughs of expanded and enclosing units
  // are not sources: arrows through them start at their users.
  depart(element) {
    if (element.kind === 'actor') {
      return { id: `actor:${element.name}`, kind: 'actor', element };
    }
    const place = this.locate(element);
    if (place === CONTAINER) return null;
    if (place) return place;
    if (PASS.has(element.kind) && this.enclosing.includes(element.parent)) {
      return null;
    }
    return this.external(element);
  }

  project(edge) {
    const from = this.depart(this.graph.elements.get(edge.from));
    if (!from) return;
    for (const { node: to, trail } of this.arrive(edge.to, [edge])) {
      if (to.id === from.id) continue;
      if (!INSIDE.has(from.kind) && !INSIDE.has(to.kind)) continue;
      this.connect(from, to, trail);
    }
  }

  // Kind of an arrow: of its first edge, remote when a use crosses a
  // transport; labels: ports differing from the target name, contracts.
  connect(from, to, trail) {
    const [first] = trail;
    const remote = trail.find((edge) => edge.kind === 'remote');
    let { kind, label } = first;
    if (kind === 'use' && remote) ({ kind, label } = remote);
    if (kind === 'use' && label === to.element.name) label = null;
    this.add(from);
    this.add(to);
    const key = `${from.id}>${to.id}`;
    let arrow = this.edges.get(key);
    if (!arrow) {
      arrow = { from: from.id, to: to.id, kinds: new Map() };
      this.edges.set(key, arrow);
    }
    if (!arrow.kinds.has(kind)) arrow.kinds.set(kind, new Set());
    if (label) arrow.kinds.get(kind).add(label);
  }

  add(node) {
    if (!INSIDE.has(node.kind)) this.outside.set(node.id, node);
  }

  // Merged arrows: [{ from, to, kind, label }].
  arrows() {
    return [...this.edges.values()].map(({ from, to, kinds }) => {
      const kind = KINDS.find((item) => kinds.has(item));
      const label = [...kinds.get(kind)].join(', ') || null;
      return { from, to, kind, label };
    });
  }
}

const COLORS = {
  unit: 'fill:#dde8fb,stroke:#3567c4,color:#0d1b33',
  component: 'fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a',
  internal: 'fill:#eef0f3,stroke:#7c8697,color:#1d232c',
  missing: 'fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3',
  actor: 'fill:#fbf0c3,stroke:#a9861a,color:#352900',
  external: 'fill:#e4e7ec,stroke:#566070,color:#1d232c',
  requirement: 'fill:#f2e5fb,stroke:#8045b8,color:#26103a',
};
const SHAPES = {
  unit: ['[', ']'],
  component: ['(', ')'],
  actor: ['([', '])'],
  external: ['[[', ']]'],
  requirement: ['{{', '}}'],
};
const ARROWS = { remote: '==>', actor: '-->', use: '-->', via: '-.->' };
// Light plate: node text, titles and edge labels stay readable on a dark
// page. bumpX keeps arrows from fanning across the diagram; spacing is the
// gap between columns (rank) and between stacked parts (node).
const THEME = {
  theme: 'base',
  flowchart: {
    curve: 'bumpX',
    nodeSpacing: 28,
    rankSpacing: 56,
    padding: 14,
  },
  themeVariables: {
    primaryColor: '#eef0f3',
    primaryTextColor: '#1d232c',
    primaryBorderColor: '#7c8697',
    lineColor: '#6b7586',
    textColor: '#1d232c',
    titleColor: '#6b7586',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    clusterBkg: '#f7f8fa',
    clusterBorder: '#c5ced9',
    edgeLabelBackground: '#f7f8fa',
  },
};

const text = (value) => String(value).replace(/"/g, '#quot;');

const nodeStyle = (graph, node) => {
  const { element } = node;
  if (node.kind === 'actor') return { shape: 'actor', style: 'actor' };
  if (node.kind === 'requirement') {
    return { shape: 'requirement', style: 'requirement' };
  }
  if (node.kind === 'external') return { shape: 'external', style: 'external' };
  const shape = element.kind === 'unit' ? 'unit' : 'component';
  const design = graph.describe(element).endsWith('no code');
  if (design) return { shape, style: 'missing' };
  return { shape, style: element.exposed ? shape : 'internal' };
};

const nodeLabel = (graph, node) => {
  const { element } = node;
  if (node.kind === 'actor') return element.name;
  if (node.kind === 'requirement') {
    return `${element.name}<br/>${element.contract || 'not provided'}`;
  }
  const qualified = node.kind === 'external' && element.kind !== 'unit';
  const { name } = element;
  const shown = qualified ? `${element.parent.name}.${name}` : name;
  return `${shown}<br/>${graph.describe(element)}`;
};

// Vertical place of every node drawn inside the boundary, so outside
// nodes can line up with the parts they meet.
const indexInside = (root) => {
  const index = new Map();
  let next = 0;
  const visit = (item) => {
    if (!item.items) {
      const at = next;
      next += 1;
      index.set(item.id, at);
      return [at, at];
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const child of item.items) {
      const [start, end] = visit(child);
      lo = Math.min(lo, start);
      hi = Math.max(hi, end);
    }
    if (lo === Infinity) {
      const at = next;
      next += 1;
      index.set(item.unit.id, at);
      return [at, at];
    }
    index.set(item.unit.id, (lo + hi) / 2);
    return [lo, hi];
  };
  visit(root);
  return index;
};

const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

// Callers on the left, dependencies on the right. A node that both calls
// and is called stays on the right: one arrow runs backwards, and the
// layout does not drag that node in between the parts.
const columnsOf = (view) => {
  const index = indexInside(view.root);
  const into = new Map();
  const out = new Map();
  const add = (map, id, at) => {
    const list = map.get(id);
    if (list) list.push(at);
    else map.set(id, [at]);
  };
  for (const arrow of view.arrows()) {
    const from = index.has(arrow.from);
    const to = index.has(arrow.to);
    if (!from && to) add(into, arrow.from, index.get(arrow.to));
    else if (from && !to) add(out, arrow.to, index.get(arrow.from));
  }
  const sources = [];
  const sinks = [];
  let order = 0;
  for (const node of view.outside.values()) {
    const callsIn = into.has(node.id);
    const called = out.has(node.id);
    const source = node.kind === 'actor' || (callsIn && !called);
    let score = Number.POSITIVE_INFINITY;
    if (source) score = callsIn ? average(into.get(node.id)) : 0;
    else if (called) score = average(out.get(node.id));
    (source ? sources : sinks).push({ node, order, score });
    order += 1;
  }
  const sorted = (items) =>
    items
      .sort(
        (left, right) => left.score - right.score || left.order - right.order,
      )
      .map(({ node }) => node);
  return { sources: sorted(sources), sinks: sorted(sinks) };
};

const namesInside = (root) => {
  const names = new Map();
  const visit = (item) => {
    if (!item.items) {
      names.set(item.id, item.element.name);
      return;
    }
    names.set(item.unit.id, item.unit.name);
    for (const child of item.items) visit(child);
  };
  visit(root);
  return names;
};

// Mermaid lays a subgraph out on its own only when no arrow leaves a part
// inside it. Arrows that cross the view boundary are drawn on the boundary
// instead, and the label names the part, so callers, parts and dependencies
// stay in three columns.
const foldBoundary = (view) => {
  const inside = namesInside(view.root);
  const root = view.root.unit.id;
  const crossed = new Map();
  const arrows = [];
  for (const arrow of view.arrows()) {
    const fromIn = inside.has(arrow.from);
    const toIn = inside.has(arrow.to);
    if (fromIn && toIn) {
      arrows.push(arrow);
      continue;
    }
    let { from, to } = arrow;
    const { label } = arrow;
    const parts = [];
    if (fromIn && from !== root) {
      parts.push(inside.get(from));
      from = root;
    }
    if (toIn && to !== root) {
      parts.push(inside.get(to));
      to = root;
    }
    const key = `${from}>${to}>${arrow.kind}>${label || ''}`;
    let folded = crossed.get(key);
    if (!folded) {
      folded = { from, to, kind: arrow.kind, label, parts: [] };
      crossed.set(key, folded);
      arrows.push(folded);
    }
    for (const part of parts) {
      if (!folded.parts.includes(part)) folded.parts.push(part);
    }
  }
  return arrows;
};

const arrowLabel = ({ parts = [], label }) => {
  const lines = [];
  for (let i = 0; i < parts.length; i += 3) {
    lines.push(parts.slice(i, i + 3).join(', '));
  }
  if (label) lines.push(label.replaceAll(' · ', '<br/>'));
  return lines.join('<br/>');
};

// Mermaid flowchart of a view; ids start with `prefix`, unique for every
// diagram of a page (Mermaid looks subgraphs up by id in the document).
// Left to right: callers, the boundary, dependencies. Parts of a boundary
// stack top to bottom.
const mermaid = (view, prefix = 'n') => {
  const { graph } = view;
  const ids = new Map();
  const taken = new Set();
  const idOf = (id) => {
    if (ids.has(id)) return ids.get(id);
    const base = `${prefix}_${id.replace(/\W/g, '_')}`;
    let value = base;
    for (let n = 2; taken.has(value); n++) value = `${base}_${n}`;
    taken.add(value);
    ids.set(id, value);
    return value;
  };
  const lines = [`%%{init: ${JSON.stringify(THEME)}}%%`, 'flowchart LR'];
  const draw = (node, indent) => {
    const { shape, style } = nodeStyle(graph, node);
    const [open, close] = SHAPES[shape];
    const label = text(nodeLabel(graph, node));
    lines.push(`${indent}${idOf(node.id)}${open}"${label}"${close}:::${style}`);
  };
  const box = ({ unit, items }, indent) => {
    // Non-breaking: a wrapped title would hide under the parts.
    // A short list reads downward. A long list of siblings would sit in
    // one rank: LR makes that rank a column instead of a wide row.
    const title = text(`${unit.name}#160;·#160;${unit.level}`);
    const direction = items.length > 6 ? 'LR' : 'TB';
    lines.push(`${indent}subgraph ${idOf(unit.id)} ["${title}"]`);
    lines.push(`${indent}  direction ${direction}`);
    for (const item of items) {
      if (item.items) box(item, `${indent}  `);
      else draw(item, `${indent}  `);
    }
    lines.push(`${indent}end`);
  };
  const { sources, sinks } = columnsOf(view);
  for (const node of sources) draw(node, '  ');
  box(view.root, '  ');
  for (const node of sinks) draw(node, '  ');
  for (const arrow of foldBoundary(view)) {
    const shown = text(arrowLabel(arrow));
    const tag = shown ? `|"${shown}"|` : '';
    lines.push(
      `  ${idOf(arrow.from)} ${ARROWS[arrow.kind]}${tag} ${idOf(arrow.to)}`,
    );
  }
  for (const [name, style] of Object.entries(COLORS)) {
    lines.push(`  classDef ${name} ${style}`);
  }
  return lines.join('\n');
};

const LEGEND = [
  'rectangles are units with their level, rounded boxes are components; ' +
    'grey parts are not exposed by their unit, dashed parts are declared ' +
    'in DSL without code',
  'ovals are actors; double-bordered boxes are other parts of the model, ' +
    'drawn at the level where they meet the unit; hexagons are required ' +
    'contracts without a provider',
  '`==>` is a call through a transport (contract, version, transport), ' +
    '`-->` is a use in process (port name when it differs), ' +
    '`-.->` is the adapter given by `via`; an arrow that crosses the ' +
    'boundary is drawn on the boundary and names the part inside',
];

// Default depth of the landscape: down to applications.
const landscapeDepth = (unit) => Math.max(1, APPLICATION_RANK - unit.rank);

const sectionsOf = (model, unit, { env, depth }) => {
  const graph = new Graph(model, env);
  const base = path.dirname(model.rootDir);
  const sections = [];
  if (depth > 1) {
    const view = new View(graph, unit, depth);
    const levels = depth === 2 ? 'one level' : `${depth - 1} levels`;
    const intro = `${unit.id} with its parts expanded ${levels} deeper.`;
    const code = mermaid(view, `v${sections.length}`);
    sections.push({ title: 'Landscape', intro, code });
  }
  for (const item of graph.order(unit)) {
    const file = path.relative(base, item.file).split(path.sep).join('/');
    const intro = `${item.level}, \`${file}\``;
    const code = mermaid(new View(graph, item, 1), `v${sections.length}`);
    sections.push({ title: item.id, intro, code });
  }
  return sections;
};

const markdown = (title, sections) =>
  [
    `# ${title}`,
    '',
    'Generated from DSL by `highscript diagram`, do not edit. In diagrams:',
    '',
    ...LEGEND.map((line) => `- ${line}`),
    '',
    ...sections.flatMap(({ title: heading, intro, code }) => [
      `## ${heading}`,
      '',
      intro,
      '',
      '```mermaid',
      code,
      '```',
      '',
    ]),
  ].join('\n');

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const inline = (value) =>
  escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');

const html = (title, sections) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --bg: #ffffff; --fg: #1d232c; --muted: #566070; --line: #d9dee6; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14181e; --fg: #e5e8ed; --muted: #9aa3b0; --line: #2c333d;
  }
}
:root[data-theme="dark"] {
  --bg: #14181e; --fg: #e5e8ed; --muted: #9aa3b0; --line: #2c333d;
}
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 system-ui, sans-serif; }
main { max-width: 1440px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 26px; margin: 0 0 8px; }
h2 { font-size: 19px; margin: 40px 0 4px; }
.note, li { color: var(--muted); }
code { font: 13px ui-monospace, monospace; }
.mermaid { margin: 12px 0 0; padding: 16px 12px; overflow-x: auto;
  border: 1px solid var(--line); border-radius: 8px;
  background: #f7f8fa; color-scheme: light; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="note">Generated from DSL by <code>highscript diagram</code>,
do not edit.</p>
<ul>
${LEGEND.map((line) => `<li>${inline(line)}</li>`).join('\n')}
</ul>
${sections
  .map(
    ({ title: heading, intro, code }) => `<section>
<h2>${escapeHtml(heading)}</h2>
<p class="note">${inline(intro)}</p>
<pre class="mermaid">
${escapeHtml(code)}
</pre>
</section>`,
  )
  .join('\n')}
</main>
<script type="module">
import mermaid from '${MERMAID}/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, deterministicIds: true });
</script>
</body>
</html>
`;

// Mermaid flowchart of one view: `unit` expanded `depth` levels.
const diagram = (model, unit, { env, depth = 1 } = {}) =>
  mermaid(new View(new Graph(model, env), unit, depth));

// Document: a landscape of `unit` (down to applications, or `depth`
// levels), then a view of every unit inside it. Format: md, html or mmd
// (the landscape alone, as Mermaid text).
const diagrams = (model, unit, options = {}) => {
  const { format = 'md', env, depth = landscapeDepth(unit) } = options;
  if (format === 'mmd') return `${diagram(model, unit, { env, depth })}\n`;
  const sections = sectionsOf(model, unit, { env, depth });
  const title = `${unit.name} architecture`;
  return format === 'html' ? html(title, sections) : markdown(title, sections);
};

module.exports = { diagram, diagrams, Graph, View, landscapeDepth };
