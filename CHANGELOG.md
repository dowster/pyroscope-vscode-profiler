# [1.1.0](https://github.com/dowster/pyroscope-vscode-profiler/compare/v1.0.0...v1.1.0) (2026-02-10)


### Features

* add debug logging and configurable path remapping ([5c743a0](https://github.com/dowster/pyroscope-vscode-profiler/commit/5c743a0c16cdbd2c503186fe5648b52994cb582c))

# 1.0.0 (2026-02-10)


### Bug Fixes

* create dist directory before VSIX packaging ([32bff81](https://github.com/dowster/pyroscope-vscode-profiler/commit/32bff815808620734f95adf8c1354d6f5e474fba))
* disable NPM publishing in semantic-release ([2fde0f7](https://github.com/dowster/pyroscope-vscode-profiler/commit/2fde0f7151b84ab87d0ca53b48ad740d770abe47))


### Features

* add GitHub CI/CD workflows with semantic versioning ([55a7ea5](https://github.com/dowster/pyroscope-vscode-profiler/commit/55a7ea5f8fb6acdd83f1d72b928f1756062f2733))

# Changelog

All notable changes to the "Pyroscope Profile Viewer" extension will be documented in this file.

## [0.1.0] - 2024-01-XX

### Added
- Initial release
- Load pprof profiles from `.pb.gz` files
- Fetch profiles directly from Pyroscope server
- Inline CPU and memory usage hints
- Color-coded performance heatmap
- Detailed hover information for profiled lines
- Support for Go, Python, JavaScript, and TypeScript
- Configurable display modes (CPU, memory, or both)
- Configurable color schemes (heatmap, threshold, minimal)
- Threshold filtering to show only significant hotspots
- Status bar integration showing loaded profile info
- Commands: Load Profile, Fetch from Pyroscope, Toggle Hints, Clear Profile

## [Unreleased]

### Planned
- Workspace-level path mapping configuration
- Profile comparison mode (diff two profiles)
- Flame graph visualization integration
- Line-level stack trace expansion
- Export annotated code with comments
- Integration with VS Code testing framework
- Support for additional profile types (heap, goroutine, block, mutex)
