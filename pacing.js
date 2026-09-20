// Human-like request pacing: serial, jittered gaps, occasional reading pause.
"use strict";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paceDelay(rng = Math.random) {
  return Math.round(450 + rng() * 350);
}

function readingPauseDelay(rng = Math.random) {
  return Math.round(1500 + rng() * 1300);
}

function createPacer({ rng = Math.random, wait = sleep } = {}) {
  let sincePause = 0;
  return {
    async pace() {
      await wait(paceDelay(rng));
      if (++sincePause >= 4 && rng() < 0.6) {
        sincePause = 0;
        await wait(readingPauseDelay(rng));
      }
    },
  };
}

async function runSerial(tasks, pacer) {
  const results = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(await tasks[i]());
    if (i < tasks.length - 1) await pacer.pace();
  }
  return results;
}

module.exports = { sleep, paceDelay, readingPauseDelay, createPacer, runSerial };
