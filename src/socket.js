'use strict';

/**
 * Single socket.io entry point — delegates to socket/index.js (messages, exit, tickets).
 * Node resolves require('./socket') to this file before ./socket/index.js.
 */
module.exports = require('./socket/index');
