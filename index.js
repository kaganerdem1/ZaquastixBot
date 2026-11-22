// index.js
require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const cron = require('node-cron');
const { createCanvas, loadImage } = require('canvas');

// ==========================================
// 1) ENVIRONMENT VARIABLES
// ==========================================
const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
    console.error(`❌ Missing environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
}

process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err));
process.on('uncaughtException', err => console.error('❌ Uncaught exception:', err));

// ==========================================
// 2) WEB SERVER (required by Render)
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Web server listening on port ${PORT}.`));

// ==========================================
// 3) SETTINGS
// ==========================================
const SETTINGS = {
    NOTIFY_CHANNEL: 'commands-bot',
    LOG_CHANNEL: 'commands-bot',
    WELCOME_CHANNEL: 'welcome-room',
    RULES_CHANNEL: 'rules',
    GENERAL_CHANNEL: 'general-chat',
    CAM_ONLY_CHANNEL: 'cam-only',
    TICKET_CHANNEL: 'mod-ticket',
    STAFF_ROLE_NAME: '@STAFF',
    MEMBER_ROLE: 'Member',
    CAMERA_CHECK_MS: 10000,
    TIMEZONE: 'Europe/Istanbul',
    POMODORO_COIN_PER_MIN: 2,
    VOICE_COIN_PER_MIN: 1,
    GOAL_BONUS: 50,
    WEEKLY_CHAMPION_BONUS: 200,
    LEADERBOARD_LIMIT: 10,
    WARN_LIMIT: 3,
    WARN_TIMEOUT_MS: 60 * 60 * 1000,
    SPAM_LIMIT: 5,
    SPAM_WINDOW_MS: 5000,
    SPAM_TIMEOUT_MS: 5 * 60 * 1000,
};

const BAD_WORDS = ['badword1', 'badword2'];


// ==========================================
// 5) DATABASE MODELS
// ==========================================
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, default: 'Unknown' },
    totalSec: { type: Number, default: 0 },
    dailySec: { type: Number, default: 0 },
    weeklySec: { type: Number, default: 0 },
    lastStudyDate: { type: String, default: '' },
    weekKey: { type: String, default: '' },
    streak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: '' },
    dailyGoal: { type: Number, default: 0 },
    goalRewardDate: { type: String, default: '' },
    balance: { type: Number, default: 0 },
    pomodoroCount: { type: Number, default: 0 },
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    description: { type: String, required: true },
    completed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});
const Task = mongoose.model('Task', taskSchema);

const activeSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
});
const ActiveSession = mongoose.model('ActiveSession', activeSessionSchema);

const pomodoroSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, default: 'Unknown' },
    channelId: { type: String, required: true },
    minutes: { type: Number, required: true },
    endsAt: { type: Date, required: true },
    done: { type: Boolean, default: false },
});
const Pomodoro = mongoose.model('Pomodoro', pomodoroSchema);

const warningSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    reason: { type: String, default: 'Not specified' },
    byName: { type: String, default: 'Unknown' },
    createdAt: { type: Date, default: Date.now },
});
const Warning = mongoose.model('Warning', warningSchema);

const videoSettingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    gracePeriod: { type: Number, default: 15000 },
    blacklistRoleId: { type: String, default: null },
    exampleChannelId: { type: String, default: null }
});
const VideoSettings = mongoose.model('VideoSettings', videoSettingsSchema);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB connected.'))
    .catch(err => console.error('❌ MongoDB connection error:', err.message));

// ==========================================
// 6) DISCORD CLIENT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.on('error', err => console.error('❌ Discord client error:', err.message));
client.on('shardDisconnect', (e, id) => console.error(`❌ Shard ${id} disconnected, code: ${e?.code}`));

// ==========================================
// 7) HELPERS
// ==========================================
function dayKey(date = new Date(), dayOffset = 0) {
    const t = new Date(date.getTime() + dayOffset * 86400000);
    return t.toLocaleDateString('en-CA', { timeZone: SETTINGS.TIMEZONE });
}

function weekKey() {
    const [y, m, d] = dayKey().split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const sinceMonday = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - sinceMonday);
    return dt.toISOString().slice(0, 10);
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const normalize = s => s.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

