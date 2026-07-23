import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { TWILIGHT_PLUGIN_API_VERSION } from '../src/main/plugins/types.ts'
import {
  STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION,
  THEME_MODE_DEFINITIONS,
  THEME_TOKEN_DEFINITIONS,
  THEME_VISIBILITY_SLOT_IDS
} from '../src/shared/theme.ts'

const outputPath = fileURLToPath(
  new URL('../packages/plugin-api/theme-contract.json', import.meta.url)
)
const contract = {
  schemaVersion: 1,
  pluginApiVersion: TWILIGHT_PLUGIN_API_VERSION,
  structuredThemeSchemaVersion: STRUCTURED_PLUGIN_THEME_SCHEMA_VERSION,
  tokens: THEME_TOKEN_DEFINITIONS.map(({ id, cssVariable, label, group, surface, kind }) => ({
    id,
    cssVariable,
    label,
    group,
    surface,
    kind
  })),
  modes: THEME_MODE_DEFINITIONS.map(({ id, dataAttribute, label, options, defaultValue }) => ({
    id,
    dataAttribute,
    label,
    options,
    defaultValue
  })),
  visibility: THEME_VISIBILITY_SLOT_IDS
}

await writeFile(outputPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
