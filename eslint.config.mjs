import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['admin/', 'test/fixtures/', '.dev-server/', '**/*.test.js.snap'],
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            globals: { describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly' },
        },
    },
];
