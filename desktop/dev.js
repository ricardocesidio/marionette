/* Dev launcher: spawns Electron with a clean environment.
 * Terminals spawned by VS Code/Electron apps export ELECTRON_RUN_AS_NODE=1,
 * which makes `electron .` run as plain Node and crash — strip it here. */
const { spawn } = require('child_process');
const electron = require('electron'); // path to the binary when required from Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
