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
test('search preserves input and offers distinct non-losing moves to Jev', () => {
  const board = boardWith([[7,7]], [[7,8]]);
  const before = JSON.stringify(board);
  const analysis = analyzeMoves(board, 500, 3);
  assert.equal(JSON.stringify(board), before);
  assert.ok(analysis[0].depth >= 1);
  assert.ok(strategicChoices(analysis).every(item => item.proven !== 'loss'));
});

test('second screenshot: defends the diagonal before the open four and recognizes it afterwards', () => {
  const x = ['J4','I5','J5','D6','H6','I6','G7','H7','I7','I11'];
  const o = ['K3','G5','E6','E7','K7','F8','H8','I8','G9'];
  const before = keyedBoard(x, o);
  for (const budget of [0, 700]) {
    const choices = strategicChoices(analyzeMoves(before, budget, 5));
    assert.ok(choices.length);
    assert.ok(choices.every(item => ['K4','G8'].includes(positionToKey(item.move))), choices.map(item => positionToKey(item.move)).join(','));
  }
  const lost = keyedBoard([...x, 'G8'], [...o, 'H10']);
  const result = analyzeMoves(lost, 500, 4);
  assert.equal(result[0].proven, 'loss');
  assert.ok(['K4','F9'].includes(positionToKey(result[0].move)));
});

test('winning moves and defenses remain correct under all eight board symmetries', () => {
  const fixture = keyedBoard(['A1','B2','C3','D4'], ['H8']);
  for (let flip = 0; flip < 2; flip++) for (let rotation = 0; rotation < 4; rotation++) {
    const transform = ({row, col}) => {
      if (flip) col = 14-col;
      for (let i = 0; i < rotation; i++) [row,col] = [col,14-row];
      return {row,col};
    };
    const board = createEmptyBoard();
    fixture.forEach((row,r) => row.forEach((cell,c) => { const p = transform({row:r,col:c}); board[p.row][p.col] = cell; }));
    assert.deepEqual(analyzeMoves(board, 100, 2)[0].move, transform({row:4,col:4}));
  }
});

test('search continuations stay legal and alternate players', () => {
  const board = keyedBoard(['H8','I9','I7'], ['I8','H9']);
  const analysis = analyzeMoves(board, 300, 3);
  assert.ok(analysis[0].nodes > 0);
  for (const item of analysis) {
    const replay = board.map(row => [...row]);
    for (let i = 0; i < item.line.length; i++) {
      const move = item.line[i];
      assert.equal(replay[move.row][move.col], null);
      replay[move.row][move.col] = i % 2 ? 'X' : 'O';
    }
  }
});

test('Jev can choose close alternatives but cannot override a searched win or choose a losing move', () => {
  const { selectVerifiedMove } = require('../.test-build/lib/decision.js');
  const item = (key, score, proven = null) => ({move:keyToPosition(key), score, proven, depth:3});
  const analysis = [item('G8',100), item('H8',0), item('I8',-9999999,'loss')];
  assert.equal(strategicChoices(analysis).length, 2);
  const jev = {assessments:[{key:'G8',preference:.1},{key:'H8',preference:.9},{key:'I8',preference:1}]};
  assert.equal(positionToKey(selectVerifiedMove(analysis,jev).move), 'H8');
  assert.equal(positionToKey(selectVerifiedMove([item('G8',9999997,'win'), ...analysis.slice(1)],jev).move), 'G8');
});

test('request gives Jev explicit boards, history, attack scores and separate risk questions', () => {
  const { buildJevRequest, parseJevResponse } = require('../.test-build/lib/jev.js');
  const board = keyedBoard(['H8']);
  const analysis = strategicChoices(analyzeMoves(board, 50, 2), 4);
  const request = buildJevRequest(board, analysis, [{player:'X',move:keyToPosition('H8')}]);
  assert.equal(Object.keys(request.questions).length, 2 + analysis.length*2);
  assert.deepEqual(request.state.move_history, ['X:H8']);
  for (const candidate of analysis) {
    const key = positionToKey(candidate.move);
    assert.equal(request.questions[`quality_${key}`].type, 'score');
    assert.equal(request.questions[`risk_${key}`].type, 'noul');
    assert.equal(request.state.candidates[key].rowsAfterMove[candidate.move.row][candidate.move.col], 'O');
  }
  const keys = analysis.map(item => positionToKey(item.move));
  const response = mockJevResponse(keys);
  const parsed = parseJevResponse(response, board, analysis.map(item => item.move), Object.keys(request.questions).length);
  assert.equal(parsed.assessments.length, analysis.length);
  assert.equal(parsed.key, keys[0]);
  for (const mutation of [
    value => value.answers.best_move.choice = 'H8',
    value => value.answers.best_move.probabilities[keys[0]] = -1,
    value => value.answers.best_move.confidence = 2,
    value => delete value.answers[`risk_${keys[0]}`],
    value => value.answers[`quality_${keys[0]}`].score = 99,
    value => value.answers.best_move.probabilities['Z99'] = 1,
  ]) {
    const invalid = structuredClone(response);
    mutation(invalid);
    assert.throws(() => parseJevResponse(invalid, board, analysis.map(item => item.move), 10));
  }
});

