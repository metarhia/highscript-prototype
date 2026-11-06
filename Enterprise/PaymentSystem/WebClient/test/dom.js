'use strict';

// Minimal DOM for rendering tests: elements, attributes, events, text.

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.value = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type, event = {}) {
    const payload = { target: this, preventDefault() {}, ...event };
    for (const listener of this.listeners[type] || []) listener(payload);
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? { text: node } : node;
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }

  remove() {
    const siblings = this.parentNode?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
  }

  get textContent() {
    return this.childNodes
      .map((node) => node.text ?? node.textContent)
      .join('');
  }

  findAll(predicate, found = []) {
    for (const node of this.childNodes) {
      if (!(node instanceof Element)) continue;
      if (predicate(node)) found.push(node);
      node.findAll(predicate, found);
    }
    return found;
  }

  querySelector(selector) {
    const id = selector.slice(1);
    return this.findAll((node) => node.id === id)[0] || null;
  }
}

const createDocument = () => {
  const document = { createElement: (tag) => new Element(tag, document) };
  document.head = new Element('head', document);
  document.body = new Element('body', document);
  const app = new Element('div', document);
  app.setAttribute('id', 'app');
  document.body.append(app);
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
  return document;
};

module.exports = { createDocument, Element };
