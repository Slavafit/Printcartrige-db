# Task 027 — Reliable Electron tray icon on Windows

Status: implemented and validated on `feature/electron-tray-icon`.

## Goal

Ensure the portable Electron build displays the PrinterDB tray icon reliably on Windows instead of depending on runtime SVG decoding.

## Implementation

- Package the existing `printerdb.ico` as `resources/printerdb.ico`.
- Load that real ICO through `nativeImage.createFromPath` in packaged mode.
- Load the same repository asset during development.
- Retain the inline SVG only as a fallback if the ICO cannot be decoded.
- Cover packaged/development path selection and Electron packaging configuration with automated tests.
