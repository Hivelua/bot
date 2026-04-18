const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages
    ]
});

const PREFIX = '.';
const roleBackups = new Map();
const jailBackups = new Map();
const warns = new Map();

client.once('ready', () => {
    console.log(`${client.user.tag} is online!`);
});

function createSuccessEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`${description}\n\n✅ Action Successful`)
        .setColor(0x00FF00)
        .setTimestamp();
    return embed;
}

function createErrorEmbed(title, description) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0xFF0000)
        .setTimestamp();
    return embed;
}

// Helper function to get user ID from mention or raw ID
function getUserIdFromInput(input) {
    if (!input) return null;
    // Remove mention formatting <@!123> or <@123>
    let id = input.replace(/[<@!>]/g, '');
    // Check if it's a valid Discord ID (17-20 digits)
    if (/^\d{17,20}$/.test(id)) {
        return id;
    }
    return null;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    function getReason(argsArray, defaultReason = 'No reason provided') {
        const reason = argsArray.join(' ');
        if (!reason || reason.length === 0) return defaultReason;
        return reason;
    }

    // ========== PING COMMAND ==========
    if (command === 'ping') {
        const sent = await message.reply({ embeds: [createErrorEmbed('Pinging...', 'Calculating bot latency...')] });
        
        const wsLatency = client.ws.ping;
        const roundtripLatency = sent.createdTimestamp - message.createdTimestamp;
        
        let pingColor = 0x00FF00;
        let pingStatus = 'Excellent';
        
        if (wsLatency > 200) {
            pingColor = 0xFFA500;
            pingStatus = 'Mediocre';
        }
        if (wsLatency > 400) {
            pingColor = 0xFF0000;
            pingStatus = 'Bad';
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setDescription(`\`\`\`\n📡 WebSocket Latency: ${wsLatency}ms\n🔄 Round-trip Latency: ${roundtripLatency}ms\n📊 Status: ${pingStatus}\n⏰ Time: ${new Date().toLocaleString()}\n\`\`\``)
            .setColor(pingColor)
            .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();
        
        await sent.edit({ embeds: [embed] });
    }

    // ========== BAN COMMAND (Works with ID and Mention) ==========
    if (command === 'ban') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to ban. Example: `.ban 123456789012345678 reason here` or `.ban @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }
        
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot ban yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server. Make sure the user is in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to ban someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Ban Members** permission to ban someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot ban ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        }

        const reason = getReason(args.slice(1));

        try {
            await targetMember.ban({ reason: `Banned by ${message.author.tag}: ${reason}` });
            const embed = createSuccessEmbed('User Banned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to ban user.')] });
        }
    }

    // ========== UNBAN COMMAND ==========
    if (command === 'unban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.unban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);
            
            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            }

            const unbannedUser = banEntry.user;
            await message.guild.bans.remove(unbannedUser.id);
            
            const embed = createSuccessEmbed('User Unbanned', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', `Failed to unban user.`)] });
        }
    }

    // ========== IUNBAN COMMAND ==========
    if (command === 'iunban') {
        const userId = getUserIdFromInput(args[0]);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a valid user ID to unban. Example: `.iunban 123456789012345678`')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Ban Members** permission to unban someone.')] });
        }

        try {
            const bans = await message.guild.bans.fetch();
            const banEntry = bans.get(userId);
            
            if (!banEntry) {
                return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a banned user with ID: ${userId}.`)] });
            }

            const unbannedUser = banEntry.user;
            await message.guild.bans.remove(unbannedUser.id);
            
            let dmSent = false;
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('You have been unbanned!')
                    .setDescription(`You have been unbanned from **${message.guild.name}**.\n\nClick here to join back: https://discord.com/invite/Ur3gxVQSQH`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                await unbannedUser.send({ embeds: [dmEmbed] });
                dmSent = true;
            } catch (dmError) {
                console.log(`Could not DM ${unbannedUser.tag}`);
            }
            
            const embed = createSuccessEmbed('User Unbanned + DM', `**User:** ${unbannedUser.toString()}\n**User ID:** ${unbannedUser.id}\n\n**Moderator:** ${message.author.toString()}\n\n**DM Status:** ${dmSent ? '✅ Invite link sent' : '❌ Could not DM user'}`);
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', `Failed to unban user.`)] });
        }
    }

    // ========== KICK COMMAND (Works with ID and Mention) ==========
    if (command === 'kick') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to kick. Example: `.kick 123456789012345678 reason here` or `.kick @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }
        
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot kick yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Kick Members** permission to kick someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Kick Members** permission to kick someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        const botHighestRole = botMember.roles.highest;
        if (targetHighestRole.position >= botHighestRole.position) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot kick ${targetMember.user.tag} - they have a role higher than or equal to my highest role.`)] });
        }

        const reason = getReason(args.slice(1));

        try {
            await targetMember.kick(`Kicked by ${message.author.tag}: ${reason}`);
            const embed = createSuccessEmbed('User Kicked', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to kick user.')] });
        }
    }

    // ========== MUTE COMMAND (Works with ID and Mention) ==========
    if (command === 'mute') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to mute. Example: `.mute 123456789012345678 1h reason here` or `.mute @user 1h reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID. Please provide a valid user ID or mention a user.')] });
        }
        
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot mute yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to mute someone.')] });
        }

        const botMember = await message.guild.members.fetch(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'I need **Moderate Members** permission to mute someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot mute ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        let duration = args[1];
        let reasonStart = 2;
        let milliseconds = 0;
        
        if (!duration || !duration.match(/^\d+[mhd]$/)) {
            duration = '10m';
            reasonStart = 1;
        }
        
        const durationValue = parseInt(duration);
        const durationUnit = duration.slice(-1);
        
        switch(durationUnit) {
            case 'm': milliseconds = durationValue * 60 * 1000; break;
            case 'h': milliseconds = durationValue * 60 * 60 * 1000; break;
            case 'd': milliseconds = durationValue * 24 * 60 * 60 * 1000; break;
            default: milliseconds = 10 * 60 * 1000;
        }
        
        const reason = getReason(args.slice(reasonStart));

        try {
            await targetMember.timeout(milliseconds, `Muted by ${message.author.tag}: ${reason}`);
            const durationText = `${durationValue}${durationUnit === 'm' ? ' minute(s)' : durationUnit === 'h' ? ' hour(s)' : ' day(s)'}`;
            const embed = createSuccessEmbed('User Muted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Duration:** ${durationText}\n\n**Reason:** ${reason}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to mute user.')] });
        }
    }

    // ========== UNMUTE COMMAND ==========
    if (command === 'unmute') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to unmute. Example: `.unmute 123456789012345678` or `.unmute @user`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to unmute someone.')] });
        }

        if (!targetMember.isCommunicationDisabled()) {
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} is not muted.`)] });
        }

        try {
            await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
            const embed = createSuccessEmbed('User Unmuted', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}`);
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await message.reply({ embeds: [createErrorEmbed('Error', 'Failed to unmute user.')] });
        }
    }

    // ========== WARN COMMAND (Works with ID and Mention) ==========
    if (command === 'warn') {
        const userInput = args[0];
        if (!userInput) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID or mention a user to warn. Example: `.warn 123456789012345678 reason here` or `.warn @user reason here`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }
        
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot warn yourself.')] });
        }

        let targetMember = await message.guild.members.fetch(userId).catch(() => null);
        
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user in the server.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to warn someone.')] });
        }

        const memberHighestRole = message.member.roles.highest;
        const targetHighestRole = targetMember.roles.highest;
        
        if (targetHighestRole.position >= memberHighestRole.position && message.member.id !== message.guild.ownerId) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Cannot warn ${targetMember.user.tag} - they have a role higher than or equal to your highest role.`)] });
        }

        const reason = getReason(args.slice(1));
        const warnId = Date.now().toString();

        if (!warns.has(userId)) {
            warns.set(userId, []);
        }

        warns.get(userId).push({
            id: warnId,
            reason: reason,
            moderator: message.author.tag,
            moderatorId: message.author.id,
            timestamp: new Date().toLocaleString()
        });

        const warnCount = warns.get(userId).length;
        
        const embed = createSuccessEmbed('User Warned', `**User:** ${targetMember.user.toString()}\n\n**Moderator:** ${message.author.toString()}\n\n**Reason:** ${reason}\n\n**Warning ID:** ${warnId}\n\n**Total Warnings:** ${warnCount}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== UNWARN COMMAND ==========
    if (command === 'unwarn') {
        const userInput = args[0];
        const warnId = args[1];
        
        if (!userInput || !warnId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Please provide a user ID/mention and a warning ID. Example: `.unwarn @user warningID` or `.unwarn 123456789012345678 warningID`')] });
        }

        const userId = getUserIdFromInput(userInput);
        if (!userId) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Invalid user ID.')] });
        }
        
        if (userId === message.author.id) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You cannot remove your own warnings.')] });
        }

        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
        }

        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to remove warnings.')] });
        }

        if (!warns.has(userId)) {
            return message.reply({ embeds: [createErrorEmbed('Error', `${targetMember.user.tag} has no warnings.`)] });
        }

        const userWarns = warns.get(userId);
        const warnIndex = userWarns.findIndex(w => w.id === warnId);
        
        if (warnIndex === -1) {
            return message.reply({ embeds: [createErrorEmbed('Error', `Could not find a warning with ID ${warnId}. Use \`.warns\` to see warning IDs.`)] });
        }

        const removedWarn = userWarns[warnIndex];
        
        if (removedWarn.moderatorId !== message.author.id) {
            const originalWarner = await message.guild.members.fetch(removedWarn.moderatorId).catch(() => null);
            if (originalWarner && message.member.id !== message.guild.ownerId) {
                const memberHighestRole = message.member.roles.highest;
                const warnerHighestRole = originalWarner.roles.highest;
                if (warnerHighestRole.position > memberHighestRole.position) {
                    return message.reply({ embeds: [createErrorEmbed('Error', `Cannot remove this warning - it was issued by someone with a higher role than you (${removedWarn.moderator}).`)] });
                }
            }
        }

        userWarns.splice(warnIndex, 1);
        if (userWarns.length === 0) {
            warns.delete(userId);
        }

        const embed = createSuccessEmbed('Warning Removed', `**User:** ${targetMember.user.toString()}\n\n**Removed Warning ID:** ${warnId}\n\n**Original Reason:** ${removedWarn.reason}\n\n**Original Moderator:** ${removedWarn.moderator}\n\n**Removed by:** ${message.author.toString()}\n\n**Remaining Warnings:** ${userWarns.length}`);
        await message.reply({ embeds: [embed] });
    }

    // ========== WARNS COMMAND ==========
    if (command === 'warns') {
        let targetMember = message.member;
        let isSelf = true;
        
        if (args[0]) {
            const userId = getUserIdFromInput(args[0]);
            if (userId) {
                targetMember = await message.guild.members.fetch(userId).catch(() => null);
            }
            
            if (!targetMember) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'Could not find that user.')] });
            }
            
            if (userId !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return message.reply({ embeds: [createErrorEmbed('Error', 'You need **Moderate Members** permission to view other users\' warnings.')] });
            }
            isSelf = false;
        }
        
        const userWarns = warns.get(targetMember.id) || [];
        
        if (userWarns.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`Warnings for ${targetMember.user.tag}`)
                .setDescription(`${isSelf ? 'You have' : 'This user has'} no warnings.`)
                .setColor(0x00FF00)
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }
        
        let description = `**Total Warnings:** ${userWarns.length}\n\n`;
        userWarns.forEach((warn, index) => {
            description += `**Warning #${index + 1} (ID: ${warn.id})**\n`;
            description += `📝 Reason: ${warn.reason}\n`;
            description += `👤 Moderator: ${warn.moderator}\n`;
            description += `⏰ Time: ${warn.timestamp}\n\n`;
        });
        
        const embed = new EmbedBuilder()
            .setTitle(`Warnings for ${targetMember.user.tag}`)
            .setDescription(description.substring(0, 4096))
            .setColor(0xFFA500)
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
