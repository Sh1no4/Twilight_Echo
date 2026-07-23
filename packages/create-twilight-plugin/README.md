# create-twilight-plugin

Scaffold and package Twilight Echo plugins.

```bash
npx create-twilight-plugin init my-tool --type tool
cd my-tool
npm install
npm run build
npm run pack
```

The `pack` command creates a `.tep` zip package after validating `plugin.json`.

The `theme` scaffold targets plugin API v2 and structured theme schema v2. It demonstrates stable
tokens and host-registered modes while retaining the legacy packaged stylesheet path.
