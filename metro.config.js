// Metro bundler configuration.
//
// 1. Add 'web' to `resolver.platforms` so Metro will look for `.web.js`
//    files before falling through to `.js` when bundling for web.
// 2. Short-circuit `react-native-maps` on web to an empty module.
//    `react-native-maps` has no web build; its internals import
//    native-only things like `codegenNativeCommands`. Aliasing to
//    empty here is a safety net in case anything still reaches into
//    the package on web.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.platforms.includes('web')) {
  config.resolver.platforms = [...config.resolver.platforms, 'web'];
}

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native-maps' ||
      moduleName.startsWith('react-native-maps/'))
  ) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
