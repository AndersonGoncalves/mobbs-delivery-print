/**
 * specs/0148-versao-visivel-bridge — sobrescrito pelo CI (`.github/workflows/release-executables.yml`)
 * a cada publicação, com o commit e a data/hora reais daquele build. Os valores abaixo só
 * aparecem em desenvolvimento local (`npm run dev`/`npm start` sem passar pelo CI).
 *
 * specs/0200-build-number-automatico-deploy — BUILD_VERSION usa o X.Y.Z do `package.json`
 * (manual) + a contagem de commits (automática, sempre sobrescrita pelo CI).
 */
export const BUILD_COMMIT = 'dev';
export const BUILD_DATE = 'local';
export const BUILD_VERSION = '1.0.0+dev';