function mockJevResponse(keys) {
  return {model:'jev-test', usage:{input_tokens:123,output_tokens:45}, answers:{
    best_move:{type:'choice',choice:keys[0],confidence:.8, probabilities:Object.fromEntries(keys.map((key,i) => [key,i===0?1:0]))},
    plan:{type:'choice',choice:'develop'},
    ...Object.fromEntries(keys.flatMap(key => [[`quality_${key}`,{type:'score',score:2,confidence:.8}], [`risk_${key}`,{type:'noul',noul:.1}]])),
  }};
}

test('complete API pipeline screens tactics then uses Jev assessments; provider failure falls back safely', async () => {
  const { POST } = require('../.test-build/app/api/move/route.js');
  const oldFetch = global.fetch;
  const oldKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'test-key';
  let calls = 0;
  const board = keyedBoard(['H8']);
  const request = () => new Request('http://localhost/api/move', {method:'POST',body:JSON.stringify({board})});
  try {
    global.fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      const body = JSON.parse(init.body);
      return Response.json(mockJevResponse(Object.keys(body.questions.best_move.criteria)));
    };
    const response = await POST(request());
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.ok(['jev','verified'].includes(data.source));
    assert.ok(data.jev.questions >= 4);
    assert.equal(board[data.move.row][data.move.col], null);
    assert.ok(data.candidates.some(item => item.key === data.key));
    assert.ok(data.searchDepth >= 1);
    global.fetch = async () => new Response('sensitive upstream body', {status:503});
    const fallback = await (await POST(request())).json();
    assert.equal(fallback.source, 'fallback');
    assert.equal(board[fallback.move.row][fallback.move.col], null);
    assert.ok(!JSON.stringify(fallback).includes('sensitive upstream body'));
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = oldKey;
  }
});

test('API rejects invalid turns, ended games, JSON and mismatched history', async () => {
  const { POST } = require('../.test-build/app/api/move/route.js');
  const send = payload => POST(new Request('http://localhost/api/move', {method:'POST',body:JSON.stringify(payload)}));
  assert.equal((await send({board:createEmptyBoard()})).status, 409);
  assert.equal((await send({board:keyedBoard(['A1','B1','C1','D1','E1'],['A2','C2','E2','G2'])})).status, 409);
  assert.equal((await send({board:keyedBoard(['H8']),history:[]})).status, 400);
  assert.equal((await POST(new Request('http://localhost/api/move',{method:'POST',body:'{' }))).status,400);
});

test('reset and undo invalidate late AI replies; errors do not give X an extra turn', () => {
  const { emptySession, sessionReducer: reduce } = require('../.test-build/lib/session.js');
  let state = reduce(emptySession(), {type:'human',move:keyToPosition('H8')});
  const id = state.requestId;
  const decision = {move:keyToPosition('I8'),key:'I8',source:'jev'};
  assert.equal(state.status,'thinking');
  assert.equal(reduce(state,{type:'human',move:keyToPosition('J8')}), state);
  const reset = reduce(state,{type:'reset'});
  assert.equal(reduce(reset,{type:'resolved',id,decision}), reset);
  const undo = reduce(state,{type:'undo'});
  assert.equal(reduce(undo,{type:'resolved',id,decision}),undo);
  state = reduce(state,{type:'failed',id,error:'offline'});
  assert.equal(state.status,'error');
  assert.equal(reduce(state,{type:'human',move:keyToPosition('J8')}),state);
  state = reduce(state,{type:'retry'});
  state = reduce(state,{type:'resolved',id:state.requestId,decision});
  assert.equal(state.moves.length,2);
  assert.equal(state.status,'human');
  assert.equal(reduce(state,{type:'undo'}).moves.length,0);
});

test('saved histories reject illegal moves and resume pending turns safely', () => {
  const { replayMoves, getWinningLine } = require('../.test-build/lib/game.js');
  const { emptySession, sessionReducer: reduce } = require('../.test-build/lib/session.js');
  const moves = [{player:'X',move:keyToPosition('H8')}];
  assert.equal(reduce(emptySession(),{type:'restore',moves}).status,'error');
  assert.equal(replayMoves([...moves,{player:'O',move:keyToPosition('H8')}]),null);
  assert.equal(replayMoves([{player:'O',move:keyToPosition('H8')}]),null);
  assert.equal(getWinningLine(keyedBoard(['A1','B1','C1','D1','E1','F1'])).length,6);
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
  const board = keyedBoard(['C3','D3','E3','F3','A1'], ['F8','G8','H8','I8']);
  const response = await POST(new Request('http://localhost/api/move', {
    method: 'POST', body: JSON.stringify({ board }),
  }));
  assert.equal((await response.json()).source, 'tactical-win');
  const invalid = await POST(new Request('http://localhost/api/move', {
    method: 'POST', body: JSON.stringify({ board: [] }),
  }));
  assert.equal(invalid.status, 400);
});


test('Jev receives attacking and defensive alternatives beyond a narrow engine score band', () => {
  const item = (key, score, attack, defense, proven = null) => ({move:keyToPosition(key), score, attack, defense, proven});
  const choices = strategicChoices([item('A1',10000,10,10), item('B1',100,0,900), item('C1',0,900,0), item('D1',-9999999,9999,9999,'loss')], 3);
  assert.deepEqual(new Set(choices.map(x => positionToKey(x.move))), new Set(['A1','B1','C1']));
});
