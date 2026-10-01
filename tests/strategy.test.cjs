const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../.test-build');
const original = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return original.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
const { createEmptyBoard, positionToKey } = require('../.test-build/lib/game.js');
const { analyzeMoves, strategicChoices } = require('../.test-build/lib/strategy.js');
function boardWith(x, o = []) {
  const board = createEmptyBoard();
  for (const [row, col] of x) board[row][col] = 'X';
  for (const [row, col] of o) board[row][col] = 'O';
  return board;
}
function best(board) { return analyzeMoves(board, 5000, 3)[0].move; }
test('takes a win instead of defending', () => {
  const board = boardWith([[3,3],[3,4],[3,5],[3,6]], [[7,4],[7,5],[7,6],[7,7]]);
  assert.ok(['D8','I8'].includes(positionToKey(best(board))));
});
test('blocks a broken four', () => {
  const board = boardWith([[7,3],[7,4],[7,6],[7,7]], [[7,2]]);
  assert.equal(positionToKey(best(board)), 'F8');
});
test('blocks an open three before it becomes an unstoppable four', () => {
  const board = boardWith([[7,6],[7,7],[7,8]], [[5,5],[9,9]]);
  assert.ok(['F8','J8'].includes(positionToKey(best(board))));
});
test('prevents a crossing double threat', () => {
  const board = boardWith([[7,6],[7,8],[6,7],[8,7]], [[3,3],[11,11],[3,11]]);
  assert.equal(positionToKey(best(board)), 'H8');
});
test('creates a forcing open four', () => {
  const board = boardWith([[2,2],[2,3]], [[7,6],[7,7],[7,8]]);
  assert.ok(['F8','J8'].includes(positionToKey(best(board))));
});
test('handles diagonal edge threats', () => {
  const board = boardWith([[0,0],[1,1],[2,2],[3,3]]);
  assert.equal(positionToKey(best(board)), 'E5');
});
test('search preserves input and restricts Jev to highest evaluated moves', () => {
  const board = boardWith([[7,7]], [[7,8]]);
  const before = JSON.stringify(board);
  const analysis = analyzeMoves(board, 500, 3);
  assert.equal(JSON.stringify(board), before);
  assert.ok(analysis[0].depth >= 1);
  assert.ok(strategicChoices(analysis).every(item => item.score === analysis[0].score));
});
test('empty, full and expired-budget searches remain legal', () => {
  assert.equal(positionToKey(best(createEmptyBoard())), 'H8');
  assert.deepEqual(analyzeMoves(Array.from({length:15}, () => Array(15).fill('X'))), []);
  const board = boardWith([[7,7]]);
  const result = analyzeMoves(board, 0);
  assert.equal(board[result[0].move.row][result[0].move.col], null);
});
