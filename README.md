<table><thead>
  <tr>
    <th>Linux</th>
    <th>OS X</th>
    <th>Windows</th>
    <th>Coverage</th>
  </tr>
</thead><tbody><tr>
  <td colspan="2" align="center">
    <a href="https://circleci.com/gh/zeit/dockerignore">
    <img
      src="https://circleci.com/gh/zeit/dockerignore.svg?style=svg"
      alt="Build Status" /></a>
  </td>
  <td align="center">
    <a href="https://ci.appveyor.com/project/zeit/dockerignore">
    <img
      src="https://ci.appveyor.com/api/projects/status/github/zeit/dockerignore?branch=master&svg=true"
      alt="Windows Build Status" /></a>
  </td>
  <td align="center">
    <a href="https://codecov.io/gh/zeit/dockerignore">
    <img
      src="https://codecov.io/gh/zeit/dockerignore/branch/master/graph/badge.svg"
      alt="Coverage Status" /></a>
  </td>
</tr></tbody></table>

# dockerignore

`dockerignore` is a manager, filter and parser which is implemented in pure JavaScript according to the .dockerignore [spec](https://docs.docker.com/engine/reference/builder/#dockerignore-file) and is used in production in [now-cli](https://github.com/zeit/now-cli/)

The `.dockerignore` spec has a few subtle differences from `.gitignore`. IF you'd like a great `.gitignore` file parser, check out [ignore](https://github.com/kaelzhang/node-ignore). This package is a fork of `ignore` and follows the exact same API.

#### What's different from `ignore`?
- There are many direct differences between the `.gitignore` and `.dockerignore` specifications
  - `*` in `.gitignore` matches everything, wheras in `.dockerignore` it only matches things in the current directory (like glob). This difference is important when whitelisting after a `*` rule
  - `abc` in `.gitignore` matches all `abc` files and directories, however deeply nested, however `.dockerignore` specifically matches on `./abc` but does not match nested files/directories like `./somedir/abc`
  - With `.gitignore`, when a parent directory is ignored, subdirectories cannot be re-added (using `!`) since `git` simply avoids walking through the subtree as an optimization, wheras with `.dockerignore` a subdirectory can be re-added even if a parent directory has been ignored
  - For a complete list of differences, check out the [.gitignore spec](https://git-scm.com/docs/gitignore) and the [.dockerignore spec](https://docs.docker.com/engine/reference/builder/#dockerignore-file)
- Under the hood, we rewrote the entire matching logic to be much simpler
  - instead of complex Regex rule to replace patterns with regex, we scan through patterns
  - this is also modeled directly from [docker's implementation](https://github.com/docker/docker-ce/blob/7d44629ea2c739e7803acc77b84ee8dd2a8c4746/components/engine/pkg/fileutils/fileutils.go)

#### What's the same as `ignore`?
- The entire API (In fact we even reuse the same `index.d.ts` file for TypeScript definitions)

##### Tested on

- Linux + Node: `9.0` (but we use `babel` and it *should* work on older version of Node. Accepting PRs if that isn't the case)
- Windows + Node testing *coming soon*

## Install

```bash
yarn add @zeit/dockerignore // or npm install --save @zeit/dockerignore
```


## Usage

```js
const ignore = require('@zeit/dockerignore')
const ig = ignore().add(['.abc/*', '!.abc/d/'])
```

### Filter the given paths

```js
const paths = [
  '.abc/a.js',    // filtered out
  '.abc/d/e.js'   // included
]

ig.filter(paths)        // ['.abc/d/e.js']
ig.ignores('.abc/a.js') // true
```

### As the filter function

```js
paths.filter(ig.createFilter()); // ['.abc/d/e.js']
```

### Win32 paths will be handled

```js
ig.filter(['.abc\\a.js', '.abc\\d\\e.js'])
// if the code above runs on windows, the result will be
// ['.abc\\d\\e.js']
```

## Features

- Exactly according to the [dockerignore spec](https://docs.docker.com/engine/reference/builder/#dockerignore-file) 
- All test cases are verified on Circle CI by doing an an actual `docker build` with the test case files and `.dockerignore` rules to ensure our tests match what happens with the real [docker](https://www.docker.com/) CLI
- 0 external dependencies which keeps this package very small!

## dockerignore vs ignore

Read our [blog post](https://zeit.co/blog) about the differences between `dockerignore` and `ignore` and why we built this package.

## Methods

### .add(pattern)
### .add(patterns)

- **pattern** `String|Ignore` An ignore pattern string, or the `Ignore` instance
- **patterns** `Array.<pattern>` Array of ignore patterns.

Adds a rule or several rules to the current manager.

Returns `this`

Notice that a line starting with `'#'`(hash) is treated as a comment. Put a backslash (`'\'`) in front of the first hash for patterns that begin with a hash, if you want to ignore a file with a hash at the beginning of the filename.

```js
ignore().add('#abc').ignores('#abc')    // false
ignore().add('\#abc').ignores('#abc')   // true
```

`pattern` could either be a line of ignore pattern or a string of multiple ignore patterns, which means we could just `ignore().add()` the content of a ignore file:

```js
ignore()
.add(fs.readFileSync(filenameOfGitignore).toString())
.filter(filenames)
```

`pattern` could also be an `ignore` instance, so that we could easily inherit the rules of another `Ignore` instance.

### .ignores(pathname)

Returns `Boolean` whether `pathname` should be ignored.

```js
ig.ignores('.abc/a.js')    // true
```

### .filter(paths)

Filters the given array of pathnames, and returns the filtered array.

- **paths** `Array.<path>` The array of `pathname`s to be filtered.

### .createFilter()

Creates a filter function which could filter an array of paths with `Array.prototype.filter`.

Returns `function(path)` the filter function.

## Contributing

Contributions are always welcome and we are fully [commited to Open Source](https://zeit.co/blog/oss).

1. Fork this repository to your own GitHub account and then clone it to your local device.
2. Install the dependencies: `yarn` or `npm install`
3. Add a test case (if applicable) and ensure it currently fails
4. Add code to pass the test
5. Make a pull request (additional tests will run on CI to ensure that your test case agrees with an actual `docker build`)

## Authors
  - Pranay Prakash ([@pranaygp](https://twitter.com/pranaygp)) – [ZEIT](https://zeit.co)
  
  Most of the initial work on this project was done by Kael Zhang ([@kaelzhang](https://github.com/kaelzhang)) and the [collaborators](https://github.com/kaelzhang/node-ignore#collaborators) on [node-ignore](https://github.com/kaelzhang/node-ignore)
