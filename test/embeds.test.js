const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextEmbed } = require('../src/embeds');

test('member-specific text embeds include the member avatar and preserve Unicode text', () => {
  const member = {
    user: {
      displayAvatarURL: options => `https://cdn.example/avatar.png?size=${options.size}`
    }
  };
  const embed = createTextEmbed('Player profile', 'Display name: 玩家 ✨', member).toJSON();

  assert.equal(embed.description, 'Display name: 玩家 ✨');
  assert.equal(embed.thumbnail.url, 'https://cdn.example/avatar.png?size=256');
});

test('public text embeds omit a player avatar', () => {
  const embed = createTextEmbed('Public ticket panel', 'Choose a support category.', null).toJSON();

  assert.equal(embed.description, 'Choose a support category.');
  assert.equal(embed.thumbnail, undefined);
});

test('user-specific DMs can use a Discord User directly for the avatar', () => {
  const user = {
    displayAvatarURL: options => `https://cdn.example/dm-avatar.png?size=${options.size}`
  };
  const embed = createTextEmbed('Command guide', 'Available commands.', user).toJSON();

  assert.equal(embed.thumbnail.url, 'https://cdn.example/dm-avatar.png?size=256');
});

test('embed text stays within Discord title and description limits', () => {
  const embed = createTextEmbed('T'.repeat(300), 'D'.repeat(5000), null).toJSON();

  assert.equal(embed.title.length, 256);
  assert.equal(embed.description.length, 4000);
});
