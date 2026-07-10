# Mini Player Shape and Status Removal Design

## Goal

Correct the mini player window corners, preserve square album artwork in every layout, and completely remove the lower-left playback status indicator and its customization setting.

## Window Corners

The Electron mini player window and renderer surface must use the active theme's corner radius together. The native transparent window will be clipped to the rounded shape, while the renderer root, surface, background source, and overflow boundaries use the same CSS variable. This removes the visible and interactive square corners rather than only painting rounded content inside a rectangular window.

## Artwork

The artwork wrapper will always maintain a 1:1 aspect ratio. Layout rules may limit its size based on available height or width, but must not stretch either dimension independently. The artwork image remains `object-fit: cover`, so an original square cover stays square and a non-square source is cropped rather than distorted.

## Playback Status Removal

The visual status chip, its computed display text, the `playbackState` visibility setting, and the customization UI control will be removed. Settings normalization will omit legacy `playbackState` values, so persisted older profiles are cleaned when read and the state cannot return through an old preference.

## Verification

Add regression tests that assert the native/renderer rounded-window contract, square-artwork CSS behavior across layouts, and removal of the playback-status setting from defaults and customization controls. Run those focused tests, renderer type checking, and the production build before committing the implementation.

## Scope

This change is limited to the mini player renderer, its presentation/settings model, its native Electron window integration, and their focused tests. Playback behavior, remaining visibility controls, theme selection, and the main player are unchanged.
