import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*.renderer*', '@renderer/*', '**/renderer/**'],
              message: 'Main/preload must not import renderer code.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*'],
              message: 'Renderer must not import Electron or Node builtins. Use the preload bridge (window.presenter).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // An await-free async body is the idiomatic shape for a `Promise<void>` mock
      // (`vi.fn(async () => undefined)`): the `async` keyword is what makes the stub return a
      // promise rather than a plain value, so the await-free body is the point, not an
      // oversight. The rule is therefore noise in test files. Scoped to `**/*.test.ts` — it
      // stays an error in production code, where an async function with no await is a
      // genuine mistake. `no-floating-promises` still applies everywhere and covers the
      // common form of the mistake this relaxation could otherwise hide.
      '@typescript-eslint/require-await': 'off'
    }
  }
)
