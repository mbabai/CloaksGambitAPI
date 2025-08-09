const EventEmitter = require('events');

// Simple internal event bus for high-level domain events
const eventBus = new EventEmitter();

module.exports = eventBus;
