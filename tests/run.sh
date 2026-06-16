#!/bin/bash
# Run the core test suite in Node (no dependencies needed).
set -e
cd "$(dirname "$0")/.."
cat js/math2d.js js/model.js js/autorig.js tests/smoke.js > /tmp/marionette-test.js
node /tmp/marionette-test.js

cat js/math2d.js js/model.js js/autorig.js js/mirror.js tests/mirror.js > /tmp/marionette-mirror-test.js
node /tmp/marionette-mirror-test.js
