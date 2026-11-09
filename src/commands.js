const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot and its database are responding.'),
  new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Refresh slash commands for this server (server owner only).'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a server member profile and level.')
    .addUserOption(option => option.setName('member').setDescription('Member to view')),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the server XP leaderboard.'),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create a ticket panel or configure tickets.')
    .addSubcommand(sub => sub.setName('panel').setDescription('Post a clickable ticket panel.')
      .addChannelOption(option => option.setName('channel').setDescription('Channel for the panel').setRequired(true)))
    .addSubcommand(sub => sub.setName('settings').setDescription('Set ticket category and staff role.')
      .addChannelOption(option => option.setName('category').setDescription('Category for new tickets'))
      .addRoleOption(option => option.setName('staff_role').setDescription('Role that can view tickets'))),
  new SlashCommandBuilder()
    .setName('application')
    .setDescription('Configure the staff application panel and questions.')
    .addSubcommand(sub => sub.setName('setup').setDescription('Post an application panel with sequential questions.')
      .addChannelOption(option => option.setName('channel').setDescription('Channel for the application panel').setRequired(true))
      .addStringOption(option => option.setName('questions').setDescription('One question per line').setRequired(true).setMaxLength(4000))),
  new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('Grant or remove a role for a management command.')
    .addSubcommand(sub => sub.setName('grant').setDescription('Authorize a role for a command.')
      .addStringOption(option => option.setName('command').setDescription('Command to grant').setRequired(true)
        .addChoices(
          { name: 'ticket', value: 'ticket' },
          { name: 'application', value: 'application' },
          { name: 'automod', value: 'automod' },
          { name: 'welcome', value: 'welcome' },
          { name: 'leave', value: 'leave' },
          { name: 'autoreply', value: 'autoreply' },
          { name: 'permissions', value: 'permissions' }
        ))
      .addRoleOption(option => option.setName('role').setDescription('Role to authorize').setRequired(true)))
    .addSubcommand(sub => sub.setName('revoke').setDescription('Remove a role authorization.')
      .addStringOption(option => option.setName('command').setDescription('Command to revoke').setRequired(true)
        .addChoices(
          { name: 'ticket', value: 'ticket' },
          { name: 'application', value: 'application' },
          { name: 'automod', value: 'automod' },
          { name: 'welcome', value: 'welcome' },
          { name: 'leave', value: 'leave' },
          { name: 'autoreply', value: 'autoreply' },
          { name: 'permissions', value: 'permissions' }
        ))
      .addRoleOption(option => option.setName('role').setDescription('Role to remove').setRequired(true))),
  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure abuse detection and its word filter.')
    .addSubcommand(sub => sub.setName('add-word').setDescription('Add a word or phrase to the filter.')
      .addStringOption(option => option.setName('term').setDescription('Case-insensitive term').setRequired(true).setMaxLength(100)))
    .addSubcommand(sub => sub.setName('remove-word').setDescription('Remove a word or phrase from the filter.')
      .addStringOption(option => option.setName('term').setDescription('Term to remove').setRequired(true).setMaxLength(100)))
    .addSubcommand(sub => sub.setName('status').setDescription('Show the configured filter terms.')),
  ...['welcome', 'leave'].map(name =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`Configure ${name} messages.`)
      .addSubcommand(sub => sub.setName('setup').setDescription(`Set the ${name} channel, message, and optional extra line.`)
        .addChannelOption(option => option.setName('channel').setDescription('Text channel').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('Optional custom message; leave blank to use the professional default').setMaxLength(1000))
        .addStringOption(option => option.setName('banner_text').setDescription('Optional extra line shown in the welcome or leave message').setMaxLength(64)))
  ),
  new SlashCommandBuilder()
    .setName('autoreply')
    .setDescription('Configure automatic keyword replies.')
    .addSubcommand(sub => sub.setName('add').setDescription('Add or update a case-insensitive keyword reply.')
      .addStringOption(option => option.setName('keyword').setDescription('Whole word or phrase').setRequired(true).setMaxLength(80))
      .addStringOption(option => option.setName('response').setDescription('Bot response').setRequired(true).setMaxLength(1500)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove an automatic reply.')
      .addStringOption(option => option.setName('keyword').setDescription('Keyword to remove').setRequired(true).setMaxLength(80))),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show useful information about this server.'),
  new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Get a direct message with this bot’s commands.'),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear this channel (owner only; confirms first and notifies players).')
];

module.exports = commands.map(command => command.toJSON());
