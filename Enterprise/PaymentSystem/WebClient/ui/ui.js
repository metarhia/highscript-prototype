'use strict';

// Root UI component. The controller holds state and actions and does not
// touch the DOM, so the same component runs in browsers and in Node.js
// (scenarios and tests drive the controller directly).

const { createController } = require('./controller.js');
const { mount } = require('./view.js');
const { styles } = require('./styles.js');

const open = ({ payments, form }) => {
  const controller = createController({ payments, form });
  let unmount = null;

  const start = async () => {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('app') || document.body;
    unmount = mount(root, controller, styles);
    await controller.loadMethods().catch(() => {});
    await controller.loadHistory().catch(() => {});
  };

  const close = () => {
    if (unmount) unmount();
    unmount = null;
  };

  return Object.freeze({ controller, start, close });
};

module.exports = { open };
