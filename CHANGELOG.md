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