async function findChannel(guild, name, type = ChannelType.GuildText) {
    const list = await guild.channels.fetch();
    const target = normalize(name);
    return list.find(c => c && c.type === type && normalize(c.name) === target) ?? null;
}

async function ensureChannel(guild, name, type = ChannelType.GuildText) {
    const existing = await findChannel(guild, name, type);
    if (existing) return existing;
    console.log(`🛠️ Creating channel "${name}"...`);
    return guild.channels.create({ name, type, reason: 'Bot setup' });
}

async function ensureRole(guild, name, color) {
    await guild.roles.fetch();
    const existing = guild.roles.cache.find(r => r.name === name);
    if (existing) return existing;
    console.log(`🛠️ Creating role "${name}"...`);
    return guild.roles.create({ name, color, reason: 'Bot setup' });
}

async function send(guild, channelName, payload) {
    try {
        const channel = await findChannel(guild, channelName);
        if (!channel) return false;
        await channel.send(payload);
        return true;
    } catch (err) {
        console.error(`❌ Could not send to "${channelName}":`, err.code, err.message);
        return false;
    }
}

async function sendDM(guild, userId, payload) {
    try {
        const member = await guild.members.fetch(userId);
        await member.send(payload);
        return true;
    } catch (err) {
        console.error(`❌ Could not DM ${userId}:`, err.message);
        return false;
    }
}

function embed(title, description, color = 0xE74C3C) {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

async function addStudyTime(userId, name, seconds, coins) {
    const today = dayKey();
    const thisWeek = weekKey();
    const yesterday = dayKey(new Date(), -1);

    let u = await User.findOne({ userId });
    if (!u) u = new User({ userId, username: name });

    if (u.lastStudyDate !== today) { u.dailySec = 0; u.lastStudyDate = today; }
    if (u.weekKey !== thisWeek) { u.weeklySec = 0; u.weekKey = thisWeek; }
    u.username = name;

    u.dailySec += seconds;
    u.weeklySec += seconds;
    u.totalSec += seconds;
    u.balance += coins;

    if (u.lastActiveDate !== today) {
        u.streak = u.lastActiveDate === yesterday ? u.streak + 1 : 1;
        u.lastActiveDate = today;
    }

    let bonus = false;
    if (u.dailyGoal > 0 && u.dailySec >= u.dailyGoal * 60 && u.goalRewardDate !== today) {
        u.balance += SETTINGS.GOAL_BONUS;
        u.goalRewardDate = today;
        bonus = true;
    }

    await u.save();
    return { u, bonus };
}

// ==========================================
// 10) SLASH COMMANDS AND SERVER SETUP
// ==========================================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commandsData = [
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a ticket for moderators.'),

    new SlashCommandBuilder()
        .setName('video_channels')
        .setDescription('Configure camera-only channel settings (Mods only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('help').setDescription('List all commands.'),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('clearwarns')
        .setDescription('Clear a user\'s warnings.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription("Show a user's warnings.")
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('rulespanel')
        .setDescription('Post the rules and accept button in this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(c => c.toJSON());

async function deleteGlobalCommands() {
    try {
        const globalCmds = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
        for (const cmd of globalCmds) {
            await rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, cmd.id));
            console.log(`🗑️ Deleted old global command: /${cmd.name}`);
        }
        if (!globalCmds.length) console.log('ℹ️ No old global commands found.');
    } catch (err) {
        console.error('❌ Could not delete global commands:', err.message);
    }
}

async function registerCommands(guildId) {
    try {
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: commandsData }
        );
        console.log(`✅ Slash commands registered (guild: ${guildId}).`);
    } catch (err) {
        console.error(`❌ Command registration error (guild: ${guildId}):`, err.message);
    }
}

