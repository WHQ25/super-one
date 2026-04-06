# Packaging & Distribution

Once the app is ready, package it as a `.s1app` file for sharing.

## Using the MCP Tool

Ask the agent: "Pack my mini-app for distribution." The agent will call the `pack_mini_app` tool, which:

1. Validates `manifest.json` (must have `version` field)
2. Generates `integrity.json` with SHA-256 hashes for every file
3. Creates a compressed `.s1app` file (e.g., `my-app-1.0.0.s1app`)

## Package Structure

A `.s1app` file is a zip archive containing:

```
my-app-1.0.0.s1app (zip)
├── manifest.json      # Validated app manifest
├── integrity.json     # SHA-256 checksums for all files
├── index.html         # App entry point
├── icon.svg           # Optional
├── logo.png           # Optional
└── ...                # Other app files
```

## Installation

Users install `.s1app` files by dragging them onto the **Apps panel** in the sidebar. The installation process:

1. Extracts to a temp directory
2. Validates manifest schema (Zod)
3. Verifies file integrity (SHA-256 checksums)
4. Copies to `~/.superone/apps/<appId>/`
5. Writes `install.json` with installation metadata

If the app is already installed with a different version, it is upgraded automatically.
