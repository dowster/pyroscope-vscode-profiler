# Commit Skill

**Command**: `/commit` or "commit these changes"

**Description**: Automated commit workflow that runs all quality checks before creating a commit.

## What This Skill Does

1. **Compile TypeScript**
   - Runs `npm run compile`
   - Fails if compilation errors exist
   - Warnings are allowed

2. **Run Linting**
   - Runs `npm run lint`
   - Fails if linting errors exist
   - Displays warnings but continues

3. **Format Code**
   - Runs `npm run format`
   - Auto-formats all TypeScript files
   - Stages formatted files

4. **Run Tests** (when available)
   - Runs `npm test`
   - Fails if tests fail

5. **Stage Changes**
   - Runs `git add` for modified files
   - Shows diff stats

6. **Create Commit**
   - Prompts for commit message (or uses provided message)
   - Follows conventional commits format
   - Includes Co-Authored-By footer
   - Pre-commit hook runs automatically

7. **Push to Remote** (optional)
   - Asks if you want to push
   - Runs `git push origin <branch>`

## Usage Examples

### Basic Usage
```
User: /commit
```
Claude will:
- Run all checks
- Show any errors
- Ask for commit message
- Create commit
- Ask if you want to push

### With Message
```
User: commit these changes with message "fix: resolve path mapping issue"
```
Claude will:
- Run all checks
- Use provided message
- Create commit
- Ask if you want to push

### Full Workflow
```
User: commit and push with message "feat: add new feature"
```
Claude will:
- Run all checks
- Use provided message
- Create commit
- Push to remote automatically

## Error Handling

### Compilation Fails
- Shows TypeScript errors
- Does NOT create commit
- Asks if you want to fix or abort

### Linting Fails
- Shows linting errors
- Offers to auto-fix if possible
- Does NOT create commit until fixed

### Formatting Changes
- Auto-formats code
- Shows files that were formatted
- Stages formatted files
- Continues with commit

### Tests Fail
- Shows test failures
- Does NOT create commit
- Asks if you want to fix or skip tests

### Pre-Commit Hook Fails
- Shows hook output
- Does NOT create commit
- Suggests fixes based on error

## Commit Message Format

The skill enforces conventional commits:

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, semicolons, etc.
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance

### Examples
```
feat: add debug logging infrastructure

fix: resolve path mapping for CI/CD builds

docs: update README with configuration examples

refactor: extract path resolution into utility class

chore: configure husky pre-commit hooks
```

## Configuration

### Skip Checks
Set in commit message:
```
feat: emergency hotfix [skip-checks]
```
This bypasses all checks but still runs pre-commit hook.

### Skip Tests
```
feat: work in progress [skip-tests]
```
Runs all checks except tests.

### Skip Push
Default behavior - always asks before pushing.

## Best Practices

1. **Commit Often**
   - Small, focused commits
   - Easier to review and revert
   - Better git history

2. **Write Clear Messages**
   - Describe what and why
   - Keep subject line under 72 characters
   - Add body for complex changes

3. **Run Checks Locally**
   - Don't rely on CI/CD to catch issues
   - Faster feedback loop
   - Saves CI/CD resources

4. **Review Changes**
   - Check `git diff` before committing
   - Ensure no debug code or secrets
   - Verify all changes are intentional

## Integration with Husky

The skill respects husky pre-commit hooks:
- Hooks run automatically during commit
- If hook fails, commit is aborted
- Hook output is shown to user
- Can retry after fixing issues

## Output Format

The skill provides clear, structured output:

```
✓ Compiling TypeScript...
✓ Running linting...
✓ Formatting code...
  - Formatted: src/extension.ts
  - Formatted: src/utils/logger.ts
✓ Running tests...
✓ Staging changes...
  M src/extension.ts
  M src/utils/logger.ts
  A src/utils/pathResolver.ts

Commit message:
feat: add debug logging infrastructure

✓ Creating commit...
[main 5c743a0] feat: add debug logging infrastructure
 10 files changed, 442 insertions(+), 89 deletions(-)

Push to remote? (y/n): _
```

## Troubleshooting

### "Cannot find module" errors
Run: `npm install`

### "Git repository not found"
Ensure you're in the project root directory.

### "No changes to commit"
All changes are already committed. Run `git status` to verify.

### "Pre-commit hook failed"
Check hook output, fix issues, and retry commit.

### "Push failed: Updates were rejected"
Run `git pull --rebase` first, then retry push.