async function setupGuild(guild) {
    console.log(`\n🏠 Setting up guild: ${guild.name} (${guild.id})`);
    await registerCommands(guild.id);

    try {
        await ensureChannel(guild, SETTINGS.NOTIFY_CHANNEL);
        await ensureChannel(guild, SETTINGS.WELCOME_CHANNEL);
        await ensureChannel(guild, SETTINGS.RULES_CHANNEL);
        await ensureChannel(guild, SETTINGS.GENERAL_CHANNEL);
        await ensureChannel(guild, SETTINGS.CAM_ONLY_CHANNEL, ChannelType.GuildVoice);

        await ensureRole(guild, SETTINGS.MEMBER_ROLE, 0x57F287);

        await ActiveSession.deleteMany({ guildId: guild.id });
        const inVoice = [...guild.voiceStates.cache.values()]
            .filter(vs => vs.channelId && vs.member && !vs.member.user.bot);
        for (const vs of inVoice) {
            await ActiveSession.findOneAndUpdate(
                { userId: vs.id },
                { userId: vs.id, guildId: guild.id, channelId: vs.channelId, joinedAt: new Date() },
                { upsert: true }
            );
        }

        console.log(`✅ ${guild.name}: setup complete. ${inVoice.length} users in voice restored.`);
    } catch (err) {
        console.error(`❌ ${guild.name} setup error:`, err.code, err.message);
    }
}

// ==========================================
// 11) DISCORD EVENTS
// ==========================================
client.once('clientReady', async () => {
    console.log(`🤖 ${client.user.tag} is online!`);
    client.user.setActivity('🦁 Study mode', { type: 3 });

    await deleteGlobalCommands();

    for (const guild of client.guilds.cache.values()) {
        await setupGuild(guild);
    }
});

client.on('guildCreate', async guild => {
    await setupGuild(guild);
});

// ==========================================
// 12) INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isModalSubmit()) return await handleModal(interaction);
        if (interaction.isStringSelectMenu()) return await handleSelectMenu(interaction);
        if (interaction.isButton()) return await handleButton(interaction);
        if (!interaction.isChatInputCommand()) return;
        return await handleCommand(interaction);
    } catch (err) {
        console.error('❌ Interaction error:', err);
        const reply = { content: '❌ Something went wrong. Check the console.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
    }
});

async function handleModal(i) {
    if (i.customId === 'ticket_modal') {
        const subject = i.fields.getTextInputValue('ticket_subject');
        const description = i.fields.getTextInputValue('ticket_description');
        
        const ticketChannel = await findChannel(i.guild, SETTINGS.TICKET_CHANNEL);
        if (!ticketChannel) return i.reply({ content: `❌ The channel \`${SETTINGS.TICKET_CHANNEL}\` was not found. Please inform the staff.`, flags: MessageFlags.Ephemeral });

        const staffRole = i.guild.roles.cache.find(r => r.name === SETTINGS.STAFF_ROLE_NAME || r.name === SETTINGS.STAFF_ROLE_NAME.replace('@', ''));
        const staffMention = staffRole ? `<@&${staffRole.id}>` : SETTINGS.STAFF_ROLE_NAME;

        const embedMsg = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('🎫 New Ticket / Report')
            .setDescription(`**User:** <@${i.user.id}> (\`${i.user.tag}\`)\n\n**Subject:** ${subject}\n\n**Description:**\n${description}`)
            .setFooter({ text: `User ID: ${i.user.id}` })
            .setTimestamp();

        await ticketChannel.send({ content: `${staffMention}`, embeds: [embedMsg] });

        return i.reply({ content: '✅ Your ticket has been created and sent to the staff. Please wait for a response via DM.', flags: MessageFlags.Ephemeral });
    }
}

function rulesButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('accept_rules')
            .setLabel('✅ I Accept the Rules')
            .setStyle(ButtonStyle.Success)
    );
}

