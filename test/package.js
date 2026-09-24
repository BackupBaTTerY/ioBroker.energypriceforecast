'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');

// Checks package.json and io-package.json for the fields the ioBroker
// repository requires.
tests.packageFiles(path.join(__dirname, '..'));
