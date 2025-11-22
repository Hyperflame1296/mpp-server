// import: classes
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'

// import: local classes
import { EventLimiter } from '../ratelimit/EventLimiter.js'
import { NoteQuota } from '../ratelimit/NoteQuota.js'
import { Server } from '../server/Server.js'

// import: local interfaces
import { Channel } from '../../interfaces/channel/Channel.js'
import { DirectMessage } from '../../interfaces/chat/DirectMessage.js'
import { Participant } from '../../interfaces/participant/Participant.js'
import { ParticipantModifier } from '../../interfaces/participant/ParticipantModifier.js'

// import: constants
import color from 'cli-color'

/**
 * An MPP client, but from the server's perspective.
 */
class Client extends EventEmitter {
    ws: WebSocket
    parentServer: Server

    noteQuota  : NoteQuota    = new NoteQuota(null, NoteQuota.PARAMS_NORMAL)
    userQuota  : EventLimiter = new EventLimiter(5 )
    chatQuota  : EventLimiter = new EventLimiter(10)
    cursorQuota: EventLimiter = new EventLimiter(20)

    modifier: ParticipantModifier
    channel: Channel
    participantId: string
    token: string
    user: Participant
    
    subscriptions: string[] = []
    /**
     * Class logging methods.
     */
    #logging: Record<string, (text: string) => void> = {
        info: text => {
            return console.log(`[${color.cyanBright('INFO')}] - ${color.whiteBright('Client.ts')} - ${color.whiteBright(text)}`)
        },
        warn: text => {
            return console.log(`[${color.yellowBright('WARNING')}] - ${color.whiteBright('Client.ts')} - ${color.whiteBright(text)}`)
        },
        error: text => {
            return console.log(`[${color.redBright('ERROR')}] - ${color.whiteBright('Client.ts')} - ${color.whiteBright(text)}`)
        }
    }
    constructor(ws: WebSocket, parentServer?: Server) {
        super()
        if (ws.readyState !== WebSocket.OPEN) {
            this.#logging.warn('Client initialized using a WebSocket that isn\'t fully connected.') // theoretically, you shouldn't ever see this
            ws.once('open', () => {
                this.ws = ws
                this.parentServer = parentServer
            })
            return this
        }
        this.ws = ws
        this.parentServer = parentServer
    }
    /**
     * Whether a client is the owner of the channel it's currently in
     */
    isOwner(): boolean {
        return this.channel.crown?.participantId === this.participantId
    }
    /**
     * Sends a server message to this client,
     * @param message The message to send.
     * @param reply_to The message ID to reply to.
     */
    serverMessage(message: string, reply_to?: string) {
        if (!this.parentServer)
            return
        let dm: DirectMessage = {
            m: 'dm',
            a: message,
            id: Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
            sender: this.parentServer.serverParticipant,
            recipient: this.user,
            t: Date.now(),
        }
        reply_to ? dm.r = reply_to : void 0
        this.sendArray([dm])
    }
    /**
     * Send a group of messages to the client.
     * @param data The array of messages to send.
     */
    sendArray(data: any[]) {
        if (!this.ws)
            return
        this.ws.send(JSON.stringify(data))
    }
    /**
     * Sends raw data to the client.
     * @param data The data to send.
     */
    send(data: ArrayBufferLike | string) {
        if (!this.ws)
            return
        this.ws.send(data)
    }
    /**
     * Make a client listen for an event that requires a subscription.
     */
    subscribe(type: string) {
        if (this.subscribedTo(type))
            return
        this.subscriptions.push(type)
    }
    /**
     * Make a client stop listening for an event that requires a subscription.
     */
    unsubscribe(type: string) {
        if (!this.subscribedTo(type))
            return
        this.subscriptions.splice(this.subscriptions.indexOf(type), 1)
    }
    /**
     * Whether a client is subscribed to events that apply or not.
     * @param type The event type to check.
     */
    subscribedTo(type: string): boolean {
        return this.subscriptions.includes(type)
    }
}
export {
    Client
}