async function handleButton(i) {
    if (i.customId === 'accept_rules') {
        const role = await ensureRole(i.guild, SETTINGS.MEMBER_ROLE, 0x57F287);
        if (!i.member.roles.cache.has(role.id)) {
            await i.member.roles.add(role, 'Accepted the rules');
        }
        return i.reply({ content: '✅ You accepted the rules. Welcome to the server!', flags: MessageFlags.Ephemeral });
    }

    if (i.customId.startsWith('pomo_')) {
        const parts = i.customId.split('_');
        const action = parts[1];
        const ownerId = parts[2];

        const isMod = i.member.permissions.has(PermissionFlagsBits.ModerateMembers);
        if (i.user.id !== ownerId && !isMod) {
            return i.reply({ content: '❌ Only the person who started this Pomodoro or a Moderator can use these buttons.', flags: MessageFlags.Ephemeral });
        }

        if (action === 'present') {
            return i.reply({ content: '✅ **Present!** You are marked as active. Good luck with your studies!', flags: MessageFlags.Ephemeral });
        }

        if (action === 'options') {
            const optEmbed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('⚙️ Pomodoro Options')
                .setDescription('Use the buttons below to manage this timer. *(Only you and mods can see this)*')
                .addFields(
                    { name: '🔄 Restart', value: 'Resets the current timer and starts over.' },
                    { name: '⏸️ Pause', value: 'Pauses the timer.' }
                );

            const optRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`pomo_reset_${ownerId}`).setLabel('Reset Timer').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`pomo_pause_${ownerId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary)
            );

            return i.reply({ embeds: [optEmbed], components: [optRow], flags: MessageFlags.Ephemeral });
        }

        if (action === 'stop') {
            await i.update({ content: `🛑 **Pomodoro stopped.**\n<@${ownerId}> has left the room.`, embeds: [], components: [] });
            return;
        }
        
        if (action === 'reset' || action === 'pause') {
            return i.reply({ content: '⚙️ This feature is currently under maintenance.', flags: MessageFlags.Ephemeral });
        }
    }
}

async function handleSelectMenu(i) {
    if (i.customId === 'video_settings_select') {
        const val = i.values[0];
        
        if (val === 'grace_period') {
            const optRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('video_grace_select')
                    .setPlaceholder('Select Duration')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('15 Seconds').setValue('15'),
                        new StringSelectMenuOptionBuilder().setLabel('30 Seconds').setValue('30'),
                        new StringSelectMenuOptionBuilder().setLabel('1 Minute').setValue('60'),
                        new StringSelectMenuOptionBuilder().setLabel('2 Minutes').setValue('120'),
                    )
            );
            return i.update({ components: [optRow] });
        }

        if (val === 'blacklist_role') {
            const optRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('video_blacklist_role_select')
                    .setPlaceholder('Select Blacklist Role')
                    .addOptions(
                        i.guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).first(25).map(r => 
                            new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.id)
                        )
                    )
            );
            return i.update({ components: [optRow] });
        }

        if (val === 'example_channel') {
            const optRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('video_example_channel_select')
                    .setPlaceholder('Select Camera-Only Channel')
                    .addOptions(
                        i.guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).first(25).map(c => 
                            new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.id)
                        )
                    )
            );
            return i.update({ components: [optRow] });
        }
    }

    if (i.customId === 'video_grace_select') {
        const seconds = parseInt(i.values[0]);
        await VideoSettings.findOneAndUpdate({ guildId: i.guild.id }, { gracePeriod: seconds * 1000 }, { upsert: true });
        return i.update({ content: `✅ Camera grace period set to **${seconds} seconds**.`, components: [] });
    }

    if (i.customId === 'video_blacklist_role_select') {
        const roleId = i.values[0];
        await VideoSettings.findOneAndUpdate({ guildId: i.guild.id }, { blacklistRoleId: roleId }, { upsert: true });
        return i.update({ content: `✅ Blacklist role set to <@&${roleId}>.`, components: [] });
    }

    if (i.customId === 'video_example_channel_select') {
        const channelId = i.values[0];
        await VideoSettings.findOneAndUpdate({ guildId: i.guild.id }, { exampleChannelId: channelId }, { upsert: true });
        return i.update({ content: `✅ Camera-only channel set to <#${channelId}>.`, components: [] });
    }
}

