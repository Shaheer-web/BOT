require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

async function main() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    throw new Error('DISCORD_TOKEN and CLIENT_ID must be set before deploying slash commands.');
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands${GUILD_ID ? ` in guild ${GUILD_ID}` : ' globally'}.`);
}

main().catch(error => {
  console.error('Failed to register slash commands:', error);
  process.exitCode = 1;
});
