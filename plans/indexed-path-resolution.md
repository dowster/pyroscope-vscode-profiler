# Optimize Path Resolution Performance with Pre-Indexing

## Context

The VS Code extension currently performs path resolution for every stack frame in a profile during the source mapping phase. For a typical profile with 10,000 samples and 15 frames per sample, this results in **150,000+ path resolution calls**, each potentially triggering multiple disk I/O operations.

### Current Performance Bottlenecks

**Problem 1: No Caching**
- PathResolver resolves the same file paths repeatedly without memoization
- Each resolution attempts multiple strategies with disk I/O:
  - Path mappings: N × `fs.existsSync()` calls
  - Absolute path check: 1 × `fs.existsSync()`
  - Workspace folders: M × `fs.existsSync()` calls
  - Basename fallback: Full recursive directory traversal with `fs.readdirSync()`

**Problem 2: Repeated Disk I/O**
- For 150,000 frames with 10 path mappings and 2 workspace folders: **4.5+ million disk I/O calls**
- No tracking of failed paths, so unresolvable paths are checked repeatedly
- Manual `fs` operations instead of VS Code's cached workspace APIs

**Problem 3: Expensive Basename Fallback**
- Lines 90-114 in `pathResolver.ts` perform full recursive directory traversal
- Scans entire workspace tree with `fs.readdirSync()` for every unmatched path
- No caching of directory contents

**Problem 4: Linear Metrics Lookup**
- ProfileStore does linear search through all files on every hover/decoration
- O(n) lookup instead of O(1) Map-based access

**Impact on User Experience:**
- UI freezes during path mapping (even with async yielding)
- Progress toasts don't update smoothly
- Large profiles (>10k samples) can take 10+ seconds to process
- Repeated processing if user loads multiple profiles

## Solution: Pre-Index Workspace Files with Caching (Toggleable Feature)

### High-Level Approach

**Key Design Decision:** Implement both path resolution strategies side-by-side, controlled by a configuration setting. This provides:
- Backward compatibility with existing behavior
- Safety net if indexing has issues
- Performance comparison capability
- User choice based on workspace size

1. **Add configuration setting** (`pyroscope.useIndexedPathResolution`)
   - `true` (default): Use new indexed/cached path resolution
   - `false`: Use original sequential disk I/O approach
   - Documented with performance trade-offs

2. **Build a file index once** when indexed mode is enabled
   - Use `vscode.workspace.findFiles()` for fast, cached file discovery
   - Store files in a Map by basename for O(1) lookup
   - Store files in a Map by full path for O(1) exact matching

3. **Add resolution caching** to PathResolver (both modes)
   - Cache successful resolutions: `profilePath -> localPath`
   - Track unresolvable paths to avoid re-checking
   - Clear cache only when workspace changes

4. **Pre-warm cache** before processing samples (indexed mode only)
   - Extract unique file paths from profile first
   - Resolve all unique paths in batch
   - Process samples using cached results

5. **Keep original resolution logic** as fallback
   - Original `fs.existsSync()` checks preserved
   - Original recursive directory traversal available
   - No breaking changes to existing functionality

### Implementation Plan

#### Phase 0: Add Configuration Setting

**File: `package.json`**

Add new configuration option to `contributes.configuration.properties` section:
```json
"pyroscope.useIndexedPathResolution": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "Use indexed path resolution for faster profile loading. When enabled, workspace files are indexed once for O(1) lookups. When disabled, uses sequential disk checks (slower but more reliable for edge cases).\n\n**Performance:**\n- Enabled: ~3-5 seconds for large profiles (10k+ samples)\n- Disabled: ~10-30 seconds for large profiles\n\n**Workspace Size:**\n- Small (<1k files): Minimal difference\n- Medium (1-10k files): 2-3x faster when enabled\n- Large (>10k files): 5-10x faster when enabled\n\n**Note:** Indexing adds 0.5-2 seconds upfront cost, but saves much more during path resolution."
}
```

#### Phase 1: Add File Indexing to PathResolver

**File: `src/utils/pathResolver.ts`**

1. Add index properties and configuration flag to class
2. Add async initialization method (only runs if indexed mode is enabled)
3. Update `resolveFilePath()` to use cache and route to appropriate method
4. Implement `resolveFilePathIndexed()` for index-based lookups
5. Implement `resolveFilePathSequential()` for original disk-based checks
6. Rename existing `findFilesByBasename()` to `findFilesByBasenameRecursive()`
7. Add `preWarmCache()` method to batch-resolve unique paths

#### Phase 2: Update SourceMapper to Pre-Warm Cache

**File: `src/parser/sourceMapper.ts`**

Update lines 42-56 to extract unique paths and pre-warm cache:
- Extract all unique file paths from profile samples
- Call `pathResolver.preWarmCache()` with unique paths
- Keep existing sample processing loop unchanged

#### Phase 3: Update Command Files to Initialize PathResolver

**Files: `src/commands/fetchFromPyroscope.ts` and `src/commands/loadProfile.ts`**

Update initialization sequence:
- Create PathResolver (reads config to determine mode)
- Call `pathResolver.initialize()` (automatically skips if sequential mode)
- Show "Indexing workspace files..." progress message
- Continue with existing mapping flow

#### Phase 4: Add Cache Invalidation on Workspace Changes (Optional)

**File: `src/utils/pathResolver.ts`**
- Add `clearCache()` method