async function handleCommand(i) {
    const { commandName: c, user } = i;

    switch (c) {
        case 'ticket': {
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('Create Ticket / Report');

            const subjectInput = new TextInputBuilder()
                .setCustomId('ticket_subject')
                .setLabel('Subject')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter a short title (e.g., Rule Violation)')
                .setRequired(true)
                .setMaxLength(100);

            const descInput = new TextInputBuilder()
                .setCustomId('ticket_description')
                .setLabel('Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Please describe the situation in detail...')
                .setRequired(true)
                .setMaxLength(1500);

            modal.addComponents(
                new ActionRowBuilder().addComponents(subjectInput),
                new ActionRowBuilder().addComponents(descInput)
            );

            await i.showModal(modal);
            return;
        }

        case 'video_channels': {
            let settings = await VideoSettings.findOne({ guildId: i.guild.id });
            if (!settings) {
                settings = await VideoSettings.create({ guildId: i.guild.id });
            }

            const blacklistRole = settings.blacklistRoleId ? `<@&${settings.blacklistRoleId}>` : 'Not configured';
            const exampleChannel = settings.exampleChannelId ? `<#${settings.exampleChannelId}>` : 'Not configured';

            const panelEmbed = new EmbedBuilder()
                .setColor(0x2F3136)
                .setTitle('Video Channels Configuration Panel')
                .setDescription('**video_channels**\nMembers must enable their video in these channels.')
                .addFields(
                    { name: 'video_example', value: `Members with **${exampleChannel}** will not need to enable their video.\n**Currently: ${exampleChannel}**` },
                    { name: 'video_grace_period', value: `The time a member has to enable their video.\n**Currently: ${settings.gracePeriod / 1000} seconds**` },
                    { name: 'video_blacklist', value: `This role is given automatically if a member does not keep their video enabled.\n**Currently: ${blacklistRole}**` }
                )
                .setFooter({ text: 'Only Moderators can change these settings.' });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('video_settings_select')
                    .setPlaceholder('Select a setting...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('video_example').setDescription('Select the camera-only channel').setValue('example_channel'),
                        new StringSelectMenuOptionBuilder().setLabel('video_grace_period').setDescription('Select the grace period').setValue('grace_period'),
                        new StringSelectMenuOptionBuilder().setLabel('video_blacklist').setDescription('Select the blacklist role').setValue('blacklist_role')
                    )
            );

            return i.reply({ embeds: [panelEmbed], components: [row] });
        }

        case 'help': {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📖 Commands')
                .addFields(
                    { name: '🎫 Support', value: '`/ticket`' }
                )
                .setFooter({ text: 'You earn time by studying in voice channels.' });

            if (i.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                helpEmbed.addFields(
                    { name: '🛡️ Moderation', value: '`/warn` `/clearwarns` `/warnings` `/rulespanel` `/video_channels`' }
                );
            }

            return i.reply({ embeds: [helpEmbed] });
        }

        case 'warn': {
            const target = i.options.getUser('user');
            const reason = i.options.getString('reason') ?? 'Not specified';
            const member = await i.guild.members.fetch(target.id).catch(() => null);
            if (!member) return i.reply({ content: '❌ User not found in this server.', flags: MessageFlags.Ephemeral });

            const count = await warnUser(i.guild, member, reason, user.username);
            return i.reply({
                content: `✅ <@${target.id}> has been warned. Total warnings: **${count}**`,
                flags: MessageFlags.Ephemeral,
            });
        }

        case 'clearwarns': {
            const target = i.options.getUser('user');
            await Warning.deleteMany({ guildId: i.guild.id, userId: target.id });
            return i.reply({ content: `✅ All warnings for <@${target.id}> have been successfully cleared.`, flags: MessageFlags.Ephemeral });
        }

        case 'warnings': {
            const target = i.options.getUser('user');
            const list = await Warning.find({ guildId: i.guild.id, userId: target.id })
                .sort({ createdAt: -1 }).limit(10);
            if (!list.length) return i.reply({ content: '✅ This user has no warnings.', flags: MessageFlags.Ephemeral });

            const lines = list.map(w =>
                `• ${w.createdAt.toLocaleDateString('en-GB')} — ${w.reason} (by ${w.byName})`);
            return i.reply({
                embeds: [embed(`⚠️ Warnings for ${target.username}`, lines.join('\n'), 0xE74C3C)],
                flags: MessageFlags.Ephemeral,
            });
        }

        case 'rulespanel': {
            const rulesEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📜 Server Rules')
                .setDescription(
                    '1. Be respectful. No insults or harassment.\n' +
                    '2. No ads or invite links.\n' +
                    '3. Turn on your camera in the cam-only room.\n' +
                    '4. No spam.\n' +
                    '5. Do not disturb others in study rooms.\n\n' +
                    'After reading the rules, press the button below.'
                );
            await i.channel.send({ embeds: [rulesEmbed], components: [rulesButton()] });
            return i.reply({ content: '✅ Rules panel posted.', flags: MessageFlags.Ephemeral });
        }
    }
}

