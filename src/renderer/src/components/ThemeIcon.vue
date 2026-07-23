<script setup lang="ts">
import {
  THEME_ICON_SLOT_REGISTRY,
  type ThemeIconFamily,
  type ThemeIconSlot
} from '../../../shared/theme.ts'

const props = defineProps<{
  iconSlot: ThemeIconSlot
}>()

const families: readonly ThemeIconFamily[] = ['outline', 'rounded', 'filled']
</script>

<template>
  <span
    class="theme-icon"
    :class="`theme-icon-${THEME_ICON_SLOT_REGISTRY[props.iconSlot].domain}`"
    :data-theme-icon-slot="props.iconSlot"
    aria-hidden="true"
  >
    <i
      v-for="family in families"
      :key="family"
      class="theme-icon-glyph"
      :class="[
        `theme-icon-family-${family}`,
        THEME_ICON_SLOT_REGISTRY[props.iconSlot].classes[family]
      ]"
    ></i>
  </span>
</template>

<style scoped>
.theme-icon {
  display: inline-grid;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  place-items: center;
  color: currentColor;
  line-height: 1;
}

.theme-icon-glyph {
  display: none;
  grid-area: 1 / 1;
  font-size: 1em;
  line-height: 1;
}

.theme-icon-family-outline {
  display: inline-block;
}

:global(html[data-te-icon-family='rounded'] .theme-icon-family-outline),
:global(html[data-te-icon-family='filled'] .theme-icon-family-outline) {
  display: none;
}

:global(html[data-te-icon-family='rounded'] .theme-icon-family-rounded),
:global(html[data-te-icon-family='filled'] .theme-icon-family-filled) {
  display: inline-block;
}
</style>
