const MAX_LEVEL = 100;
const MAX_LEVEL_XP = MAX_LEVEL ** 2 * 100;
const XP_PER_MESSAGE = 10;

function xpForMessages(messageCount) {
  const count = Number.isFinite(Number(messageCount))
    ? Math.max(0, Math.floor(Number(messageCount)))
    : 0;
  return count * XP_PER_MESSAGE;
}

function normalizeText(value) {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWholePhrase(text, phrase) {
  const escaped = escapeRegExp(normalizeText(phrase)).replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u')
    .test(normalizeText(text));
}

function levelForXp(xp) {
  const safeXp = Number.isFinite(Number(xp)) ? Math.max(0, Number(xp)) : 0;
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(safeXp / 100)));
}

function xpForNextLevel(level) {
  const safeLevel = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
  return Math.min(MAX_LEVEL, safeLevel + 1) ** 2 * 100;
}

function getApplicationStep(questions, questionIndex) {
  const index = Number.isFinite(Number(questionIndex))
    ? Math.max(0, Math.floor(Number(questionIndex)))
    : 0;
  if (index >= questions.length) return null;
  return {
    index,
    nextIndex: index + 1,
    question: questions[index]
  };
}

function applyTemplate(template, member, guild) {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name);
}

module.exports = {
  normalizeText,
  matchesWholePhrase,
  MAX_LEVEL,
  MAX_LEVEL_XP,
  XP_PER_MESSAGE,
  xpForMessages,
  levelForXp,
  xpForNextLevel,
  getApplicationStep,
  applyTemplate
};