// ==========================================
// 13) WARNINGS
// ==========================================
async function warnUser(guild, member, reason, byName) {
    await Warning.create({ guildId: guild.id, userId: member.id, reason, byName });
    let count = await Warning.countDocuments({ guildId: guild.id, userId: member.id });

    if (count >= SETTINGS.WARN_LIMIT) {
        await member.timeout(SETTINGS.WARN_TIMEOUT_MS, 'Warning limit reached')
            .catch(e => console.error('❌ Timeout error:', e.message));
        
        await Warning.deleteMany({ guildId: guild.id, userId: member.id });
        count = 0;

        await send(guild, SETTINGS.TICKET_CHANNEL, {
            embeds: [embed('🔇 Automatic Timeout',
                `<@${member.id}> reached ${SETTINGS.WARN_LIMIT} warnings, was timed out for **1 hour**, and their warnings were reset.`, 0x992D22)],
        });
        
        await sendDM(guild, member.id, {
            embeds: [embed('🔇 Automatic Timeout',
                `You have reached **${SETTINGS.WARN_LIMIT}** warnings and have been timed out for **1 hour**. Your warnings have been reset.`, 0x992D22)],
        });
    }

    const warnEmbed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('⚠️ Warning')
        .setDescription(`<@${member.id}> has been warned.`)
        .addFields(
            { name: 'Reason', value: reason },
            { name: 'Issued by', value: byName },
            { name: 'Total warnings', value: `${count}/${SETTINGS.WARN_LIMIT}` }
        )
        .setTimestamp();

    await send(guild, SETTINGS.TICKET_CHANNEL, { embeds: [warnEmbed] });
    await sendDM(guild, member.id, { embeds: [warnEmbed] });

    return count;
}

// ==========================================
// 14) VOICE STUDY AND CAM-ONLY
// ==========================================
const pendingCameraChecks = new Map();

function cancelCameraCheck(userId) {
    const t = pendingCameraChecks.get(userId);
    if (t) {
        clearTimeout(t);
        pendingCameraChecks.delete(userId);
    }
}

async function startSession(guild, member, channelId) {
    await ActiveSession.findOneAndUpdate(
        { userId: member.id },
        { userId: member.id, guildId: guild.id, channelId, joinedAt: new Date() },
        { upsert: true }
    );
}

async function endSession(guild, userId, name) {
    const session = await ActiveSession.findOneAndDelete({ userId });
    if (!session) return;

    const seconds = Math.floor((Date.now() - session.joinedAt.getTime()) / 1000);
    let todaySec = 0;

    if (seconds > 0) {
        const coins = Math.floor(seconds / 60) * SETTINGS.VOICE_COIN_PER_MIN;
        const result = await addStudyTime(userId, name, seconds, coins);
        todaySec = result.u.dailySec;
    } else {
        todaySec = (await User.findOne({ userId }))?.dailySec ?? 0;
    }

    const summary = seconds > 0
        ? `You studied for **${formatTime(seconds)}** this session`
        : 'This session was under 1 second';

    await sendDM(guild, userId, {
        embeds: [embed('🔴 You left the room',
            `${summary}.\n📚 You've studied **${formatTime(todaySec)}** in total today.`, 0xE74C3C)],
    });

}

async function voiceChannelName(state) {
    if (!state.channelId) return null;
    if (state.channel?.name) return state.channel.name;
    const ch = await state.guild.channels.fetch(state.channelId).catch(() => null);
    return ch?.name ?? null;
}

