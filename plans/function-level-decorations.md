# Function-Level Profile Decorations

## Context

This change adds always-visible function-level profiling metrics to the VSCode Pyroscope extension. Currently, the extension only shows:
- **Inline decorations**: End-of-line hints with CPU/memory metrics on individual lines
- **Hover tooltips**: Detailed metrics when hovering over lines

Users want to see aggregated metrics at the function level that are always visible, making it easier to identify hot functions without inspecting every line. This addresses the need for high-level performance overview while maintaining the existing line-by-line detail.

The user has requested:
- **Both CodeLens and text decoration options** with separate toggles
- **Both self and cumulative metrics** aggregation
- **Configurable display fields** (function name, CPU, memory, counts)
- **Independent configuration** from existing inline hints

---

## Overview of Changes

We will add two new display mechanisms for function-level metrics:

1. **CodeLens Provider**: Non-intrusive informational text above functions (like "5 references")
2. **Above-line Text Decorations**: More prominent decoration lines positioned above function declarations

Both will display aggregated metrics for entire functions, supporting:
- Self metrics (function's own code only)
- Cumulative metrics (including nested calls)
- Configurable display fields

---

## Critical Files

### Files to Create
- `/src/decorations/codeLensProvider.ts` - Implements CodeLensProvider for function metrics
- `/src/decorations/functionDecorationProvider.ts` - Implements above-line text decorations
- `/src/decorations/functionMetricsAggregator.ts` - Aggregates line metrics for function ranges

### Files to Modify
- `/src/decorations/decorationManager.ts` - Register new providers and coordinate lifecycle
- `/src/decorations/hintRenderer.ts` - Export formatting utilities for reuse
- `/src/extension.ts` - Wire up configuration changes and lifecycle
- `/package.json` - Add new configuration options

---

## Detailed Implementation Plan

### Step 1: Create Function Metrics Aggregator

**File**: `/src/decorations/functionMetricsAggregator.ts`

**Purpose**: Aggregate line-level metrics across function boundaries

**Key interfaces**:
```typescript
export interface FunctionMetrics {
    name: string;
    range: vscode.Range;
    // Self metrics (function's own code)
    selfCpuPercent: number;
    selfMemoryPercent: number;
    selfMemoryBytes: number;
    selfCpuSamples: number;
    selfAllocations: number;
    // Cumulative metrics (including nested calls)
    cumulativeCpuPercent: number;
    cumulativeMemoryPercent: number;
    cumulativeMemoryBytes: number;
    cumulativeCpuSamples: number;
    cumulativeAllocations: number;
}

export interface FunctionAggregatorConfig {
    threshold: number;
    includeAnonymous: boolean;
}
```

**Implementation strategy**:
1. Use `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider')` to get function symbols
2. Filter symbols to only `SymbolKind.Function`, `SymbolKind.Method`, `SymbolKind.Constructor`
3. For each function symbol:
   - Query `ProfileStore.getMetricsForFile()` for the file
   - Iterate through lines in function range (symbol.range.start.line to symbol.range.end.line)
   - Sum up both self metrics (`selfCpuPercent`, `selfMemoryPercent`) and cumulative metrics (`cpuPercent`, `memoryPercent`)
   - Store raw counts (samples, allocations, bytes)
4. Handle nested functions recursively
5. Apply threshold filtering
6. Return array of `FunctionMetrics`

**Edge cases**:
- No symbols available → return empty array
- Anonymous functions → use name from symbol or "(anonymous)"
- Nested functions → each gets its own metrics
- No metrics in range → skip function
- Multi-line declarations → use symbol.range.start.line for positioning

---

### Step 2: Create CodeLens Provider

**File**: `/src/decorations/codeLensProvider.ts`

**Purpose**: Display function metrics as CodeLens (non-intrusive)

**Implementation**:
```typescript
export class PyroscopeCodeLensProvider implements vscode.CodeLensProvider {
    constructor(
        private profileStore: ProfileStore,
        private onDidChangeEmitter: vscode.EventEmitter<void>
    ) {}

    public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        // 1. Check if profile loaded and file has metrics
        // 2. Get configuration for formatting
        // 3. Call functionMetricsAggregator
        // 4. Format each FunctionMetrics into CodeLens text
        // 5. Create CodeLens at function start line
        // 6. Return array
    }
}
```

**CodeLens text format** (configurable via settings):
- Full: `foo() — Self: CPU 5.2% | Mem 1.2 MB | Cumulative: CPU 12.3% | Mem 5.4 MB`
- Compact: `foo() — Self: 5.2% | Cumulative: 12.3%`
- Respects `displayMode` (cpu/memory/both)
- Respects field configuration (name, CPU, memory, counts)

**Positioning**: `new vscode.Range(functionStartLine, 0, functionStartLine, 0)`

**No command needed**: CodeLens is informational only (no click action)

---

### Step 3: Create Above-Line Decoration Provider

**File**: `/src/decorations/functionDecorationProvider.ts`

**Purpose**: Display prominent text decorations above functions

**Implementation**:
```typescript
export class FunctionDecorationProvider {
    private decorationType: vscode.TextEditorDecorationType;

    constructor(private profileStore: ProfileStore) {
        // Create decoration type with 'before' content
        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                contentText: '', // Will be set per decoration
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'italic',
                textDecoration: 'none; display: block; margin-bottom: 0.5em;',
            },
            isWholeLine: true,
        });
    }

    public updateDecorations(editor: vscode.TextEditor, config: HintConfig): void {
        // 1. Get function metrics using aggregator
        // 2. Create DecorationOptions for each function
        // 3. Apply via editor.setDecorations()
    }

    public clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.decorationType, []);
    }

    public dispose(): void {
        this.decorationType.dispose();
    }
}
```

**Decoration format**:
- Uses `before` content to place text above the function line
- Color: Uses theme-aware `editorCodeLens.foreground` color
- Display: Block-level with bottom margin for spacing
- Supports same formatting options as CodeLens

**Note**: Text decorations are more intrusive than CodeLens but more visible.

---

### Step 4: Update DecorationManager

**File**: `/src/decorations/decorationManager.ts`

**Changes**:
1. Add new provider instances:
   ```typescript
   private codeLensProvider: vscode.Disposable | null = null;
   private functionDecorationProvider: FunctionDecorationProvider | null = null;
   private codeLensChangeEmitter = new vscode.EventEmitter<void>();
   ```

2. Add registration methods:
   ```typescript
   private registerCodeLensProvider(): void {
       const config = vscode.workspace.getConfiguration('pyroscope');
       if (!config.get<boolean>('enableCodeLens', true)) return;

       const provider = new PyroscopeCodeLensProvider(
           this.profileStore,
           this.codeLensChangeEmitter
       );

       this.codeLensProvider = vscode.languages.registerCodeLensProvider(
           ['go', 'python', 'javascript', 'typescript'],
           provider
       );
   }

   private registerFunctionDecorations(): void {
       const config = vscode.workspace.getConfiguration('pyroscope');
       if (!config.get<boolean>('enableFunctionDecorations', false)) return;

       this.functionDecorationProvider = new FunctionDecorationProvider(
           this.profileStore
       );
   }
   ```

3. Update `updateDecorations()` to also update function decorations:
   ```typescript
   public updateDecorations(): void {
       // Existing inline decoration logic...

       // Update function decorations
       if (this.functionDecorationProvider) {
           vscode.window.visibleTextEditors.forEach((editor) => {
               this.functionDecorationProvider!.updateDecorations(editor, config);
           });
       }

       // Trigger CodeLens refresh
       this.codeLensChangeEmitter.fire();
   }
   ```

4. Add disposal for new providers in `dispose()`:
   ```typescript
   public dispose(): void {
       // Existing disposal...

       if (this.codeLensProvider) {
           this.codeLensProvider.dispose();
       }
       if (this.functionDecorationProvider) {
           this.functionDecorationProvider.dispose();
       }
       this.codeLensChangeEmitter.dispose();
   }
   ```

5. Listen to configuration changes:
   ```typescript
   public onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
       if (e.affectsConfiguration('pyroscope.enableCodeLens')) {
           this.reregisterCodeLensProvider();
       }
       if (e.affectsConfiguration('pyroscope.enableFunctionDecorations')) {
           this.reregisterFunctionDecorations();
       }
       if (e.affectsConfiguration('pyroscope.functionDisplay')) {
           this.updateDecorations();
       }
   }
   ```

---

### Step 5: Export Formatting Utilities

**File**: `/src/decorations/hintRenderer.ts`

**Changes**: Export existing utility functions for reuse
```typescript
// Export these functions (change from private to public)
export function formatPercent(value: number): string { /* existing */ }
export function formatBytes(bytes: number): string { /* existing */ }
export function getColor(percent: number, scheme: string): string { /* existing */ }
```

These will be reused by CodeLens and function decoration formatters.

---

### Step 6: Add Configuration Options

**File**: `/package.json`

**New configuration properties**:

```json
"pyroscope.enableCodeLens": {
    "type": "boolean",
    "default": true,
    "description": "Show function metrics as CodeLens above function declarations"
},
"pyroscope.enableFunctionDecorations": {
    "type": "boolean",
    "default": false,
    "description": "Show function metrics as prominent text decorations above functions (more visible than CodeLens)"
},
"pyroscope.functionDisplay.showName": {
    "type": "boolean",
    "default": true,
    "description": "Show function name in function-level metrics"
},
"pyroscope.functionDisplay.showSelfMetrics": {
    "type": "boolean",
    "default": true,
    "description": "Show self metrics (function's own code only)"
},
"pyroscope.functionDisplay.showCumulativeMetrics": {
    "type": "boolean",
    "default": true,
    "description": "Show cumulative metrics (including nested calls)"
},
"pyroscope.functionDisplay.showCounts": {
    "type": "boolean",
    "default": false,
    "description": "Show raw sample and allocation counts"
},
"pyroscope.functionDisplay.format": {
    "type": "string",
    "enum": ["full", "compact"],
    "default": "full",
    "description": "Display format: full (all details) or compact (percentages only)"
}
```

**Note**: Existing `displayMode`, `colorScheme`, and `threshold` settings will also apply to function-level decorations.

---

### Step 7: Update Extension Lifecycle

**File**: `/src/extension.ts`

**Changes**:

1. Ensure `DecorationManager.updateDecorations()` is called on profile changes (already exists)

2. Add configuration change listener:
   ```typescript
   context.subscriptions.push(
       vscode.workspace.onDidChangeConfiguration((e) => {
           if (e.affectsConfiguration('pyroscope')) {
               decorationManager.onConfigurationChanged(e);
           }
       })
   );
   ```

3. No other changes needed - existing profile lifecycle triggers will work

---

## Configuration Interaction Matrix

| Setting | Affects CodeLens | Affects Function Decorations | Affects Inline Hints |
|---------|-----------------|----------------------------|-------------------|
| `enableCodeLens` | Enable/disable | - | - |
| `enableFunctionDecorations` | - | Enable/disable | - |
| `displayMode` | Yes | Yes | Yes |
| `threshold` | Yes | Yes | Yes |
| `colorScheme` | No (plain text) | Yes | Yes |
| `functionDisplay.*` | Yes | Yes | - |
| Toggle hints command | No | No | Yes |

---

## Function Detection & Aggregation Details

### Symbol Kinds to Include
- `vscode.SymbolKind.Function` (Go functions, Python functions, JS functions)
- `vscode.SymbolKind.Method` (Class methods)
- `vscode.SymbolKind.Constructor` (Constructors)

### Symbol Kinds to Exclude
- Class, Interface, Module, Namespace, Package, etc.

### Nested Function Handling
Process document symbols recursively. Each function gets its own aggregation, even if nested:

```
function outer() {        // Shows aggregation for outer()
    function inner() {    // Shows aggregation for inner()
        // code
    }
}
```

### Metric Aggregation Logic

For each line in function range (inclusive):
```typescript
// Self metrics (function's own code)
selfCpuPercent += lineMetrics.selfCpuPercent
selfMemoryPercent += lineMetrics.selfMemoryPercent
selfMemoryBytes += lineMetrics.memoryBytes
selfCpuSamples += lineMetrics.cpuSamples
selfAllocations += lineMetrics.allocations

// Cumulative metrics (including callees)
cumulativeCpuPercent += lineMetrics.cpuPercent
cumulativeMemoryPercent += lineMetrics.memoryPercent
// (bytes, samples, allocations same as above)
```

### Threshold Application
Apply threshold to the maximum of:
- `max(selfCpuPercent, selfMemoryPercent, cumulativeCpuPercent, cumulativeMemoryPercent)`

Only show function-level decoration if this exceeds `threshold` setting.

---

## Text Formatting Examples

### Full Format (all fields enabled)
```
functionName() — Self: CPU 5.2% | Mem 1.2 MB (1234 samples, 5678 allocs) | Cumulative: CPU 12.3% | Mem 5.4 MB
```

### Compact Format
```
functionName() — Self: 5.2% | Cumulative: 12.3%
```

### CPU Only (displayMode: "cpu")
```
functionName() — Self: CPU 5.2% | Cumulative: CPU 12.3%
```

### Self Only (showCumulativeMetrics: false)
```
functionName() — CPU: 5.2% | Mem: 1.2 MB
```

### No Name (showName: false)
```
Self: CPU 5.2% | Mem 1.2 MB | Cumulative: CPU 12.3% | Mem 5.4 MB
```

---

## Performance Considerations

1. **Symbol Resolution**: DocumentSymbolProvider is cached by VSCode, minimal overhead
2. **Metric Aggregation**: O(n) where n = lines in function, fast for typical function sizes
3. **Update Frequency**: Only on:
   - Profile load/clear
   - Active editor change
   - Configuration change
   - User toggle command
4. **Memory**: CodeLens and decorations are lightweight text strings
5. **Large Files**: Symbol provider handles large files efficiently; aggregation is linear time

---

## Edge Cases & Error Handling

1. **No symbols available**: Skip CodeLens/decorations for that file (silently)
2. **Symbol provider fails**: Catch error, log, continue without function-level decorations
3. **Empty function**: Show 0% metrics or hide if below threshold
4. **Anonymous functions**: Use symbol name or fallback to "(anonymous function)"
5. **Multi-line function signature**: Position decoration at symbol.range.start.line
6. **No metrics in function range**: Skip that function (don't show 0% unless configured)
7. **Overlapping functions**: Each function rendered independently (VSCode handles overlap)
8. **No profile loaded**: Don't show any function decorations

---

## Testing & Verification

### Manual Testing
1. **Test with all supported languages**: Go, Python, JavaScript, TypeScript
2. **Test nested functions**: Verify each function shows its own metrics
3. **Test configuration changes**: Toggle settings and verify updates
4. **Test with large files**: Files with 100+ functions
5. **Test threshold filtering**: Adjust threshold and verify functions appear/disappear
6. **Test display modes**: CPU only, memory only, both
7. **Test with no profile**: Verify no decorations appear

### Test Files
- `/src/decorations/codeLensProvider.ts` - Test all formatting combinations
- `/src/decorations/functionMetricsAggregator.ts` - Test aggregation logic with mock data
- Integration test: Load a profile, verify CodeLens and decorations appear correctly

### Verification Steps
1. Load a CPU profile → Verify CodeLens appears above hot functions
2. Load a memory profile → Verify memory metrics appear
3. Toggle `enableCodeLens` → Verify CodeLens disappear/reappear
4. Toggle `enableFunctionDecorations` → Verify decorations disappear/reappear
5. Change `displayMode` → Verify display updates
6. Change `threshold` → Verify functions below threshold hide
7. Clear profile → Verify all function decorations clear

---

## Implementation Order

1. **Create functionMetricsAggregator.ts** - Foundation for both features
2. **Export formatting utilities** in hintRenderer.ts
3. **Create codeLensProvider.ts** - Implement and test CodeLens first (less intrusive)
4. **Create functionDecorationProvider.ts** - Implement text decorations
5. **Update decorationManager.ts** - Integrate both providers
6. **Add configuration** in package.json
7. **Update extension.ts** - Wire up lifecycle
8. **Test end-to-end** with real profiles

---

## Future Enhancements (Out of Scope)

- Interactive CodeLens with commands (e.g., "Jump to hottest line")
- Gutter decorations for visual heatmap
- Class-level aggregations
- Function ranking/sorting quickpick
- Export function metrics to CSV
- Historical comparison (compare two profiles)

---

## Summary

This plan adds two new always-visible function-level decoration mechanisms:

1. **CodeLens**: Non-intrusive, theme-aware, informational text above functions
2. **Text Decorations**: More prominent lines above functions for high visibility

Both support:
- Self and cumulative metrics
- Configurable display fields
- Independent enable/disable toggles
- Respect existing display mode, threshold, and color scheme settings

Implementation follows existing patterns in the codebase and reuses formatting utilities for consistency.
