# Pyroscope Profile Viewer for VS Code

Display inline CPU and memory profiling hints from Pyroscope directly in your VS Code editor. Identify performance hotspots without leaving your IDE.

## Features

- **Inline Performance Hints**: See CPU usage and memory allocation percentages directly in your code
- **Color-Coded Hotspots**: Visual heatmap highlighting performance-critical lines
- **Detailed Hover Information**: Hover over annotated lines for detailed profiling metrics
- **Load from File**: Import `.pb.gz` pprof profile files
- **Fetch from Pyroscope**: Connect directly to your Pyroscope server to fetch live profiles
- **Multi-Language Support**: Works with Go, Python, JavaScript, and TypeScript

## Installation

### From Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch the extension in a new VS Code window

### From VSIX (Coming Soon)

Install the `.vsix` file using the VS Code Extensions view.

## Usage

### Loading a Profile from File

1. Export a profile from Pyroscope as a `.pb.gz` file
2. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
3. Run **"Pyroscope: Load Profile from File"**
4. Select your `.pb.gz` file
5. Open source files to see inline hints

### Fetching from Pyroscope Server

1. Configure your Pyroscope server URL in settings (see Configuration below)
2. Open the Command Palette
3. Run **"Pyroscope: Fetch Profile from Pyroscope"**
4. Select an application from the list
5. Choose a time range (last 1h, 6h, 24h, 7d)
6. Open source files to see inline hints

### Understanding the Hints

Inline hints show performance metrics at the end of each line:

```go
func ProcessData() {
    result := heavyComputation()  // CPU: 12.5% | Mem: 2.3MB
    saveToDatabase(result)        // CPU: 3.2% | Mem: 512KB
}
```

**Color Coding:**
- 🟢 Green: Low impact (< 2%)
- 🟡 Yellow: Moderate impact (2-5%)
- 🟠 Orange: High impact (5-10%)
- 🔴 Red: Critical hotspot (> 10%)

**Hover for Details:**
Hover over any annotated line to see:
- Self CPU/memory usage (time spent in this line)
- Cumulative CPU/memory usage (includes called functions)
- Sample counts and allocation details

## Configuration

Configure the extension in VS Code settings (`Cmd+,` or `Ctrl+,`):

```json
{
  // Pyroscope server URL
  "pyroscope.serverUrl": "http://localhost:4040",

  // Optional authentication token
  "pyroscope.authToken": "",

  // Display mode: "cpu", "memory", or "both"
  "pyroscope.displayMode": "both",

  // Color scheme: "heatmap", "threshold", or "minimal"
  "pyroscope.colorScheme": "heatmap",

  // Minimum percentage to display (0-100)
  "pyroscope.threshold": 1.0
}
```

### Display Modes

- **`cpu`**: Show only CPU usage percentages
- **`memory`**: Show only memory allocation data
- **`both`**: Show both CPU and memory (default)

### Color Schemes

- **`heatmap`**: Gradient from green to red based on percentage (default)
- **`threshold`**: Fixed colors based on threshold levels
- **`minimal`**: Gray text only, no color coding

### Threshold

Set the minimum percentage (0-100) to display hints. Lines below this threshold won't show annotations. Default is 1.0%.

## Commands

| Command | Description |
|---------|-------------|
| `Pyroscope: Load Profile from File` | Open a `.pb.gz` profile file |
| `Pyroscope: Fetch Profile from Pyroscope` | Fetch a profile from your Pyroscope server |
| `Pyroscope: Toggle Hints` | Show or hide inline hints |
| `Pyroscope: Clear Profile` | Clear the currently loaded profile |

## Working with Go Applications

This extension works seamlessly with Go applications profiled by Pyroscope:

1. **Profile your Go application** using Pyroscope (continuous profiling or ad-hoc)
2. **Export or fetch** the profile data
3. **Open your Go source files** in VS Code
4. **See the hotspots** directly in your code

### Example Go Setup

```go
package main

import (
    "github.com/grafana/pyroscope-go"
)

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "my-go-app",
        ServerAddress:   "http://localhost:4040",
    })

    // Your application code
    runMyApp()
}
```

Then use this extension to view the profiling results inline while editing your Go code.

## Path Mapping

The extension automatically maps profile locations to your workspace files using several strategies:

1. **Exact path match**: Direct file path matching
2. **Relative path resolution**: Resolves relative paths against workspace folders
3. **Basename matching**: Falls back to filename matching when full paths don't match

If some files aren't being annotated, ensure:
- The source files are in your VS Code workspace
- The paths in the profile match your local file structure
- You're using the same Go module/package structure

## Troubleshooting

### No hints appearing

- Check that you've loaded a profile (status bar should show profile name)
- Verify the threshold setting isn't filtering out all lines
- Ensure your source files are in the workspace
- Check the VS Code Developer Tools console for errors (`Help > Toggle Developer Tools`)

### Can't connect to Pyroscope server

- Verify the server URL in settings
- Check if the Pyroscope server is running
- Test the URL in your browser: `http://localhost:4040`
- Check if authentication is required (set `pyroscope.authToken`)

### Hints appear on wrong lines

- This can happen if the profiled binary was built from different source code
- Ensure you're viewing the same version of the code that was profiled
- Rebuild and reprofile if source has changed significantly

### Performance issues with large profiles

- Increase the threshold setting to show fewer annotations
- Use filtered time ranges when fetching from Pyroscope
- Close files you're not actively editing

## Requirements

- VS Code 1.85.0 or later
- Node.js 20.x or later (for development)

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Run extension in debug mode
# Press F5 in VS Code
```

### Project Structure

```
pyroscope-vscode-profiler/
├── src/
│   ├── extension.ts          # Main entry point
│   ├── parser/               # Profile parsing logic
│   │   ├── pprofParser.ts    # Protobuf parsing
│   │   ├── decompressor.ts   # Gzip decompression
│   │   └── sourceMapper.ts   # Map samples to source
│   ├── pyroscope/            # API client
│   │   ├── client.ts         # Pyroscope client
│   │   └── auth.ts           # Authentication
│   ├── decorations/          # VS Code UI
│   │   ├── decorationManager.ts
│   │   ├── hintRenderer.ts
│   │   └── hoverProvider.ts
│   ├── commands/             # Extension commands
│   └── state/                # State management
└── proto/
    └── profile.proto         # pprof protobuf definition
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - See LICENSE file for details

## Credits

Built with:
- [protobufjs](https://github.com/protobufjs/protobuf.js) - Protocol Buffers parsing
- [pako](https://github.com/nodeca/pako) - Gzip decompression
- [axios](https://github.com/axios/axios) - HTTP client

Profile format based on [Google pprof](https://github.com/google/pprof).
