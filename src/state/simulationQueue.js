const { randomUUID } = require('crypto');

class SimulationQueue {
  constructor() {
    this.queue = [];
  }

  enqueue({ modelIds, numGames, concurrency, options }) {
    const job = {
      id: randomUUID(),
      status: 'queued',
      receivedAt: new Date().toISOString(),
      payload: {
        modelIds,
        numGames,
        concurrency,
        options
      }
    };

    this.queue.push(job);

    return {
      ...job,
      queuePosition: this.queue.length - 1
    };
  }

  list() {
    return this.queue.map((job, index) => ({
      ...job,
      queuePosition: index
    }));
  }

  clear() {
    this.queue = [];
  }
}

module.exports = new SimulationQueue();
module.exports.SimulationQueue = SimulationQueue;
