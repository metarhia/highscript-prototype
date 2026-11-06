'use strict';

const init = require('eslint-config-metarhia');

const LEVELS = [
  'enterprise',
  'landscape',
  'solution',
  'system',
  'application',
  'subsystem',
  'service',
  'module',
  'component',
];

module.exports = [
  { ignores: ['.data/', 'dist/', 'node_modules/'] },
  ...init,
  {
    files: [
      `Enterprise/**/{${LEVELS.join(',')}}.js`,
      'Enterprise/**/contracts/**/*.js',
      'Enterprise/**/schemas/**/*.js',
    ],
    rules: {
      strict: 'off',
      'no-undef': 'off',
      'no-unused-expressions': 'off',
    },
  },
];
