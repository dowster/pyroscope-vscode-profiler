# Pyroscope VS Code Extension - Project Instructions

## Commit Workflow

**IMPORTANT**: Always follow this workflow when committing changes:

### Pre-Commit Checklist

Before running `git commit`, ensure these steps are completed:

1. **Compile TypeScript**
   ```bash
   npm run compile
   ```
   - Must pass without errors
   - Warnings are acceptable but should be addressed

2. **Run Linting**
   ```bash
   npm run lint
   ```
   - Must pass without errors
   - Warnings should be fixed or explicitly disabled with comments
   - Use `// eslint-disable-next-line <rule-name>` for legitimate exceptions (HTTP headers, protobuf types, VS Code API property names)

3. **Format Code**
   ```bash
   npm run format
   ```
   - Automatically formats all TypeScript files
   - Uses Prettier with the project's configuration

4. **Run Tests** (when available)
   ```bash
   npm test
   ```
   - Currently returns success (no tests implemented yet)

### Automated Pre-Commit Hook

The repository has **husky** and **lint-staged** configured to automatically:
- Run ESLint with auto-fix on staged `.ts` files
- Run Prettier to format staged `.ts` files

This happens automatically when you run `git commit`. If the hook fails:
1. Review the error messages
2. Fix the issues
3. Stage the fixes with `git add`
4. Try committing again

### Commit Message Format

Follow conventional commits format:
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat: add debug logging infrastructure

fix: resolve path mapping issue for CI/CD builds

docs: update README with path mapping configuration
```

### Manual Commit Process

If you need to bypass the automated workflow (not recommended), use:
```bash
git commit --no-verify
```

**Only use `--no-verify` when:**
- The pre-commit hook is failing due to a bug in the hook itself
- You're making emergency hotfix commits
- You've manually verified all checks pass

### Commit Skill

You can use the `/commit` skill (if available) which automates this entire workflow:
1. Runs compilation
2. Runs linting
3. Runs formatting
4. Runs tests
5. Stages changes
6. Creates commit with proper message format
7. Pushes to remote

## Code Quality Standards

### TypeScript
- Use strict type checking
- Avoid `any` types when possible
- Add JSDoc comments for public APIs
- Use descriptive variable and function names

### Linting Rules
- Naming conventions: camelCase for variables/functions, PascalCase for classes/types
- No unused variables or imports
- Use `===` instead of `==`
- Always use curly braces for control statements

### Formatting
- Prettier handles all formatting
- 4-space indentation
- Single quotes for strings
- Trailing commas in objects/arrays
- Line length: 100 characters (Prettier default)

## Project Structure

```
src/
├── commands/          # VS Code command handlers
├── decorations/       # Editor decoration and hint rendering
├── parser/            # Profile parsing and source mapping
├── pyroscope/         # Pyroscope API client
├── state/             # State management (profile store)
├── utils/             # Utilities (logger, path resolver)
└── extension.ts       # Extension entry point
```

## Development Workflow

1. **Create feature branch**
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make changes**
   - Edit code
   - Test manually in VS Code Extension Host

3. **Run quality checks**
   ```bash
   npm run compile && npm run lint && npm run format
   ```

4. **Commit changes**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```
   - Pre-commit hook runs automatically

5. **Push to remote**
   ```bash
   git push origin feat/your-feature-name
   ```

6. **Create pull request**
   - CI/CD runs automatically
   - Semantic-release handles versioning

## Debugging

### Enable Debug Logging
Set in VS Code settings:
```json
{
  "pyroscope.debugLogging": true
}
```

View logs: **View** → **Output** → **Pyroscope Profile Viewer**

### Show Debug Info
Run command: **Pyroscope: Show Debug Info**
- Shows all configuration
- Shows path mappings with variable substitution
- Shows loaded profile details

## Common Issues

### Linting Fails on HTTP Headers or Protobuf Types
Add eslint-disable comment:
```typescript
// eslint-disable-next-line @typescript-eslint/naming-convention
const Profile = root.lookupType('perftools.profiles.Profile');
```

### Pre-Commit Hook Fails
1. Check error output
2. Run `npm run lint` to see specific issues
3. Run `npm run format` to auto-fix formatting
4. Stage fixes and commit again

### Compilation Fails
1. Check TypeScript errors: `npm run compile`
2. Ensure all imports are correct
3. Check for type mismatches
4. Ensure all dependencies are installed: `npm install`
