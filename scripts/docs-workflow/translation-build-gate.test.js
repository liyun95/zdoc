'use strict'

// Parser and attribution tests for the dispatcher build gate. The render
// failure shape is lifted from the real 2026-10 node fetch incident
// (run 38290674552): SSG render errors cite a route pathname and a
// ReferenceError cause, never the source file path, so the gate must recover
// the file through the route's slug segment.

const assert = require('node:assert/strict')
const test = require('node:test')

const {parseBuildFailures, attributeBuildFailures} = require('./translation-build-gate')

const NODE_ALTER_ROLE = 'content/en/reference/api/nodejs/nodejs/Authentication/Authentication-alterRole.md'

// Abbreviated from the produce_node log of run 38290674552; the stack frames
// through compiled bundle chunks carry no repo-relative content paths.
const RENDER_FAILURE_LOG = [
  'Error: Can\'t render static file for pathname "/reference/node/node/Authentication-alterRole"',
  '            at generateStaticFile (/home/runner/work/zdoc/zdoc/node_modules/.pnpm/@docusaurus+core@3.10.2/node_modules/@docusaurus/core/lib/ssg/ssgRenderer.js:131:20)',
  '              [cause]: ReferenceError: error_code is not defined',
  '              at _createMdxContent (/home/runner/work/zdoc/zdoc/build/en/__server/assets/js/7444f54a.28652b15.js:145:44)',
  '    [errors]: [',
  '      ]',
  '}'].join('\n')

const COMPILE_FAILURE_LOG = [
  '[ERROR] Docusaurus could not load the file at content/en/guides/tutorials/broken-example.md.',
  'Error: MDX compile failed for file /home/runner/work/zdoc/zdoc/i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/java/v2/v2-Authentication/v2-Authentication-alterRole.md:88:9',
  'Expected a JSX element to be closed at content/en/reference/api/java/java/v2/v2-Authentication/v2-Authentication-AlterRole.md:12:5',
].join('\n')

test('render failures yield route pathnames; compile failures yield repo-relative paths with positions stripped', () => {
  const render = parseBuildFailures({logText: RENDER_FAILURE_LOG})
  assert.deepEqual(render.failingRoutes, ['/reference/node/node/Authentication-alterRole'])
  assert.deepEqual(render.filePaths, [], 'bundle chunk paths must not be mistaken for content files')

  const compile = parseBuildFailures({logText: COMPILE_FAILURE_LOG})
  assert.deepEqual(compile.filePaths.sort(), [
    'content/en/guides/tutorials/broken-example.md',
    'content/en/reference/api/java/java/v2/v2-Authentication/v2-Authentication-AlterRole.md',
    'i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/java/v2/v2-Authentication/v2-Authentication-alterRole.md',
  ])
  assert.deepEqual(compile.failingRoutes, [])
})

test('an exact source-path hit is attributed, and route slugs map back to the source file', () => {
  const files = [
    {sourcePath: NODE_ALTER_ROLE, targetPath: 'i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/node/Authentication/Authentication-alterRole.md'},
    {sourcePath: 'content/en/reference/api/python/foo.md', targetPath: 'i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/python/foo.md'},
  ]
  const byPath = attributeBuildFailures({
    failures: parseBuildFailures({logText: COMPILE_FAILURE_LOG}),
    files: [...files, {
      sourcePath: 'content/en/reference/api/java/java/v2/v2-Authentication/v2-Authentication-AlterRole.md',
      targetPath: 'i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/java/v2/v2-Authentication/v2-Authentication-alterRole.md',
    }],
  })
  assert.deepEqual(byPath.sourceHits, ['content/en/reference/api/java/java/v2/v2-Authentication/v2-Authentication-AlterRole.md'])
  assert.deepEqual(byPath.targetHits, ['i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/java/v2/v2-Authentication/v2-Authentication-alterRole.md'])

  const byRoute = attributeBuildFailures({failures: parseBuildFailures({logText: RENDER_FAILURE_LOG}), files})
  assert.deepEqual(byRoute.sourceHits, [`/reference/node/node/Authentication-alterRole -> ${NODE_ALTER_ROLE}`])
  assert.deepEqual(byRoute.targetHits, [])
})

test('an ambiguous slug attributes nothing and a clean log attributes nothing', () => {
  const ambiguous = parseBuildFailures({logText: RENDER_FAILURE_LOG})
  const collisions = [
    {sourcePath: 'content/en/reference/api/nodejs/nodejs/Authentication/Authentication-alterRole.md', targetPath: 'a'},
    {sourcePath: 'content/en/reference/api/cpp/cpp/Authentication/Authentication-alterRole.md', targetPath: 'b'},
  ]
  assert.deepEqual(attributeBuildFailures({failures: ambiguous, files: collisions}).sourceHits, [])

  const green = parseBuildFailures({logText: '[INFO] Docusaurus version: 3.10.2\nSuccess! Site built'})
  assert.deepEqual(attributeBuildFailures({failures: green, files: collisions}), {sourceHits: [], targetHits: [], attributedRoutes: []})
})

test('case-insensitive slug fallback catches casing drift between route and file', () => {
  const files = [{sourcePath: 'content/en/reference/api/cpp/cpp/Authentication/Authentication-AlterRole.md', targetPath: 't'}]
  const verdict = attributeBuildFailures({failures: parseBuildFailures({logText: RENDER_FAILURE_LOG}), files})
  assert.equal(verdict.sourceHits.length, 1, 'Authentication-alterRole route matches the Authentication-AlterRole file')
})

test('a ja-JP-prefixed route attributes to the translated file, never to the source', () => {
  const files = [{sourcePath: NODE_ALTER_ROLE, targetPath: 'i18n/ja-JP/docusaurus-plugin-content-docs/current/reference/node/node/Authentication/Authentication-alterRole.md'}]
  const log = 'Error: Can\'t render static file for pathname "/ja-JP/reference/node/node/Authentication-alterRole"'
  const verdict = attributeBuildFailures({failures: parseBuildFailures({logText: log}), files})
  assert.deepEqual(verdict.sourceHits, [], 'a failing ja page is target-side: dispatching regenerates it')
  assert.equal(verdict.targetHits.length, 1)
  assert.match(verdict.targetHits[0], / -> i18n\/ja-JP\/.*Authentication-alterRole\.md$/)
  assert.deepEqual(verdict.attributedRoutes, ['/ja-JP/reference/node/node/Authentication-alterRole'])
})

test('warning lines citing repo paths are not failure evidence', () => {
  const log = [
    `[WARNING] Docs: 1 broken link found. Broken link on source page path=/x, linking to /y (source file: ${NODE_ALTER_ROLE})`,
    `Warning: unresolved link in ${NODE_ALTER_ROLE}:10:2 ignored`,
    `[INFO] Docusaurus version: 3.10.2`,
  ].join('\n')
  assert.deepEqual(parseBuildFailures({logText: log}), {filePaths: [], failingRoutes: []})
  // Error-context lines still extract alongside warnings.
  const mixed = `${log}\nError: MDX compile failed for file /home/runner/work/zdoc/zdoc/${NODE_ALTER_ROLE}:12:5`
  assert.deepEqual(parseBuildFailures({logText: mixed}).filePaths, [NODE_ALTER_ROLE])
})
