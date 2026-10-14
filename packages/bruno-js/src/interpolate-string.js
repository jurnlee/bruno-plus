const { interpolate } = require('@usebruno/common');

const interpolateString = (
  str,
  {
    envVariables = {},
    runtimeVariables = {},
    processEnvVars = {},
    collectionVariables = {},
    folderVariables = {},
    requestVariables = {},
    globalEnvironmentVariables = {},
    dataVariables = {},
    onUnresolved
  }
) => {
  if (!str || !str.length || typeof str !== 'string') {
    return str;
  }

  const combinedVars = {
    ...globalEnvironmentVariables,
    ...collectionVariables,
    ...envVariables,
    ...folderVariables,
    ...requestVariables,
    ...dataVariables,
    ...runtimeVariables,
    process: {
      env: {
        ...processEnvVars
      }
    }
  };

  return interpolate(str, combinedVars, { onUnresolved });
};

module.exports = {
  interpolateString
};
