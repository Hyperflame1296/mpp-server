// import: local classes
import { Client } from './classes/client/Client.js'
import { EventLimiter } from './classes/ratelimit/EventLimiter.js'
import { NoteQuota } from './classes/ratelimit/NoteQuota.js'
import { Server } from './classes/server/Server.js'

// import: local interfaces
import { Channel } from './interfaces/channel/Channel.js'
import { ChannelSettings } from './interfaces/channel/ChannelSettings.js'
import { Crown } from './interfaces/channel/Crown.js'
import { ChatMessage } from './interfaces/chat/ChatMessage.js'
import { DirectMessage } from './interfaces/chat/DirectMessage.js'
import { Vector2 } from './interfaces/math/Vector2.js'
import { Participant } from './interfaces/participant/Participant.js'
import { ParticipantModifier } from './interfaces/participant/ParticipantModifier.js'
import { NoteQuotaParams } from './interfaces/ratelimit/NoteQuotaParams.js'
import { ServerCommand } from './interfaces/server/ServerCommand.js'
import { ServerOptions } from './interfaces/server/ServerOptions.js'

// bridge
export {
    // classes/client
    Client,
    // classes/ratelimit
    EventLimiter,
    NoteQuota,
    // classes/server
    Server,

    // interfaces/channel
    Channel,
    ChannelSettings,
    Crown,
    // interfaces/chat
    ChatMessage,
    DirectMessage,
    // interfaces/math
    Vector2,
    // interfaces/participant
    Participant,
    ParticipantModifier,
    // interfaces/ratelimit
    NoteQuotaParams,
    // interfaces/server
    ServerCommand,
    ServerOptions,
}