**File: `src/extension.ts`**
- Register workspace file watcher
- Invalidate cache on file create/delete events

### Files to Modify

1. `package.json` - Add configuration setting
2. `src/utils/pathResolver.ts` - Add indexing, dual-mode resolution, and caching
3. `src/parser/sourceMapper.ts` - Pre-warm cache before processing
4. `src/commands/fetchFromPyroscope.ts` - Initialize resolver
5. `src/commands/loadProfile.ts` - Initialize resolver
6. `src/extension.ts` - Add file watcher (optional, Phase 4)

### Expected Performance Improvements

**Sequential Mode (useIndexedPathResolution: false):**
- Same as current behavior
- 150,000 path resolution calls for 10k samples
- 4.5+ million disk I/O operations
- 10-30 seconds for large profiles
- UI updates every 1000 samples (async yielding)
- Benefits from cache for duplicate paths

**Indexed Mode (useIndexedPathResolution: true, default):**
- One-time workspace indexing: ~0.5-2 seconds for 10k files
- Pre-warming cache: ~0.1-0.5 seconds for 100 unique paths
- Sample processing: Uses cached Map lookups, minimal disk I/O
- **Total time: 3-5 seconds** (60-90% reduction)
- **Disk I/O: ~10k operations** (99.8% reduction)
- Smooth progress updates - no blocking operations

**Performance Comparison Table:**

| Metric | Sequential Mode | Indexed Mode | Improvement |
|--------|----------------|--------------|-------------|
| Index build time | 0ms (no index) | 500-2000ms | N/A |
| Path resolution (100 unique) | 1000-5000ms | 50-100ms | 10-50x faster |
| Path resolution (10k duplicates) | 5000-20000ms | 50-100ms | 50-200x faster |
| Total disk I/O operations | 4.5M+ | ~10k | 99.8% reduction |
| UI responsiveness | Good (async yields) | Excellent (no blocking) | Better |
| Memory overhead | ~1MB | ~5-10MB | Acceptable |

### When to Use Each Mode

**Use Indexed Mode (default) when:**
- ✅ Medium to large workspaces (1,000+ files)
- ✅ Regular profile loading workflow
- ✅ Want fastest possible performance
- ✅ Have sufficient memory (10-50MB extra for index)
- ✅ Workspace structure is stable

**Use Sequential Mode when:**
- ✅ Small workspaces (<500 files)
- ✅ Testing/debugging path resolution issues
- ✅ Very large workspaces (>100k files) where indexing is slow
- ✅ Memory-constrained environments
- ✅ Files are frequently added/removed during development
- ✅ Need absolute certainty of real-time file existence checks

**Recommendation:** Leave indexed mode enabled (default) for most users. It provides significantly better performance with minimal trade-offs.

## Verification Plan

### 1. Unit Tests

Create tests for PathResolver:
- Test cache hit/miss behavior
- Test index building with sample file tree
- Test pre-warming with known paths
- Test cache invalidation
- Test both indexed and sequential modes produce identical results

### 2. Performance Testing

Use a large profile to measure:
```typescript
console.time('Total mapping time');
const metrics = await mapSamplesToSource(parsed, pathResolver);
console.timeEnd('Total mapping time');
```

Expected results:
- Sequential mode: 10-30 seconds for 10k samples
- Indexed mode: 3-5 seconds for 10k samples

### 3. Manual Testing

**Test Both Modes:**

1. **Test Indexed Mode (default):**
   - Ensure `pyroscope.useIndexedPathResolution: true`
   - Run "Pyroscope: Fetch Profile from Pyroscope"
   - Observe progress toast updates smoothly
   - Verify mapping completes in 3-5 seconds
   - Check debug logs show indexing and cache statistics

2. **Test Sequential Mode:**
   - Set `pyroscope.useIndexedPathResolution: false`
   - Run "Pyroscope: Fetch Profile from Pyroscope"
   - Verify profile still loads correctly (slower but works)
   - Check debug logs show sequential mode messages

3. **Compare Performance:**
   - Time both modes with same profile
   - Indexed should be 3-10x faster
   - Both should produce identical results

4. **Test Mode Switching:**
   - Load profile in indexed mode
   - Change setting to sequential mode
   - Reload profile
   - Verify it works correctly after switching

5. **Test Memory Usage:**
   - Check VS Code's memory with large workspace (10k+ files)
   - Verify indexed mode uses reasonable memory (~5-10MB extra)
   - Sequential mode should have minimal memory overhead

### 4. Debug Logging

Add logging to track performance:
```typescript
logger.info(`Index built: ${this.filesByPath.size} files in ${time}ms`);
logger.info(`Cache pre-warmed: ${uniquePaths.length} paths in ${time}ms`);
logger.info(`Cache hit rate: ${hits}/${total} (${percentage}%)`);
```

## Risks and Mitigations

**Risk 1: Large Workspace Index Time**
- Mitigation: Show progress during indexing, use `findFiles()` with patterns
- Fallback: Sequential mode available for very large workspaces

**Risk 2: Memory Usage**
- Mitigation: Index only relevant file types
- Monitoring: Log index size in debug mode
- Fallback: Sequential mode for memory-constrained environments

**Risk 3: Cache Invalidation**
- Mitigation: Clear cache on workspace folder changes
- Fallback: Rebuild index on next profile load

**Risk 4: Index Staleness**
- Mitigation: Add file watcher for workspace changes (Phase 4)
- Fallback: User can toggle to sequential mode for real-time checks
