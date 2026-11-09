require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require('discord.js');
const { pool, initializeDatabase, getGuildSettings, updateGuildSettings } = require('./db');
const { createTextEmbed } = require('./embeds');
const {
  applyTemplate,
  getApplicationStep,
  levelForXp,
  matchesWholePhrase,
  xpForMessages,
  xpForNextLevel
} = require('./utils');
const {
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_LEAVE_MESSAGE
} = require('./defaults');
const commandSchemas = require('./commands');

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required.`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const spamHistory = new Map();

async function hasCommandAccess(interaction, commandName) {
  if (interaction.user.id === interaction.guild?.ownerId) return true;
  const { rows } = await pool.query(
    'SELECT role_id FROM command_roles WHERE guild_id = $1 AND command_name = $2',
    [interaction.guildId, commandName]
  );
  return rows.some(({ role_id: roleId }) => interaction.member.roles.cache.has(roleId));
}

async function requireCommandAccess(interaction, commandName) {
  if (await hasCommandAccess(interaction, commandName)) return true;
  await replyWithEmbed(interaction, 'Access denied', 'You are not authorized to use this management command.', { ephemeral: true });
  return false;
}

async function replyWithEmbed(interaction, title, description, options = {}) {
  const payload = {
    embeds: [createTextEmbed(
      title,
      description,
      options.member === undefined ? interaction.member : options.member,
      options.color
    )],
    ...(options.ephemeral === undefined ? {} : { ephemeral: options.ephemeral }),
    ...(options.components ? { components: options.components } : {})
  };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function hasTicketStaffAccess(interaction) {
  if (await hasCommandAccess(interaction, 'ticket')) return true;
  const settings = await getGuildSettings(interaction.guildId);
  return Boolean(settings.ticket_staff_role_id &&
    interaction.member?.roles?.cache?.has(settings.ticket_staff_role_id));
}

async function postTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x7564d8)
    .setAuthor({ name: 'Sapphire Community • Support Centre', iconURL: client.user.displayAvatarURL() })
    .setTitle('How can we help you today?')
    .setDescription([
      'Our team is here to help. Select the option that best matches your request and a private ticket will be created.',
      '',
      '🎓 **Staff Application** — Apply to join our team',
      '🚩 **Player Report** — Report a player or rule violation',
      '💬 **General Support** — Get help with anything else',
      '🪲 **Bug Report** — Tell us about a technical issue'
    ].join('\n'))
    .addFields({
      name: 'Before you open a ticket',
      value: 'Please choose the right category and share clear, accurate details. Our team will respond as soon as possible.'
    })
    .setFooter({ text: 'Private support • Please do not open duplicate tickets' })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket:select')
      .setPlaceholder('🎫  Select a ticket category')
      .addOptions(
        { label: 'Staff Application', description: 'Apply to join the staff team', value: 'staff_application', emoji: '🎓' },
        { label: 'Player Report', description: 'Report a player or rule violation', value: 'player_report', emoji: '🚩' },
        { label: 'General Support', description: 'Get help from our support team', value: 'general_support', emoji: '💬' },
        { label: 'Bug Report', description: 'Report a bug or technical issue', value: 'bug_report', emoji: '🪲' }
      )
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function postApplicationPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x40b8a4)
    .setTitle('Staff applications')
    .setDescription('Interested in joining the staff team? Click **Apply** to answer the questions one at a time in a private channel.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('application:start').setLabel('Apply').setStyle(ButtonStyle.Success)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

function createCommandGuideEmbed() {
  const commandList = commandSchemas.map(command => {
    const subcommands = command.options
      ?.filter(option => option.type === 1)
      .map(option => `\`/${command.name} ${option.name}\``);
    return `**/${command.name}** — ${command.description}${subcommands?.length ? `\n${subcommands.join(', ')}` : ''}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor(0x7564d8)
    .setTitle(`${client.user.username} — Commands`)
    .setDescription(`Here are all my commands:\n\n${commandList}`)
    .setFooter({ text: 'Only the server owner can use /clear; it posts a public completion notice. Slash commands may take a short time to appear.' });
}

function createCommandGuideText() {
  const commandList = commandSchemas.flatMap(command => {
    const subcommands = command.options?.filter(option => option.type === 1);
    if (!subcommands?.length) {
      const options = command.options?.filter(option => option.type !== 1) || [];
      const usage = options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(' ');
      return [`/${command.name}${usage ? ` ${usage}` : ''} — ${command.description}`];
    }

    return subcommands.map(subcommand => {
      const options = subcommand.options
        .map(option => option.required ? `<${option.name}>` : `[${option.name}]`)
        .join(' ');
      const usage = `/${command.name} ${subcommand.name}${options ? ` ${options}` : ''}`;
      return `${usage} — ${subcommand.description}`;
    });
  });

  return [
    `${client.user.username} — COMMAND GUIDE`,
    'Use these slash commands in a server channel (type / there). DMs are only this help list.',
    '',
    ...commandList,
    '',
    'Note: /clear is restricted to the server owner, asks for confirmation, and posts a public completion notice.'
  ].join('\n');
}

async function deleteChannelMessages(channel) {
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  let before;
  let deletedCount = 0;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    const messages = [...batch.values()];
    const oldestMessage = messages.reduce((oldest, message) =>
      message.createdTimestamp < oldest.createdTimestamp ? message : oldest
    );
    const recentMessages = messages.filter(message => Date.now() - message.createdTimestamp < twoWeeks);
    const oldMessages = messages.filter(message => Date.now() - message.createdTimestamp >= twoWeeks);

    if (recentMessages.length > 0) {
      const deleted = await channel.bulkDelete(recentMessages, true);
      deletedCount += deleted.size;
    }
    for (let index = 0; index < oldMessages.length; index += 10) {
      const results = await Promise.allSettled(
        oldMessages.slice(index, index + 10).map(message => message.delete())
      );
      const failures = results.filter(result => result.status === 'rejected');
      deletedCount += results.length - failures.length;
      if (failures.length > 0) {
        throw new Error(`Could not delete ${failures.length} older message(s): ${failures[0].reason.message}`);
      }
    }

    before = oldestMessage.id;
  }

  return deletedCount;
}

function getClearPermissionError(channel) {
  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has([
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages
  ])) {
    return 'I need Manage Messages, Read Message History, and Send Messages in this channel to clear it and notify players.';
  }
  return null;
}

async function createTicket(interaction, kind, questions = []) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await getGuildSettings(interaction.guildId);
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 18) || 'member';
  const channelPrefix = kind.replaceAll('_', '-');
  const channel = await interaction.guild.channels.create({
    name: `${channelPrefix}-${safeName}`.slice(0, 90),
    topic: `${ticketType(kind).label} ticket for ${interaction.user.tag} (${interaction.user.id})`,
    type: ChannelType.GuildText,
    parent: settings.ticket_category_id || undefined,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...(settings.ticket_staff_role_id ? [{
        id: settings.ticket_staff_role_id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }] : []),
      {
        id: client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]
      }
    ]
  });

  await pool.query(
    'INSERT INTO tickets (channel_id, guild_id, opener_id, kind, application_questions) VALUES ($1, $2, $3, $4, $5)',
    [channel.id, interaction.guildId, interaction.user.id, kind, JSON.stringify(questions)]
  );
  const closeRow = createTicketControls();
  const ticketDetails = [
    `Hello ${interaction.member.displayName}, your private ${ticketType(kind).label.toLowerCase()} ticket is ready.`,
    `**Category:** ${ticketType(kind).label}`,
    '**Status:** Open',
    questions.length
      ? 'Please answer the application questions below one at a time.'
      : ticketOpeningPrompt(kind)
  ].join('\n\n');
  await replyWithEmbed(interaction, `${ticketType(kind).label} ticket ready`, `Your private ticket is ready: ${channel}`, {
    ephemeral: true
  });
  await channel.send({
    embeds: [createTextEmbed(`${ticketType(kind).label} • Private Ticket`, ticketDetails, interaction.member)],
    components: [closeRow]
  });

  if (questions.length > 0) {
    await sendStyledMemberMessage(
      channel,
      interaction.member,
      `STAFF APPLICATION • STEP 1/${questions.length}`,
      questions[0]
    );
    await pool.query('UPDATE tickets SET question_index = 1 WHERE channel_id = $1', [channel.id]);
  }
}

function createTicketControls(claimedBy) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel(claimedBy ? 'Ticket claimed' : 'Claim ticket')
      .setEmoji(claimedBy ? '✅' : '🙋')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(claimedBy)),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );
}

function ticketType(kind) {
  const types = {
    staff_application: { emoji: '🎓', label: 'Staff Application' },
    player_report: { emoji: '🚩', label: 'Player Report' },
    general_support: { emoji: '💬', label: 'General Support' },
    bug_report: { emoji: '🪲', label: 'Bug Report' }
  };
  return types[kind] || types.general_support;
}

function ticketOpeningPrompt(kind) {
  if (kind === 'player_report') {
    return 'Please provide the player’s username, what happened, when it happened, and any evidence or screenshots you have.';
  }
  if (kind === 'bug_report') {
    return 'Please describe the issue, the steps to reproduce it, what you expected to happen, and any screenshots or error messages.';
  }
  return 'Please describe what you need help with. Share any relevant details so our team can assist you quickly.';
}

async function sendMemberBanner(channel, member, message, bannerText, title) {
  const content = applyTemplate(message, member, member.guild)
    .replaceAll(`<@${member.id}>`, `**${member.displayName}**`)
    .replaceAll(`<@!${member.id}>`, `**${member.displayName}**`);
  const heading = title === 'welcome' ? 'Welcome to the server' : 'Goodbye for now';
  const description = [content, bannerText].filter(Boolean).join('\n\n');
  await channel.send({ embeds: [createTextEmbed(heading, description, member, 0x40b8a4)] });
}

async function sendStyledMemberMessage(channel, member, heading, message, components = []) {
  return channel.send({
    embeds: [createTextEmbed(heading, message, member)],
    ...(components.length ? { components } : {})
  });
}

async function getAnnouncementChannel(guild, configuredChannelId) {
  const botMember = guild.members.me || await guild.members.fetchMe();
  const requiredPermissions = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (configuredChannelId) {
    const channel = await guild.channels.fetch(configuredChannelId);
    if (!channel?.isTextBased() || channel.isDMBased() ||
        !channel.permissionsFor(botMember)?.has(requiredPermissions)) {
      throw new Error(`Configured announcement channel ${configuredChannelId} is unavailable or lacks send-message/embed permissions.`);
    }
    return channel;
  }

  const systemChannel = guild.systemChannel;
  if (systemChannel?.permissionsFor(botMember)?.has(requiredPermissions)) {
    return systemChannel;
  }
  const channel = guild.channels.cache.find(candidate =>
    candidate.isTextBased() &&
    !candidate.isDMBased() &&
    candidate.permissionsFor(botMember)?.has(requiredPermissions)
  );
  if (!channel) throw new Error(`No sendable text channel found in guild ${guild.id}.`);
  return channel;
}

async function handleManagementCommand(interaction, commandName) {
  if (!(await requireCommandAccess(interaction, commandName))) return;
  const subcommand = interaction.options.getSubcommand();

  if (commandName === 'permissions') {
    if (interaction.user.id !== interaction.guild.ownerId) {
      await replyWithEmbed(interaction, 'Owner only', 'Only this server owner can grant or revoke command roles.', { ephemeral: true });
      return;
    }
    const command = interaction.options.getString('command');
    const role = interaction.options.getRole('role');
    if (subcommand === 'grant') {
      await pool.query(
        'INSERT INTO command_roles (guild_id, command_name, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [interaction.guildId, command, role.id]
      );
      await replyWithEmbed(interaction, 'Permission granted', `${role} can now use \`/${command}\` management commands.`, { ephemeral: true });
    } else {
      await pool.query(
        'DELETE FROM command_roles WHERE guild_id = $1 AND command_name = $2 AND role_id = $3',
        [interaction.guildId, command, role.id]
      );
      await replyWithEmbed(interaction, 'Permission removed', `Removed ${role}'s access to \`/${command}\`.`, { ephemeral: true });
    }
    return;
  }

  if (commandName === 'ticket') {
    if (subcommand === 'panel') {
      if (interaction.user.id !== interaction.guild.ownerId) {
        await replyWithEmbed(interaction, 'Owner only', 'Only this server owner can post the ticket panel.', { ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel('channel');
      if (!channel.isTextBased()) {
        await replyWithEmbed(interaction, 'Invalid channel', 'Choose a text channel.', { ephemeral: true });
        return;
      }
      await postTicketPanel(channel);
      await replyWithEmbed(interaction, 'Ticket panel posted', `The public ticket panel is now available in ${channel}.`, { ephemeral: true });
    } else {
      const category = interaction.options.getChannel('category');
      const staffRole = interaction.options.getRole('staff_role');
      const updates = {};
      if (category) {
        if (category.type !== ChannelType.GuildCategory) {
          await replyWithEmbed(interaction, 'Invalid category', 'The category option must be a server category.', { ephemeral: true });
          return;
        }
        updates.ticket_category_id = category.id;
      }
      if (staffRole) updates.ticket_staff_role_id = staffRole.id;
      if (Object.keys(updates).length === 0) {
        await replyWithEmbed(interaction, 'Missing settings', 'Choose a category, a staff role, or both.', { ephemeral: true });
        return;
      }
      await updateGuildSettings(interaction.guildId, updates);
      await replyWithEmbed(interaction, 'Ticket settings saved', 'Your ticket category and staff role settings have been updated.', { ephemeral: true });
    }
    return;
  }

  if (commandName === 'application') {
    const channel = interaction.options.getChannel('channel');
    const questions = interaction.options.getString('questions').split(/\r?\n/).map(question => question.trim()).filter(Boolean);
    if (!channel.isTextBased() || questions.length === 0 || questions.length > 20) {
      await replyWithEmbed(interaction, 'Invalid application setup', 'Choose a text channel and provide between 1 and 20 questions, one per line.', { ephemeral: true });
      return;
    }
    await updateGuildSettings(interaction.guildId, {
      application_channel_id: channel.id,
      application_questions: JSON.stringify(questions)
    });
    await postApplicationPanel(channel);
    await replyWithEmbed(interaction, 'Application panel posted', `The panel is live in ${channel} with ${questions.length} questions.`, { ephemeral: true });
    return;
  }

  if (commandName === 'automod') {
    if (subcommand === 'status') {
      const { rows } = await pool.query('SELECT term FROM automod_terms WHERE guild_id = $1 ORDER BY term', [interaction.guildId]);
      await replyWithEmbed(
        interaction,
        'Automod filter',
        rows.length ? `Filtered terms: ${rows.map(row => `\`${row.term}\``).join(', ')}` : 'No custom filter terms are configured.',
        { ephemeral: true }
      );
      return;
    }
    const term = interaction.options.getString('term').trim().toLocaleLowerCase();
    if (!term) {
      await replyWithEmbed(interaction, 'Invalid filter term', 'The filter term cannot be empty.', { ephemeral: true });
      return;
    }
    if (subcommand === 'add-word') {
      await pool.query('INSERT INTO automod_terms (guild_id, term) VALUES ($1, $2) ON CONFLICT DO NOTHING', [interaction.guildId, term]);
      await replyWithEmbed(interaction, 'Filter term added', `Added \`${term}\` to the case-insensitive filter.`, { ephemeral: true });
    } else {
      await pool.query('DELETE FROM automod_terms WHERE guild_id = $1 AND term = $2', [interaction.guildId, term]);
      await replyWithEmbed(interaction, 'Filter term removed', `Removed \`${term}\` from the filter.`, { ephemeral: true });
    }
    return;
  }

  if (commandName === 'welcome' || commandName === 'leave') {
    const channel = interaction.options.getChannel('channel');
    if (!channel.isTextBased()) {
      await replyWithEmbed(interaction, 'Invalid channel', 'Choose a text channel.', { ephemeral: true });
      return;
    }
    const prefix = commandName === 'welcome' ? 'welcome' : 'leave';
    await updateGuildSettings(interaction.guildId, {
      [`${prefix}_channel_id`]: channel.id,
      [`${prefix}_message`]: interaction.options.getString('message') ||
        (commandName === 'welcome' ? DEFAULT_WELCOME_MESSAGE : DEFAULT_LEAVE_MESSAGE),
      [`${prefix}_banner`]: interaction.options.getString('banner_text')
    });
    await replyWithEmbed(
      interaction,
      `${commandName === 'welcome' ? 'Welcome' : 'Leave'} settings saved`,
      `${commandName} messages will be posted in ${channel}. ${interaction.options.getString('message') ? 'Your custom message is saved.' : 'The professional default message will be used.'}`,
      { ephemeral: true }
    );
    return;
  }

  if (commandName === 'autoreply') {
    const keyword = interaction.options.getString('keyword').trim().toLocaleLowerCase();
    if (subcommand === 'add') {
      const response = interaction.options.getString('response');
      await pool.query(
        'INSERT INTO auto_replies (guild_id, keyword, response) VALUES ($1, $2, $3) ON CONFLICT (guild_id, keyword) DO UPDATE SET response = EXCLUDED.response',
        [interaction.guildId, keyword, response]
      );
      await replyWithEmbed(interaction, 'Auto-reply saved', `The case-insensitive reply for \`${keyword}\` is ready.`, { ephemeral: true });
    } else {
      const result = await pool.query('DELETE FROM auto_replies WHERE guild_id = $1 AND keyword = $2', [interaction.guildId, keyword]);
      await replyWithEmbed(
        interaction,
        result.rowCount ? 'Auto-reply removed' : 'No auto-reply found',
        result.rowCount ? `Removed \`${keyword}\`.` : `No auto-reply was set for \`${keyword}\`.`,
        { ephemeral: true }
      );
    }
  }
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:select') {
    const kind = interaction.values[0];
    if (kind === 'staff_application') {
      const settings = await getGuildSettings(interaction.guildId);
      const questions = settings.application_questions || [];
      if (questions.length === 0) {
        await interaction.reply({
          embeds: [createTextEmbed('Applications are closed', 'Staff applications are not open yet. Please contact a server administrator.', interaction.member)],
          ephemeral: true
        });
        return;
      }
      await createTicket(interaction, kind, questions);
      return;
    }
    if (['player_report', 'general_support', 'bug_report'].includes(kind)) {
      await createTicket(interaction, kind);
      return;
    }
    await replyWithEmbed(interaction, 'Ticket category unavailable', 'Please select one of the available ticket categories.', { ephemeral: true });
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'clear:cancel') {
      await interaction.update({
        content: null,
        embeds: [createTextEmbed('Cleanup cancelled', 'No messages were deleted.', interaction.member)],
        components: []
      });
      return;
    }
    if (interaction.customId.startsWith('clear:confirm:')) {
      const [, , ownerId, channelId] = interaction.customId.split(':');
      if (interaction.user.id !== ownerId || ownerId !== interaction.guild?.ownerId) {
        await replyWithEmbed(interaction, 'Owner only', 'Only this server owner can confirm this action.', { ephemeral: true });
        return;
      }
      if (interaction.channelId !== channelId || !interaction.channel?.messages) {
        await replyWithEmbed(interaction, 'Confirmation expired', 'This confirmation is no longer valid in this channel.', { ephemeral: true });
        return;
      }
      const permissionError = getClearPermissionError(interaction.channel);
      if (permissionError) {
        await replyWithEmbed(interaction, 'Missing permissions', permissionError, { ephemeral: true });
        return;
      }
      await interaction.update({
        content: null,
        embeds: [createTextEmbed('Cleaning channel', 'Deleting messages. Please wait…', interaction.member)],
        components: []
      });
      const deletedCount = await deleteChannelMessages(interaction.channel);
      let noticeError;
      try {
        await sendStyledMemberMessage(
          interaction.channel,
          interaction.member,
          'CHANNEL CLEANUP',
          `Channel cleanup complete — ${deletedCount} message${deletedCount === 1 ? '' : 's'} deleted by the server owner.`
        );
      } catch (error) {
        noticeError = error;
        console.error(`Channel was cleared, but the public cleanup notice failed in ${interaction.channelId}:`, error);
      }
      await replyWithEmbed(
        interaction,
        noticeError ? 'Cleanup finished with a notice error' : 'Channel cleanup complete',
        noticeError
          ? `Deleted ${deletedCount} messages, but I could not post the public notice: ${noticeError.message}`
          : `Deleted ${deletedCount} messages and posted a notice for players in this channel.`
      );
      return;
    }
    if (interaction.customId.startsWith('ticket:create:')) {
      const kind = interaction.customId.split(':')[2];
      await createTicket(interaction, kind);
      return;
    }
    if (interaction.customId === 'application:start') {
      const settings = await getGuildSettings(interaction.guildId);
      const questions = settings.application_questions || [];
      if (!questions.length) {
        await replyWithEmbed(interaction, 'Applications are closed', 'The staff application form is not configured yet.', { ephemeral: true });
        return;
      }
      await createTicket(interaction, 'staff_application', questions);
      return;
    }
    if (interaction.customId === 'ticket:claim') {
      if (!(await hasTicketStaffAccess(interaction))) {
        await replyWithEmbed(interaction, 'Staff only', 'Only ticket-authorized staff can claim this ticket.', { ephemeral: true });
        return;
      }
      const { rows } = await pool.query(
        `UPDATE tickets SET claimed_by = $2
         WHERE channel_id = $1 AND status = 'open' AND claimed_by IS NULL
         RETURNING claimed_by`,
        [interaction.channelId, interaction.user.id]
      );
      if (rows.length === 0) {
        await replyWithEmbed(interaction, 'Ticket unavailable', 'This ticket has already been claimed or is closed.', { ephemeral: true });
        return;
      }
      const embed = interaction.message.embeds[0]
        ? EmbedBuilder.from(interaction.message.embeds[0]).setFooter({
          text: `Claimed by ${interaction.user.tag} • ${client.user.username} Support`
        })
        : undefined;
      await interaction.update({
        ...(embed ? { embeds: [embed] } : {}),
        components: [createTicketControls(interaction.user.id)]
      });
      return;
    }
    if (interaction.customId === 'ticket:close') {
      const { rows } = await pool.query('SELECT opener_id, status FROM tickets WHERE channel_id = $1', [interaction.channelId]);
      const ticket = rows[0];
      if (!ticket || ticket.status !== 'open') {
        await replyWithEmbed(interaction, 'Ticket unavailable', 'This ticket is already closed or is not registered.', { ephemeral: true });
        return;
      }
      if (!(await hasTicketStaffAccess(interaction))) {
        await replyWithEmbed(interaction, 'Staff only', 'Only the server owner or ticket-authorized staff can delete this ticket.', { ephemeral: true });
        return;
      }
      await pool.query("UPDATE tickets SET status = 'closed' WHERE channel_id = $1", [interaction.channelId]);
      await replyWithEmbed(interaction, 'Ticket closed', 'This channel will be deleted in 5 seconds.', { ephemeral: true });
      setTimeout(() => interaction.channel.delete('Ticket closed').catch(error => console.error('Unable to delete closed ticket:', error)), 5000);
      await sendStyledMemberMessage(
        interaction.channel,
        interaction.member,
        'TICKET CLOSED',
        'This private ticket is now closed and will be deleted in 5 seconds.'
      );
    }
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.guildId) return;
  const { commandName } = interaction;

  if (commandName === 'clear') {
    if (interaction.user.id !== interaction.guild.ownerId) {
      await replyWithEmbed(interaction, 'Owner only', 'Only this server owner can clear a channel.', { ephemeral: true });
      return;
    }
    if (!interaction.channel?.messages) {
      await replyWithEmbed(interaction, 'Text channel required', 'This command can only be used in a text channel.', { ephemeral: true });
      return;
    }
    const permissionError = getClearPermissionError(interaction.channel);
    if (permissionError) {
      await replyWithEmbed(interaction, 'Missing permissions', permissionError, { ephemeral: true });
      return;
    }
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`clear:confirm:${interaction.user.id}:${interaction.channelId}`)
        .setLabel('Delete all channel messages')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('clear:cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({
      embeds: [createTextEmbed(
        'Confirm channel cleanup',
        'This permanently deletes every message in this channel, including messages older than 14 days. Confirm to continue.',
        interaction.member,
        0xd96b72
      )],
      components: [confirmRow],
      ephemeral: true
    });
    return;
  }

  if (commandName === 'commands') {
    try {
      const guide = createTextEmbed(
        `${client.user.username} • Command Guide`,
        createCommandGuideText(),
        interaction.user
      ).setFooter({ text: 'Only the server owner can use /clear.' });
      await interaction.user.send({ embeds: [guide] });
      await replyWithEmbed(interaction, 'Command guide sent', 'I sent you a direct message with the command guide.', { ephemeral: true });
    } catch (error) {
      console.error(`Unable to DM command guide to user ${interaction.user.id}:`, error);
      await replyWithEmbed(
        interaction,
        'Could not send command guide',
        'Please enable direct messages from server members, then try `/commands` again.',
        { ephemeral: true }
      );
    }
    return;
  }

  if (commandName === 'ping') {
    await interaction.deferReply({ ephemeral: true });
    const startedAt = Date.now();
    await pool.query('SELECT 1');
    await replyWithEmbed(
      interaction,
      'Bot online',
      `Discord ping: **${client.ws.ping} ms**\nDatabase: **OK** (${Date.now() - startedAt} ms).`,
      { ephemeral: true }
    );
    return;
  }

  if (commandName === 'refresh') {
    if (interaction.user.id !== interaction.guild.ownerId) {
      await replyWithEmbed(interaction, 'Owner only', 'Only this server’s owner can refresh slash commands.', { ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const [globalCommands, guildCommands] = await Promise.all([
      client.application.commands.set(commandSchemas),
      client.application.commands.set(commandSchemas, interaction.guildId)
    ]);
    await replyWithEmbed(
      interaction,
      'Commands refreshed',
      `${guildCommands.size} commands are ready in this server. Global commands: ${globalCommands.size}.`,
      { ephemeral: true }
    );
    return;
  }

  if (['ticket', 'application', 'permissions', 'automod', 'welcome', 'leave', 'autoreply'].includes(commandName)) {
    await handleManagementCommand(interaction, commandName);
    return;
  }

  if (commandName === 'profile') {
    await interaction.deferReply();
    const user = interaction.options.getUser('member') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id);
    const { rows } = await pool.query(
      'SELECT xp, messages FROM member_stats WHERE guild_id = $1 AND user_id = $2',
      [interaction.guildId, user.id]
    );
    const stats = rows[0] || { xp: 0, messages: 0 };
    const xp = Number(stats.xp);
    const level = levelForXp(xp);
    const nextLevelXp = xpForNextLevel(level);
    const roleNames = member.roles.cache
      .filter(role => role.id !== interaction.guildId)
      .sort((first, second) => second.position - first.position)
      .map(role => role.name)
      .slice(0, 10);
    const roles = roleNames.length ? roleNames.join(', ').slice(0, 1000) : 'No additional roles';
    const embed = createTextEmbed(
      `${member.displayName} • Player Profile`,
      `**${user.tag}**\nServer member profile for **${interaction.guild.name}**.`,
      member
    ).addFields(
      { name: 'Level', value: `${level}${level === 100 ? ' (MAX)' : ''}`, inline: true },
      { name: 'Points', value: `${xp.toLocaleString()} XP`, inline: true },
      { name: 'Messages', value: Number(stats.messages).toLocaleString(), inline: true },
      { name: 'Next level', value: level === 100 ? 'Maximum level reached' : `${Math.max(0, nextLevelXp - xp).toLocaleString()} XP remaining`, inline: true },
      { name: 'Joined server', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Unknown', inline: true },
      { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'Roles', value: roles, inline: false }
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === 'leaderboard') {
    await interaction.deferReply();
    const { rows } = await pool.query(
      'SELECT user_id, xp, messages FROM member_stats WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10',
      [interaction.guildId]
    );
    const lines = await Promise.all(rows.map(async (row, index) => {
      const user = await client.users.fetch(row.user_id).catch(() => null);
      return `${index + 1}. ${user ? user.username : 'Unknown member'} — Level ${levelForXp(Number(row.xp))} (${row.xp} XP)`;
    }));
    await interaction.editReply({
      embeds: [createTextEmbed('Server Leaderboard', lines.join('\n') || 'No XP earned yet.', null, 0x40b8a4)]
    });
    return;
  }

  if (commandName === 'serverinfo') {
    const guild = interaction.guild;
    const embed = new EmbedBuilder()
      .setColor(0x40b8a4)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  }
}

client.on('interactionCreate', interaction => {
  handleInteraction(interaction).catch(async error => {
    console.error('Interaction failed:', error);
    if (interaction.isRepliable()) {
      const details = error instanceof Error ? error.message : 'Unknown error';
      const response = {
        embeds: [createTextEmbed('Command failed', details, interaction.member)],
        ephemeral: true
      };
      const reportError = replyError => console.error('Unable to report interaction failure:', replyError);
      if (interaction.deferred) {
        await interaction.editReply(response).catch(reportError);
      } else if (!interaction.replied) {
        await interaction.reply(response).catch(reportError);
      }
    }
  });
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  try {
    const now = Date.now();
    const member = message.member || await message.guild.members.fetch(message.author.id);
    const isPrivileged = member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.roles.cache.some(role => role.permissions.has(PermissionFlagsBits.ManageMessages));
    if (!isPrivileged && message.content) {
      const { rows: terms } = await pool.query('SELECT term FROM automod_terms WHERE guild_id = $1', [message.guild.id]);
      const mentionAbuse = message.mentions.users.size >= 5;
      const matchedTerm = terms.some(({ term }) => matchesWholePhrase(message.content, term));
      const spamKey = `${message.guild.id}:${message.author.id}`;
      const recentMessages = (spamHistory.get(spamKey) || [])
        .filter(item => now - item.timestamp < 10000);
      recentMessages.push({ content: message.content.trim().toLocaleLowerCase(), timestamp: now });
      spamHistory.set(spamKey, recentMessages);
      const repeatedSpam = recentMessages.filter(item => item.content === message.content.trim().toLocaleLowerCase()).length >= 3;
      const violation = mentionAbuse || matchedTerm || repeatedSpam;

      if (violation) {
        spamHistory.delete(spamKey);
        await message.delete().catch(error => console.error('Unable to delete moderated message:', error));
        const { rows } = await pool.query(
          `INSERT INTO moderation_strikes (guild_id, user_id, strikes) VALUES ($1, $2, 1)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET strikes = moderation_strikes.strikes + 1
           RETURNING strikes`,
          [message.guild.id, message.author.id]
        );
        const strikes = Number(rows[0].strikes);
        if (strikes <= 3) {
          await sendStyledMemberMessage(
            message.channel,
            member,
            'COMMUNITY WARNING',
            `Warning ${strikes}/3: please follow the server rules.`
          )
            .then(warning => setTimeout(() => warning.delete().catch(() => {}), 10000));
        } else {
          await member.timeout(10 * 60 * 1000, 'Automatic moderation: repeated abuse/filter violations');
          await pool.query('UPDATE moderation_strikes SET strikes = 0 WHERE guild_id = $1 AND user_id = $2', [message.guild.id, message.author.id]);
          await sendStyledMemberMessage(
            message.channel,
            member,
            'MODERATION NOTICE',
            'You have been timed out for 10 minutes after three warnings.'
          )
            .then(warning => setTimeout(() => warning.delete().catch(() => {}), 15000));
        }
        return;
      }
    }

    await pool.query(
      `INSERT INTO member_stats (guild_id, user_id, xp, messages)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET xp = member_stats.xp + EXCLUDED.xp, messages = member_stats.messages + 1`,
      [message.guild.id, message.author.id, xpForMessages(1)]
    );

    if (message.content) {
      const { rows: replies } = await pool.query(
        'SELECT keyword, response FROM auto_replies WHERE guild_id = $1 ORDER BY LENGTH(keyword) DESC',
        [message.guild.id]
      );
      const reply = replies.find(item => matchesWholePhrase(message.content, item.keyword));
      if (reply) {
        const content = reply.response
          .replaceAll('{user}', member.displayName)
          .replaceAll('{username}', message.author.username)
          .replaceAll('{server}', message.guild.name);
        await sendStyledMemberMessage(message.channel, member, 'COMMUNITY ASSISTANT', content);
      }
    }

    const { rows: applications } = await pool.query(
      `SELECT opener_id, application_questions, question_index
       FROM tickets
       WHERE channel_id = $1 AND kind = 'staff_application' AND status = 'open'`,
      [message.channelId]
    );
    const application = applications[0];
    if (application && application.opener_id === message.author.id) {
      const questions = application.application_questions;
      const step = getApplicationStep(questions, application.question_index);
      if (step) {
        await pool.query('UPDATE tickets SET question_index = $2 WHERE channel_id = $1', [message.channelId, step.nextIndex]);
        await sendStyledMemberMessage(
          message.channel,
          member,
          `STAFF APPLICATION • STEP ${step.nextIndex}/${questions.length}`,
          step.question
        );
      } else {
        await pool.query('UPDATE tickets SET question_index = $2 WHERE channel_id = $1', [message.channelId, questions.length]);
        await sendStyledMemberMessage(
          message.channel,
          member,
          'APPLICATION COMPLETE',
          'Thank you — your application is complete. A staff member will review it.',
          [createTicketControls()]
        );
      }
    }
  } catch (error) {
    console.error('Message handling failed:', error);
  }
});

client.on('guildMemberAdd', async member => {
  try {
    const settings = await getGuildSettings(member.guild.id);
    const channel = await getAnnouncementChannel(member.guild, settings.welcome_channel_id);
    await sendMemberBanner(
      channel,
      member,
      settings.welcome_message || DEFAULT_WELCOME_MESSAGE,
      settings.welcome_banner,
      'welcome'
    );
  } catch (error) {
    console.error('Welcome message failed:', error);
  }
});

client.on('guildMemberRemove', async member => {
  try {
    const settings = await getGuildSettings(member.guild.id);
    const channel = await getAnnouncementChannel(member.guild, settings.leave_channel_id);
    await sendMemberBanner(
      channel,
      member,
      settings.leave_message || DEFAULT_LEAVE_MESSAGE,
      settings.leave_banner,
      'goodbye'
    );
  } catch (error) {
    console.error('Leave message failed:', error);
  }
});

client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    try {
      await owner.send({
        embeds: [createTextEmbed(`${client.user.username} • Command Guide`, createCommandGuideText(), owner)]
      });
      return;
    } catch (error) {
      console.warn(`Could not DM the command guide to owner ${owner.id} of guild ${guild.id}; trying a server channel.`);
      console.error('Command-guide DM failed:', error);
    }

    const botMember = guild.members.me || await guild.members.fetchMe();
    const channel = guild.systemChannel?.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
      ? guild.systemChannel
      : guild.channels.cache.find(candidate =>
        candidate.isTextBased() &&
        !candidate.isDMBased() &&
        candidate.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
      );
    if (!channel) {
      console.warn(`Could not find a channel to post the command guide in guild ${guild.id}.`);
      return;
    }

    await channel.send({ embeds: [createCommandGuideEmbed()] });
  } catch (error) {
    console.error(`Unable to post the command guide for guild ${guild.id}:`, error);
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const globalCommands = await client.application.commands.set(commandSchemas);
    console.log(`Registered ${globalCommands.size} global slash commands.`);
  } catch (error) {
    console.error('Unable to register global slash commands:', error);
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      const guildCommands = await client.application.commands.set(commandSchemas, guild.id);
      console.log(`Registered ${guildCommands.size} slash commands in guild ${guild.id}.`);
    } catch (error) {
      console.error(`Unable to register slash commands in guild ${guild.id}:`, error);
    }
  }
});

async function start() {
  await initializeDatabase();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(async error => {
  console.error('Bot startup failed:', error);
  await pool.end().catch(closeError => console.error('Unable to close database pool:', closeError));
  process.exitCode = 1;
});
