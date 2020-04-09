'use strict'

// For old node.js versions, we use es5
const fs = require('fs')
const ignore = require('../')
const expect = require('chai').expect
const { spawn, spawnSync } = require('child_process')
const tmp = require('tmp').dirSync
const mkdirp = require('mkdirp').sync
const path = require('path')
const rm = require('rimraf').sync
const it = require('ava')
const Sema = require('async-sema')
const cuid = require('cuid')

const IS_WINDOWS = process.platform === 'win32'
const SHOULD_TEST_WINDOWS = !process.env.IGNORE_TEST_WIN32
  && IS_WINDOWS
const CI = !!process.env.CI;
const PARALLEL_DOCKER_BUILDS = 6

const cases = [
  [
    'special cases: invalid empty paths, just ignore',
    [
    ],
    {
      '': 1,
    }
  ],
  [
    '.git files are just like any other files',
    [
      '.git/*',
      '!.git/config',
      '.ftpconfig'
    ],
    {
      '.ftpconfig': 1,
      '.git/config': 0,
      '.git/description': 1,
    }
  ],
  [
    '.dockerignore documentation sample 1',
    [
      '# comment',
      '*/temp*',
      '*/*/temp*',
      'temp?'
    ],
    {
      'somedir/temporary.txt': 1,
      'somedir/temp/something.txt': 1,
      'somedir/subdir/temporary.txt': 1,
      'somedir/subdir/temp/something.txt': 1,
      'tempa/something.txt': 1,
      'tempb/something.txt': 1,
      'something.txt': 0,
      'somedir/something.txt': 0,
      'somedir/subdir/something.txt': 0,
    },
    // true
  ],
  [
    '.dockerignore documentation sample 2',
    [
      '*.md',
      '!README.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
    }
  ],
  [
    '.dockerignore documentation sample 3',
    [
      '*.md',
      '!README*.md',
      'README-secret.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
      'README-public.md': 0,
      'README-secret.md': 1,
    }
  ],
  [
    '.dockerignore documentation sample 4',
    [
      '*.md',
      'README-secret.md',
      '!README*.md'
    ],
    {
      'test.txt': 0,
      'test.md': 1,
      'README.md': 0,
      'README-public.md': 0,
      'README-secret.md': 0,
    }
  ],
  // [POSIX] because the asterisk is not allowed in a file or directory name on
  // Windows: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
  [
    'wildcard: special case, escaped wildcard [POSIX]',
    [
      '*.html',
      'a/b/*.html',
      '!a/b/\\*/index.html'
    ],
    {
      'a/b/*/index.html': 0,
      'a/b/index.html': 1,
      'index.html': 1,
    }
  ],
  [
    'wildcard: treated as a shell glob suitable for consumption by fnmatch(3) [POSIX]',
    [
      '*.html',
      '*/*.html',
      '*/*/*.html',
      '*/*/*/*.html',
      '!b/\\*/index.html',
    ],
    {
      'a/b/*/index.html': 1,
      'a/b/index.html': 1,
      'b/*/index.html': 0,
      'b/index.html': 1,
      'index.html': 1,
    }
  ],
  [
    'wildcard: with no escape',
    [
      '*.html',
      'a/b/*.html',
      '!a/b/*/index.html'
    ],
    {
      'a/b/c/index.html': 0,
      'a/b/index.html': 1,
      'index.html': 1,
    }
  ],
  [
    'a negative pattern without a trailing wildcard re-includes the directory (unlike gitignore)',
    [
      '/node_modules/*',
      '!/node_modules',
      '!/node_modules/package'
    ],
    {
      'node_modules/a/a.js': 0,
      'node_modules/package/a.js': 0,
    }
  ],
  [
    'unignore with 1 globstar, reversed order',
    [
      '!foo/bar.js',
      'foo/*'
    ],
    {
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  [
    'unignore with 2 globstars, reversed order',
    [
      '!foo/bar.js',
      'foo/**'
    ],
    {
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  [
    'unignore with several groups of 2 globstars, reversed order',
    [
      '!foo/bar.js',
      'foo/**/**'
    ],
    {
      'foo/bar': 1,
      'foo/bar.js': 1,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  [
    'unignore with 1 globstar',
    [
      'foo/*',
      '!foo/bar.js'
    ],
    {
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  [
    'unignore with 2 globstars',
    [
      'foo/**',
      '!foo/bar.js'
    ],
    {
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  [
    'several groups of 2 globstars',
    [
      'foo/**/**',
      '!foo/bar.js'
    ],
    {
      'foo/bar.js': 0,
      'foo/bar2.js': 1,
      'foo/bar/bar.js': 1,
    }
  ],

  // description  patterns  paths/expect  only
  [
    'ignore dot files',
    [
      '.*'
    ],
    {
      '.a': 1,
      '.gitignore': 1,
      '.dockerignore': 1
    }
  ],

  [
    'Negate directory inside ignored directory',
    [
      '.abc/*',
      '!.abc/d/'
    ],
    {
      '.abc/a.js': 1,
      '.abc/d/e.js': 0,
    }
  ],

  [
    'wildcard with whitelisting', [
      '*',
      '!package.json',
      '!src',
      '!yarn.lock'
    ], {
      'node_modules/gulp/node_modules/abc.md': 1,
      'node_modules/zeit': 1,
      'package.json': 0,
      'yarn.lock': 0,
      'src/index.js': 0,
      '.git/abc': 1,
      'Dockerfile': 1,
      '.dockerignore': 1,
    }
  ],

  [
    'wildcard with whitelisting (zeit/dockerignore/issues/11)', [
      '*',
      '!src',
      '!scripts',
      '!config',
      '!yarn.lock',
      '!package.json',
      '!.env*',
    ], {
      '.env.sample': 0,
      '.env/.sample': 0,
      '.env/other': 0,
      'Dockerfile': 1,
      '.dockerignore': 1,
    }
  ],

  [
    'Negate wildcard inside ignored parent directory (gitignore differs here)',
    [
      '.abc/*',
      // .abc/d will be ignored
      '!.abc/d/*'
    ],
    {
      '.abc/a.js': 1,
      // but '.abc/d/e.js' won't be (unlike gitignore)
      '.abc/d/e.js': 0,
    }
  ],

  [
    'A blank line matches no files',
    [
      ''
    ],
    {
      'a.txt': 0,
      'a/b/c.txt': 0,
    }
  ],
  [
    'A line starting with # serves as a comment.',
    ['#abc'],
    {
      '#abc': 0,
    }
  ],
  [
    'Put a backslash ("\\") in front of the first hash for patterns that begin with a hash.',
    [
      '\\#abc'
    ],
    {
      '#abc': 1,
    }
  ],
  [
    'Trailing spaces are ignored',
    [
      'a ',
      'b /',
    ],
    {
      // docker trims spaces in paths, so leading/trailing spaces never match
      'a': 1,
      'b': 1,
      'a ': 0,
      'b ': 0,
    }
  ],
  [
    'Trailing spaces with backslashes never match [POSIX]',
    [
      'a\\ ',
      'b\\ /',
    ],
    {
      'a\\ ': 0, // this actually includes a backslash in the file name
      'a\\': 0,
      'a ': 0,
      'a': 0,
      'b\\ ': 0,
      'b ': 0,
      'b': 0,
    }
  ],
  [
    'Leading spaces are ignored',
    [
      ' a',
      '/ b',
    ],
    {
      'a': 1,
      'b': 1,
      ' a': 0,
      ' b': 0,
    }
  ],
  [
    'Leading spaces with backslashes are not ignored [POSIX]',
    [
      '\\ a',
      '/\\ b',
    ],
    {
      'a': 0,
      'b': 0,
      ' a': 1,
      ' b': 1,
    }
  ],
  [
    'spaces are accepted within patterns',
    [
      'abc d',
      'abc/a b c'
    ],
    {
      'abc d': 1,
      'abc/a b c': 1,
      'abc/a b d': 0,
      'abc/abc d': 0,
    }
  ],
  [
    'spaces are accepted within patterns. "\\ " doesn\'t mean anything special [POSIX]',
    [
      'abc\\ d',
      'abc/a\\ b\\ c'
    ],
    {
      'abc d': 1,
      'abc\\ d': 0,
      'abc/a b c': 1,
      'abc/a\\ b\\ c': 0,
      'abc/a b d': 0,
      'abc/abc d': 0,
    }
  ],
  [
    // [POSIX] because backslashes are treated as path separators on Windows and
    // cannot be used to escape the `!` character.
    'Put a backslash ("\\") in front of the first "!" for patterns that begin with a literal "!" [POSIX]',
    [
      '\\!abc',
      '\\!important!.txt'
    ],
    {
      '!abc': 1,
      'abc': 0,
      'b/!important!.txt': 0,
      '!important!.txt': 1,
    }
  ],
  [
    'Negation is also possible with "/!" or "!/", but not "/!/" ("docker build" compatibility)',
    [
      'a', '/!a',
      'b', '!/b',
      'c', '/!/c',
      ...(IS_WINDOWS ?
        [
          'd', '\\!d',
          'e', '!\\e',
          'f', '\\!\\f',
        ]
        : []
      ),
    ],
    {
      'a': 0, '!a': 0,
      'b': 0, '!b': 0,
      'c': 1, '!c': 0, '!/c': 0,
      ...(IS_WINDOWS ?
        {
          'd': 0, '!d': 0,
          'e': 0, '!e': 0,
          'f': 1, '!f': 0, '!/f': 0,
        }
        : {}
      ),
    }
  ],
  [
    'An optional prefix "!" which negates the pattern; any matching file excluded by a previous pattern will become included again',
    [
      'abc',
      '!abc'
    ],
    {
      'abc/a.js': 0,
    }
  ],
  [
    'It is possible to re-include a file if a parent directory of that file is excluded',
    [
      'abc/',
      '!abc/a.js'
    ],
    {
      'abc/a.js': 0,
      'abc/d/e.js': 1,
    }
  ],
  [
    'we did not know whether the rule is a dir first',
    [
      'abc',
      'bcd/abc',
      '!bcd/abc/a.js'
    ],
    {
      'abc/a.js': 1,
      'bcd/abc/f.js': 1,
      'bcd/abc/a.js': 0,
    }
  ],

  [
    'If the pattern ends with a slash, the slash is basically ignored/dropped',
    [
      'abc/'
    ],
    {
      'abc/def.txt': 1,
    }
  ],

  [
    'If the pattern does not contain a slash /, it\'s just a file in current directory',
    [
      'a.js',
      'f/'
    ],
    {
      'a.js': 1,
      'b/a/a.js': 0,
      'a/a.js': 0,
      'b/a.jsa': 0,
      'f/h': 1,
      'g/f/h': 0,
    }
  ],
  [
    'Otherwise, it\'s a complete relative path',
    [
      'a/a.js'
    ],
    {
      'a/a.js': 1,
      'a/a.jsa': 0,
      'b/a/a.js': 0,
      'c/a/a.js': 0,
    }
  ],

  [
    'wildcards in the pattern will not match a / in the pathname.',
    [
      'Documentation/*.html'
    ],
    {
      'Documentation/git.html': 1,
      'Documentation/dir.html/test.txt': 1,
      'Documentation/ppc/ppc.html': 0,
      'tools/perf/Documentation/perf.html': 0,
    }
  ],

  [
    'A leading slash matches the beginning of the pathname',
    [
      '/*.c'
    ],
    {
      'cat-file.c': 1,
      'mozilla-sha1/sha1.c': 0,
    }
  ],

  [
    'Leading and trailing slashes are removed from patterns',
    [
      '/a',
      'b/',
      '/c/',
    ],
    {
      'a': 1,
      'b': 1,
      'c': 1,
      'd': 0,
    }
  ],

  // The "vs. docker" test would fail for the '/b' path below (hence the
  // [SKIP-DOCKER] annotation), but only because "docker build" converts
  // paths from absolute to relative BEFORE pattern matching:
  // https://github.com/moby/moby/blob/v19.03.8/pkg/archive/archive.go#L806
  // https://github.com/moby/moby/blob/v19.03.8/pkg/archive/archive.go#L825
  [
    'Absolute paths don\'t match non-wildcard patterns [SKIP-DOCKER]',
    [
      'a',
      '/a',
      'b',
      '/b',
    ],
    {
      'a': 1,
      '/b': 0, // "vs. docker" would fail this one (see comment above)
    }
  ],

  [
    'Absolute paths like "/a" don\'t usually match any patterns, except for the wildcard',
    [
      '*',
    ],
    {
      '/a': 1,
      'Dockerfile': 1,
      '.dockerignore': 1,
    }
  ],

  [
    'A leading "**" followed by a slash means match in all directories',
    [
      '**/foo'
    ],
    {
      'foo/a': 1,
      'a/foo/a': 1,
      'a/b/c/foo/a': 1,
    }
  ],

  [
    '"**/foo/bar" matches file "bar" anywhere that is directly under directory "foo"',
    [
      '**/foo/bar'
    ],
    {
      'foo/bar': 1,
      'abc/foo/bar': 1,
    }
  ],

  [
    '"**/foo/bar" matches directory "bar" anywhere that is directly under directory "foo"',
    [
      '**/foo/bar'
    ],
    {
      'foo/bar': 1,
      'abc/foo/bar/abc': 1,
    }
  ],

  [
    'A trailing "/**" matches everything inside',
    [
      'abc/**',
      '*/abc/**',
    ],
    {
      'abc/b': 1,
      'abc/d/e/f/g': 1,
      'bcd/abc/a': 1,
    }
  ],

  [
    'A slash followed by two consecutive asterisks then a slash matches zero or more directories',
    [
      'a/**/b'
    ],
    {
      'a/b': 1,
      'a/x/a': 0,
      'a/x/b': 1,
      'a/x/y/a': 0,
      'a/x/y/b': 1,
      'b/a.txt': 0,
      'b/a/b': 0,
    }
  ],

  [
    'Undo identical ignore rules',
    [
      'ab',
      '!ab',
      'cd*',
      '!cd*',
      'dir/*',
      '!dir/*',
      '*.htm',
      '!*.htm',
    ],
    {
      'ab': 0,
      'cd': 0,
      'cde': 0,
      'dir/foo': 0,
      'index.htm': 0,
    }
  ],
  [
    'Undo "*" rule with "**" rule',
    [
      '*.htm',
      '!**/*.htm',
    ],
    {
      'welcome.htm': 0,
      'dir/index.htm': 0,
    }
  ],
  [
    'Undo identical rule with "**" pattern',
    [
      '.foo',
      '!**/.foo',
      '.bar',
      '!**/.bar'
    ],
    {
      '.foo/.foo': 0,
      '.bar': 0,
    }
  ],
  // TODO: review the implementation for this test case, because it fails the
  // "vs. docker" comparison (disabled with '[SKIP-DOCKER]' in the title).
  // This is a corner case where docker's behavior seems to mismatch their own
  // spec. It is still useful to have this test enabled here in order to verify
  // consistent cross-platform behavior (Windows, Linux, macOS).
  [
    'Undo identical rule with "**" pattern (zeit/dockerignore/issues/15) [SKIP-DOCKER]',
    [
      '.foo',
      '!**/.foo',
    ],
    {
      '.foo/bar': 0, // fails 'vs. docker' ("docker build" actually ignores '.foo/bar')
    }
  ],

  [
    'add a file content',
    'test/fixtures/.aignore',
    {
      'abc/a.js': 1,
      'abc/b/b.js': 0,
      '#e': 0,
      '#f': 1,
    }
  ],

  [
    'test a dockerignore file that failed in now-cli',
    'test/fixtures/.now-ignore',
    {
      '.dockerignore': 1,
      '.flowconfig': 1,
      '.gitignore': 1,
      'Dockerfile': 1,
      'now.json': 1,
      'package.json': 0,
      'readme.md': 1,
      'rollup.config.js': 0,
      'yarn.lock': 0,
      '.git/a': 1,
      'src/index.js': 0,
      'src/main.js': 0,
      'src/schemas/index.js': 0,
    }
  ],

  [
    'https://github.com/zeit/now-cli/issues/1368',
    'test/fixtures/.now-ignore-2',
    {
      '.dockerignore': 1,
      '.flowconfig': 1,
      '.gitignore': 1,
      'Dockerfile': 1,
      'now.json': 1,
      'readme.md': 1,
      '.git/a': 1,
      'src/index.js': 0,
      'src/main.js': 0,
      'src/schemas/index.js': 0,
    }
  ],

  [
    // [POSIX] because the question mark is not allowed in a file or directory name
    // on Windows: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
    'question mark should not break all things [POSIX]',
    'test/fixtures/.ignore-issue-2', {
      '.project': 1,
      // remain
      'abc/.project': 0,
      '.a.sw': 0,
      '.a.sw?': 1,
      'thumbs.db': 1,
    }
  ],
  [
    'dir ended with "*"', [
      'abc/*'
    ], {
      'abd': 0,
      'abc/def.txt': 1,
      'abc/def/ghi': 1,
    }
  ],
  [
    'file ended with "*"', [
      'abc*',
    ], {
      'abc': 1,
      'abcdef': 1,
      'abcd/test.txt': 1,
    }
  ],
  [
    'dir ended with "*"', [
      'abc*',
    ], {
      'abc': 1,
      'abc/def.txt': 1,
    }
  ],
  [
    'wildcard as filename', [
      '*.b'
    ], {
      '.b': 1,
      'a.b': 1,
      'b/.b': 0,
      'b/a.b': 0,
      'b/.ba': 0,
      'b/c/a.b': 0,
    }
  ],
  [
    'slash at the beginning and come with a wildcard', [
      '/*.c'
    ], {
      '.c': 1,
      'c.c': 1,
      'c/c.c': 0,
      'c/d': 0,
    }
  ],
  [
    'dot file', [
      '.d',
      '*/.d',
    ], {
      '.d': 1,
      '.dd': 0,
      'd.d': 0,
      'd/.d': 1,
      'd/d.d': 0,
      'd/e': 0,
    }
  ],
  [
    'dot dir', [
      '.e',
      '*/.e'
    ], {
      '.ee': 0,
      'e.e': 0,
      '.e/e': 1,
      '.e/f': 1,
      'e/.e': 1,
      'f/.e': 1,
      'e/e.e': 0,
      'e/f': 0,
    }
  ],
  [
    'case insensitive matching (the default behavior) [CASE-INSENSITIVE]',
    [
      'ab',
      'cD/eF',
      'GH',
    ], {
      'AB': 1,
      'cd/ef': 1,
      'gh': 1,
    }
  ],
  [
    'case sensitive matching [CASE-SENSITIVE]',
    [
      'ab',
      'cD/eF',
      'cD/AB',
      'GH',
    ], {
      'AB': 0,
      'cD/ef': 0,
      'cD/AB': 1,
      'gh': 0,
    }
  ],
  [
    'node modules: once', [
      'node_modules/'
    ], {
      'node_modules/gulp/node_modules/abc.md': 1,
      'node_modules/gulp/node_modules/abc.json': 1,
    }
  ],
  [
    'node modules: twice', [
      'node_modules/',
      'node_modules/'
    ], {
      'node_modules/gulp/node_modules/abc.md': 1,
      'node_modules/gulp/node_modules/abc.json': 1,
    }
  ]
]

let cases_to_test_only = cases.filter(function (c) {
  return c[3]
})

function readPatterns(file) {
  return fs.readFileSync(file).toString()
}

let real_cases = cases_to_test_only.length
  ? cases_to_test_only
  : cases

real_cases.forEach(function(c) {
  const description = c[0]
  let patterns = c[1]
  const paths_object = {
    '.dockerignore': 0, // default entry for 'vs. docker' test
    'Dockerfile': 0,    // default entry for 'vs. docker' test
    ...c[2], // may override '.dockerignore' and 'Dockerfile' keys above
  }

  // [POSIX] tests may use the backslash as a pattern escape character, and
  // may use certain reserved characters in file names. On Windows, both the
  // backslash and the forward slash are treated as path separators, and the
  // characters [<>:/\\|?*] cannot be used in file names.
  if (IS_WINDOWS && description.includes('[POSIX]')) {
    return
  }

  // There are 3 types of tests with regard to case sensitiveness:
  // * [CASE-SENSITIVE] tests specifically require { ignorecase: false }
  // * [CASE-INSENSITIVE] tests specifically require { ignorecase: true }
  // * All other tests should pass regardless of the ignorecase value
  const isCaseSensitiveTest = description.includes('[CASE-SENSITIVE]')
  const isCaseInsensitiveTest = description.includes('[CASE-INSENSITIVE]')

  if (typeof patterns === 'string') {
    patterns = readPatterns(patterns)
  }

  // All paths to test
  let paths = Object.keys(paths_object)

  // paths that NOT ignored
  let expected = paths
  .filter(function(p) {
    return !paths_object[p]
  })
  .sort()

  function expect_result(t, result, mapper) {
    const mapped = mapper ? expected.map(mapper) : expected
    t.deepEqual(result.sort(), mapped.sort())
  }

  !isCaseSensitiveTest &&
  it('.filter():'.padEnd(26) + description, function(t) {
    t.plan(1)
    let ig = ignore()
    let result = ig
      .addPattern(patterns)
      .filter(paths)

    expect_result(t, result)
  })

  !isCaseInsensitiveTest &&
  it(`case sensitive .filter():`.padEnd(26) + description, function(t) {
    t.plan(1)
    let ig = ignore({
      ignorecase: false, // the default value is true
    })
    let result = ig
      .addPattern(patterns)
      .filter(paths)

    expect_result(t, result)
  })

  !isCaseSensitiveTest &&
  it('.createFilter():'.padEnd(26) + description, function(t) {
    t.plan(1)
    let result = paths.filter(
      ignore()
      .addPattern(patterns)
      .createFilter(),
      // thisArg should be binded
      null
    )

    expect_result(t, result)
  })

  !isCaseSensitiveTest &&
  it('.ignores(path):'.padEnd(26) + description, function (t) {
    t.plan(Object.keys(paths_object).length)
    let ig = ignore().addPattern(patterns)

    Object.keys(paths_object).forEach(function (path) {
      t.is(ig.ignores(path), !!paths_object[path])
    })
  })

  // Run the test cases against real `docker build` and `docker run` output
  CI &&
  !isCaseInsensitiveTest && // Docker/.dockerignore is case sensitive
  !description.includes('[SKIP-DOCKER]') &&
  it('vs. docker:'.padEnd(26) + description, async function (t) {
    t.plan(1)
    let result = (await getNativeDockerIgnoreResults(patterns, paths)).sort()

    expect_result(t, result)
  })

  !isCaseSensitiveTest &&
  SHOULD_TEST_WINDOWS && it('win32: .filter():'.padEnd(26) + description, function(t) {
    t.plan(1)
    let win_paths = paths.map(make_win32)

    let ig = ignore()
    let result = ig
      .addPattern(patterns)
      .filter(win_paths)

    expect_result(t, result, make_win32)
  })
})

it('.add(<Ignore>)'.padEnd(26), function(t) {
  t.plan(2)
  let a = ignore().add(['.abc/*', '!.abc/d/'])
  let b = ignore().add(a).add('!.abc/e/')

  let paths = [
    '.abc/a.js',    // filtered out
    '.abc/d/e.js',  // included
    '.abc/e/e.js'   // included by b, filtered out by a
  ]

  t.deepEqual(a.filter(paths), ['.abc/d/e.js'])
  t.deepEqual(b.filter(paths), ['.abc/d/e.js', '.abc/e/e.js'])
})

function make_win32 (path) {
  return path.replace(/\//g, '\\')
}


it('fixes babel class'.padEnd(26), function (t) {
  let constructor = ignore().constructor

  try {
    constructor()
  } catch (e) {
    t.pass()
    return
  }

  t.fail()
})


it('kaelzhang/node-ignore#32'.padEnd(26), function (t) {
  t.plan(2)
  let KEY_IGNORE = typeof Symbol !== 'undefined'
    ? Symbol.for('dockerignore')
    : 'dockerignore';

  let a = ignore().add(['.abc/*', '!.abc/d/'])

  // aa is actually not an IgnoreBase instance
  let aa = {}
  aa._rules = a._rules.slice()
  aa[KEY_IGNORE] = true

  let b = ignore().add(aa).add('!.abc/e/')

  let paths = [
    '.abc/a.js',    // filtered out
    '.abc/d/e.js',  // included
    '.abc/e/e.js'   // included by b, filtered out by a
  ]

  t.deepEqual(a.filter(paths), ['.abc/d/e.js'])
  t.deepEqual(b.filter(paths), ['.abc/d/e.js', '.abc/e/e.js'])
})

it('some tests take longer as docker images are built in the background ', function(t){
  t.pass()
})

let tmpCount = 0
let tmpRoot = tmp().name


function createUniqueTmp () {
  let dir = path.join(tmpRoot, String(tmpCount ++))
  // Make sure the dir not exists,
  // clean up dirty things
  rm(dir)
  mkdirp(dir)
  return dir
}

// number of docker builds in parallel
let dockerBuildSema = new Sema(PARALLEL_DOCKER_BUILDS, {capacity: cases.length})
async function getNativeDockerIgnoreResults (rules, paths) {
  await dockerBuildSema.acquire()
  const dir = createUniqueTmp()
  const imageTag = cuid()

  const dockerignore = typeof rules === 'string'
    ? rules
    : rules.join('\n')

  const DockerfileName = 'Dockerfile'
  const Dockerfile = `
    FROM busybox
    COPY . /build-context
    WORKDIR /build-context
    CMD find . -type f
  `
  // `normalize` replaces forward slashes with backslashes on Windows
  paths = paths.filter(p => p).map(p => path.normalize(p))
  paths.forEach(function (path, i) {
    if (path === '.dockerignore') {
      return
    }

    // We do not know if a path is NOT a file,
    // if we:
    // `touch a`
    // and then `touch a/b`, then boooom!
    if (containsInOthers(path, i, paths)) {
      return
    }

    touch(dir, path)
  })

  touch(dir, '.dockerignore', dockerignore)
  touch(dir, DockerfileName, Dockerfile)

  // The reason for runSync instead of runAsync is that `docker build` must
  // finish before executing `docker run`. Note that getNativeDockerIgnoreResults
  // is async and ava runs tests in parallel, so runSync does not prevent
  // running multiple docker builds in parallel (and dockerBuildSema controls
  // approximately how many to run in parallel).
  runSync('docker', ['build', '-f', DockerfileName, '-t', imageTag, '.'], {
    cwd: dir
  })

  // runSync because `docker run` must finish before executing `docker rmi`
  const out = runSync('docker', ['run', '--rm', imageTag], {
    cwd: dir
  })

  dockerBuildSema.release()

  // OK to be async because nothing depends on completion of `docker rmi`
  runAsync('docker', ['rmi', imageTag], {
    cwd: dir
  })

  // Remove empty lines and the './' precceding each file
  return out.split('\n').filter(Boolean).map(x => x.slice(2));
}

// Error-handling wrapper around child_process.spawnSync()
function runSync(command, args, options) {
  const proc = spawnSync(command, args, { ...options, encoding: 'utf8' })
  if (proc.error) {
    console.error(proc.error)
    throw proc.error
  }
  if (proc.stderr) {
    console.error(proc.stderr)
    throw new Error(proc.stderr)
  }
  return proc.stdout
}

// Error-handling wrapper around child_process.spawn()
function runAsync(command, args, options) {
  spawn(command, args, { ...options, encoding: 'utf8' })
  .on('error', error => {
    console.error(`Error executing: ${[command, ...args].join(' ')}\n${error}`)
  })
}

function touch (root, file, content) {
  const { dir, base: basename } = path.parse(file)

  if (dir) {
    mkdirp(path.join(root, dir))
  }

  // abc/ -> should not create file, but only dir
  if (basename) {
    fs.writeFileSync(path.join(root, file), content || '')
  }
}

function containsInOthers (path, index, paths) {
  return paths.some(function (p, i) {
    if (index === i) {
      return
    }
    return isSubdir(p, path)
  })
}

// Check whether path2 is a subdirectory of path1
// Return true when path1 equals path2
// Ref: https://stackoverflow.com/a/45242825
function isSubdir(path1, path2) {
  const rel = path.relative(path.normalize(path1), path.normalize(path2))
  return !(rel === '..' || rel.startsWith('..' + path.sep))
}
