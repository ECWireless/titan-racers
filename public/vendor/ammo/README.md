# Ammo.js Vendor Assets

These files are the Ammo.js bundle shipped with the PlayCanvas Engine `v2.20.6`
examples:

<https://github.com/playcanvas/engine/tree/v2.20.6/examples/assets/wasm/ammo>

They are vendored so Titan Racers does not require a runtime CDN and so the
physics build remains aligned with the pinned PlayCanvas integration.

Ammo.js is a JavaScript/WebAssembly port of Bullet Physics and is distributed
under the zlib license. The generated JavaScript files retain the upstream
license notice. See the upstream project for the complete license:

<https://github.com/kripken/ammo.js/blob/main/LICENSE>

## SHA-256

```text
ef166d1315bc4a6441a8de341ecdf6ac4e7d69055caec65c523ed1a4e8e19b15  ammo.js
5645b5a0c4f03be9d9d1ae604ffacd5e5e525310cfd1d0ed27474cdd1f34aab0  ammo.wasm.js
a61b504d4a6ce6bb93bd843e0f61edb8115e7317f1b3462247031a83ddb25d09  ammo.wasm.wasm
```

Treat any replacement as a physics-tool upgrade: record its provenance and
hashes, then repeat the runtime, rigid-body, support-query, build, and browser
verification described in `skills/tools/playcanvas-ammo/README.md`.
