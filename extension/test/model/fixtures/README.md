# Test fixtures for the local model engine (R0)

- `fake-engine.mjs` — in-process stand-in for the R4 `LlamaEngine`/`LocalBackend`
  engine surface. Behavior is controlled with `FAKE_ENGINE_MODE`
  (`ok|delay|abort|empty|truncate|throw|oom`) and every generate request is
  recorded for assertions. Native binaries and model weights are never loaded
  in the default test suite.
