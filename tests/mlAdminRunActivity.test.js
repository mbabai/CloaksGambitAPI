const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  'mlAdmin',
  'runActivity.js',
)).href;

function evaluate(expression) {
  const script = `
    import(${JSON.stringify(moduleUrl)}).then((mod) => {
      const result = (${expression})(mod);
      console.log(JSON.stringify(result));
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' }
  );
  return JSON.parse(output);
}

describe('ml admin run activity highlights', () => {
  test('only marks cards active when work is actually in flight', () => {
    const result = evaluate(`
      ({ getRunStatActivity }) => ({
        preflightSelfPlay: getRunStatActivity({
          selfPlayProgress: { active: true, inFlight: false, activeGames: 0 },
          evaluationProgress: null,
          trainingProgress: null,
        }),
        runningSelfPlay: getRunStatActivity({
          selfPlayProgress: { active: true, inFlight: true, activeGames: 4 },
          evaluationProgress: null,
          trainingProgress: null,
        }),
        preflightTraining: getRunStatActivity({
          selfPlayProgress: null,
          evaluationProgress: null,
          trainingProgress: { active: true, inFlight: false, completedSteps: 0, targetSteps: 4 },
        }),
        runningTraining: getRunStatActivity({
          selfPlayProgress: null,
          evaluationProgress: null,
          trainingProgress: { active: true, inFlight: true, completedSteps: 0, targetSteps: 4 },
        }),
        runningEvaluation: getRunStatActivity({
          selfPlayProgress: null,
          evaluationProgress: { active: true, inFlight: true, activeGames: 2 },
          trainingProgress: null,
        }),
      })
    `);

    expect(result.preflightSelfPlay).toEqual({
      selfPlayActive: false,
      evaluationActive: false,
      trainingActive: false,
    });
    expect(result.runningSelfPlay.selfPlayActive).toBe(true);
    expect(result.preflightTraining.trainingActive).toBe(false);
    expect(result.runningTraining.trainingActive).toBe(true);
    expect(result.runningEvaluation.evaluationActive).toBe(true);
  });
});
