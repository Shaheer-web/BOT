const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_LEVEL,
  MAX_LEVEL_XP,
  XP_PER_MESSAGE,
  getApplicationStep,
  levelForXp,
  matchesWholePhrase,
  xpForMessages,
  xpForNextLevel
} = require('../src/utils');

test('auto-reply and moderation phrase matching ignores case and respects word boundaries', () => {
  assert.equal(matchesWholePhrase('Can someone HELP me?', 'help'), true);
  assert.equal(matchesWholePhrase('helpful advice', 'help'), false);
  assert.equal(matchesWholePhrase('Need STAFF help now', 'staff help'), true);
});

test('level thresholds get progressively farther apart and stop at level 100', () => {
  assert.equal(levelForXp(0), 0);
  assert.equal(levelForXp(99), 0);
  assert.equal(levelForXp(100), 1);
  assert.equal(levelForXp(400), 2);
  assert.equal(xpForNextLevel(2), 900);
  assert.ok(xpForNextLevel(9) - 8100 > xpForNextLevel(1) - 100);
  assert.equal(MAX_LEVEL, 100);
  assert.equal(MAX_LEVEL_XP, 1_000_000);
  assert.equal(levelForXp(MAX_LEVEL_XP - 1), 99);
  assert.equal(levelForXp(MAX_LEVEL_XP), MAX_LEVEL);
  assert.equal(levelForXp(MAX_LEVEL_XP * 100), MAX_LEVEL);
  assert.equal(xpForNextLevel(MAX_LEVEL), MAX_LEVEL_XP);
});

test('message XP is fixed and grows directly with valid message count', () => {
  assert.equal(XP_PER_MESSAGE, 10);
  assert.equal(xpForMessages(1), 10);
  assert.equal(xpForMessages(25), 250);
  assert.equal(xpForMessages(100), 1000);
  assert.equal(xpForMessages(-3), 0);
  assert.equal(xpForMessages(Number.NaN), 0);
});

test('staff application advances questions and reaches completion after the final answer', () => {
  const questions = ['Why do you want to join?', 'What experience do you have?'];

  assert.deepEqual(getApplicationStep(questions, 0), {
    index: 0,
    nextIndex: 1,
    question: questions[0]
  });
  assert.deepEqual(getApplicationStep(questions, 1), {
    index: 1,
    nextIndex: 2,
    question: questions[1]
  });
  assert.equal(getApplicationStep(questions, 2), null);
  assert.equal(getApplicationStep([], 0), null);
});
