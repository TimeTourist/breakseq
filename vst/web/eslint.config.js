import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const noMathRandom = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Inject an Rng instead (see CLAUDE.md).' },
  ],
};

const webAudioGlobals = ['OfflineAudioContext', 'AudioContext', 'AudioBuffer', 'window', 'document'].map(
  (name) => ({ name, message: 'Only src/engine/render* may use Web Audio or the DOM.' }),
);

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    // Tests destructure into a mix of new and existing variables: [project, loop] = addLoop(…).
    rules: { 'prefer-const': ['error', { destructuring: 'all' }] },
  },
  {
    files: ['src/model/**/*.ts'],
    rules: {
      ...noMathRandom,
      'no-restricted-globals': ['error', ...webAudioGlobals],
      'no-restricted-imports': [
        'error',
        { patterns: ['**/engine/**', '**/ui/**', 'react', 'react-dom'] },
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/render*.ts'],
    rules: {
      ...noMathRandom,
      'no-restricted-globals': ['error', ...webAudioGlobals],
      'no-restricted-imports': ['error', { patterns: ['**/ui/**', 'react', 'react-dom', 'node-web-audio-api'] }],
    },
  },
  {
    files: ['src/engine/render*.ts'],
    rules: {
      ...noMathRandom,
      'no-restricted-imports': ['error', { patterns: ['**/ui/**', 'react', 'react-dom'] }],
    },
  },
);
