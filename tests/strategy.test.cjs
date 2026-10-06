const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../.test-build');
const original = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return original.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
const { createEmptyBoard, positionToKey, keyToPosition, findImmediateMove } = require('../.test-build/lib/game.js');
const { analyzeMoves, strategicChoices } = require('../.test-build/lib/strategy.js');
function boardWith(x, o = []) {
  const board = createEmptyBoard();
  for (const [row, col] of x) board[row][col] = 'X';
  for (const [row, col] of o) board[row][col] = 'O';
  return board;
}
function best(board) { return analyzeMoves(board, 5000, 3)[0].move; }
function keyedBoard(x, o = []) {
  return boardWith(x.map(key => { const p = keyToPosition(key); return [p.row, p.col]; }),
    o.map(key => { const p = keyToPosition(key); return [p.row, p.col]; }));
}
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

test('prevents the screenshot diagonal fork even with no search time', () => {
  const board = keyedBoard(['C4','H5','I6','G7','H7','I7','J7','I8','H9'],
    ['D5','I5','E6','G6','F7','K7','G8','H8','G10']);
  const before = JSON.stringify(board);
  for (const budget of [0, 1500]) {
    const choices = strategicChoices(analyzeMoves(board, budget));
    assert.ok(choices.length);
    for (const { move } of choices) {
      assert.ok(['G4','K8'].includes(positionToKey(move)), positionToKey(move));
    }
  }
  assert.equal(JSON.stringify(board), before);
});

test('recognizes the screenshot open four as already lost rather than safe', () => {
  const board = keyedBoard(['C4','H5','I6','G7','H7','I7','J7','I8','H9','K8'],
    ['D5','I5','E6','G6','F7','K7','G8','H8','G10']);
  const result = analyzeMoves(board, 1500, 2);
  assert.ok(result[0].score < -9_000_000);
  board[result[0].move.row][result[0].move.col] = 'O';
  assert.ok(findImmediateMove(board, 'X'));
});

test('blocks both straight and broken fork creation before the timed search', () => {
  for (const stones of [['F8','G8','H8'], ['F8','G8','I8']]) {
    const board = keyedBoard(stones, ['C3','K12']);
    const choices = analyzeMoves(board, 0);
    for (const { move } of strategicChoices(choices)) {
      board[move.row][move.col] = 'O';
      // No remaining X move may create two different immediate winning cells.
      for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
        if (board[row][col] !== null) continue;
        board[row][col] = 'X';
        const first = findImmediateMove(board, 'X');
        if (first) {
          board[first.row][first.col] = 'O';
          assert.equal(findImmediateMove(board, 'X'), null, `${stones}: ${positionToKey(move)}`);
          board[first.row][first.col] = null;
        }
        board[row][col] = null;
      }
      board[move.row][move.col] = null;
    }
  }
});

test('API reports a forced loss for the screenshot instead of claiming a safe block', async () => {
  const { POST } = require('../.test-build/app/api/move/route.js');
  const board = keyedBoard(['C4','H5','I6','G7','H7','I7','J7','I8','H9','K8'],
    ['D5','I5','E6','G6','F7','K7','G8','H8','G10']);
  const response = await POST(new Request('http://localhost/api/move', {
    method: 'POST', body: JSON.stringify({ board }),
  }));
  assert.equal(response.status, 200);
  const decision = await response.json();
  assert.equal(decision.source, 'tactical-block');
  assert.match(decision.reason, /thắng bắt buộc/);
  assert.ok(['G4','L9'].includes(decision.key));
});

test('blocks a crossing double four even with an expired search budget', () => {
  const board = keyedBoard(['F8','G8','I8','H6','H7','H9'], ['C3','K12']);
  const choices = strategicChoices(analyzeMoves(board, 0));
  assert.deepEqual(choices.map(item => positionToKey(item.move)), ['H8']);
});

test('API takes an immediate win and rejects malformed boards', async () => {
  const { POST } = require('../.test-build/app/api/move/route.js');
  const board = keyedBoard(['C3','D3','E3','F3'], ['F8','G8','H8','I8']);
  const response = await POST(new Request('http://localhost/api/move', {
    method: 'POST', body: JSON.stringify({ board }),
  }));
  assert.equal((await response.json()).source, 'tactical-win');
  const invalid = await POST(new Request('http://localhost/api/move', {
    method: 'POST', body: JSON.stringify({ board: [] }),
  }));
  assert.equal(invalid.status, 400);
});