async function cameraCheck(guild, userId, channelId) {
    pendingCameraChecks.delete(userId);
    try {
        const member = await guild.members.fetch(userId);
        if (member.voice.channelId !== channelId || member.voice.selfVideo) return;

        await member.voice.setChannel(null, 'Camera off in cam-only room');

        const alert = embed('⚠️ Camera Alert',
            `<@${userId}> joined **${SETTINGS.CAM_ONLY_CHANNEL}** with the camera off and was removed.`, 0xE74C3C)
            .addFields({ name: 'What to do', value: 'Turn on your camera before joining this room again.' });

        await sendDM(guild, userId, { embeds: [alert] });
    } catch (err) {
        console.error('❌ Cam-only check error:', err.code, err.message);
    }
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;
    if (oldChannel === newChannel) return;

    try {
        if (!oldChannel && newChannel) {
            await startSession(newState.guild, member, newChannel);
        } else if (oldChannel && !newChannel) {
            await endSession(oldState.guild, userId, member.displayName);
        } else if (oldChannel && newChannel) {
            await ActiveSession.updateOne({ userId }, { channelId: newChannel });
        }

        if (oldChannel) cancelCameraCheck(userId);

        if (newChannel) {
            const name = await voiceChannelName(newState);
            if (name && normalize(name) === normalize(SETTINGS.CAM_ONLY_CHANNEL)) {
                const timer = setTimeout(
                    () => cameraCheck(newState.guild, userId, newChannel),
                    SETTINGS.CAMERA_CHECK_MS
                );
                pendingCameraChecks.set(userId, timer);
            }
        }
    } catch (err) {
        console.error('❌ Voice event error:', err);
    }
});

// ==========================================
// 15) MESSAGE FILTERS (invites, bad words, spam)
// ==========================================
const spamTracker = new Map();

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot || !message.member) return;
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const content = message.content.toLowerCase();
    const guild = message.guild;

    try {
        if (/(discord\.gg\/|discord\.com\/invite\/)/i.test(content)) {
            await message.delete().catch(() => {});
            await warnUser(guild, message.member, 'Unauthorized invite link', 'Auto moderation');
            return;
        }

        if (BAD_WORDS.some(w => content.includes(w))) {
            await message.delete().catch(() => {});
            await warnUser(guild, message.member, 'Offensive language', 'Auto moderation');
            return;
        }

        const now = Date.now();
        const recent = (spamTracker.get(message.author.id) ?? []).filter(t => now - t < SETTINGS.SPAM_WINDOW_MS);
        recent.push(now);
        spamTracker.set(message.author.id, recent);

        if (recent.length >= SETTINGS.SPAM_LIMIT) {
            spamTracker.delete(message.author.id);
            await message.member.timeout(SETTINGS.SPAM_TIMEOUT_MS, 'Spam')
                .catch(e => console.error('❌ Spam timeout error:', e.message));
            
            await send(guild, SETTINGS.TICKET_CHANNEL, {
                embeds: [embed('🚫 Spam Blocked',
                    `<@${message.author.id}> was timed out for **5 minutes** for spamming.`, 0xE74C3C)],
            });

            await sendDM(guild, message.author.id, {
                embeds: [embed('🚫 Spam Blocked',
                    `You were timed out for **5 minutes** for spamming.`, 0xE74C3C)],
            });
        }
    } catch (err) {
        console.error('❌ Message filter error:', err);
    }
});

// ==========================================
// 16) WELCOME / GOODBYE
// ==========================================
client.on('guildMemberAdd', async member => {
    try {
        const rulesChannel = await findChannel(member.guild, SETTINGS.RULES_CHANNEL);
        const rulesMention = rulesChannel ? `<#${rulesChannel.id}>` : `#${SETTINGS.RULES_CHANNEL}`;

        await sendDM(member.guild, member.id, {
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('Welcome!')
                    .setDescription(`👋 Hello <@${member.id}>! Welcome to the server.\n\nPlease go to the ${rulesMention} channel, read the rules, and click the green checkmark (✅) to accept them.`)
                    .setTimestamp()
            ]
        });
    } catch (err) {
        console.error('❌ Welcome message error:', err);
    }
});

client.on('guildMemberRemove', async member => {
    try {
        const channel = await findChannel(member.guild, SETTINGS.WELCOME_CHANNEL);
        if (channel) await channel.send(`😢 <@${member.id}> has left the server.`);
    } catch (err) {
        console.error('❌ Goodbye message error:', err);
    }
});

// ==========================================
// 19) START
// ==========================================
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Discord login failed:', err.message);
    process.exit(1);
});
