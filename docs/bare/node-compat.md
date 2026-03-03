# Bare / Node Compatibility Notes

Purpose: freeze verified Node-to-Bare module mapping knowledge in-repo for this codebase.

Pear apps run on Bare. Node builtins are bridged through `bare-*` packages and package import maps.

References (frozen pointers):
- https://docs.pears.com/bare-reference/nodejs-compatibility-with-bare
- https://docs.pears.com/how-tos/use-nodejs-modules

## Import-map Pattern

In package `package.json`:

```json
{
  "imports": {
    "path": {
      "bare": "bare-path",
      "default": "path"
    },
    "node:path": {
      "bare": "bare-path",
      "default": "node:path"
    }
  }
}
```

For files that use these conditionally-mapped specifiers, include:

```js
// with { imports: './package.json' }
```

This pragma tells Bare's module loader to resolve through the package import map.

## Deviant Mappings (explicit)

- `http` -> `bare-http1`
- `child_process` -> `bare-subprocess`

## Verified Mappings Used Initially

- `path` -> `bare-path`
- `fs` -> `bare-fs`
- `process` -> `bare-process`
