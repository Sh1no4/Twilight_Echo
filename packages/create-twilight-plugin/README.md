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
