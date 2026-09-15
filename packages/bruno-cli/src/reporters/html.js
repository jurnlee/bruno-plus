const fs = require('fs');
const { generateHtmlReport, getRunnerSummary } = require('@usebruno/common/runner');
const { CLI_VERSION } = require('../constants');

const makeHtmlOutput = async (results, outputPath, runCompletionTime, environment = null) => {
  let runnerResults = results;
  if (!results) {
    runnerResults = [];
  } else if (results.results) {
    // Convert CLI format to expected format: array of { iterationIndex, results, summary }.
    // Data-driven runs carry a 1-based iteration on each result — bucket them so every
    // iteration renders its own block with its own summary.
    const iterations = [...new Set(results.results.map((r) => r.iteration || 1))].sort((a, b) => a - b);
    runnerResults = iterations.map((iteration) => {
      const iterationResults = results.results.filter((r) => (r.iteration || 1) === iteration);
      return {
        iterationIndex: iteration - 1,
        results: iterationResults,
        summary: getRunnerSummary(iterationResults)
      };
    });
  } else if (Array.isArray(results)) {
    runnerResults = results;
  }

  const htmlString = generateHtmlReport({
    runnerResults: runnerResults,
    version: `usebruno v${CLI_VERSION}`,
    environment: environment,
    runCompletionTime: runCompletionTime
  });
  fs.writeFileSync(outputPath, htmlString);
};

module.exports = makeHtmlOutput;
