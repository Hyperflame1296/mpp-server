// import: classes
import { WebSocket, WebSocketServer } from 'ws'

// import: local classes
import { Client } from '../client/Client.js'
import { EventLimiter } from '../ratelimit/EventLimiter.js'
import { NoteQuota } from '../ratelimit/NoteQuota.js'

// import: constants
import fs from 'node:fs'
import crypto from 'node:crypto'
import color from 'cli-color'
import jwt from 'jsonwebtoken'

// import: local constants
import { util } from '../../modules/util.js'

// import: local interfaces
import { Channel } from '../../interfaces/channel/Channel.js'
import { Participant } from '../../interfaces/participant/Participant.js'
import { ParticipantModifier } from '../../interfaces/participant/ParticipantModifier.js'
import { ChatMessage } from '../../interfaces/chat/ChatMessage.js'
import { DirectMessage } from '../../interfaces/chat/DirectMessage.js'
import { Vector2 } from '../../interfaces/math/Vector2.js'
import { ServerCommand } from '../../interfaces/server/ServerCommand.js'
import { ServerOptions } from '../../interfaces/server/ServerOptions.js'
import { NoteQuotaParams } from '../../interfaces/ratelimit/NoteQuotaParams.js'

// code
class Server {
    /**
     * The actual WebSocket server.
     */
    wss: WebSocketServer = null
    /**
     * Server options.
     */
    options: ServerOptions = {}
    /**
     * The participant list.
     */
    liveUsers: Record<string, Participant> = {}
    /**
     * All users loaded from the database.
     */
    userDatabase: Record<string, Participant> = {}
    /**
     * All currently loaded user modifiers.
     */
    modifiers: Record<string, ParticipantModifier> = {

    }
    /**
     * Class logging methods.
     */
    #logging: Record<string, (text: string) => void> = {
        info: text => {
            return console.log(`[${color.cyanBright('INFO')}] - ${color.whiteBright('Server.ts')} - ${color.whiteBright(text)}`)
        },
        warn: text => {
            return console.log(`[${color.yellowBright('WARNING')}] - ${color.whiteBright('Server.ts')} - ${color.whiteBright(text)}`)
        },
        error: text => {
            return console.log(`[${color.redBright('ERROR')}] - ${color.whiteBright('Server.ts')} - ${color.whiteBright(text)}`)
        }
    }
    /**
     * The settings for each channel.
     */
    channelSettings: Channel[] = []
    /**
     * The chat history for each channel.
     */
    channelHistories: Record<string, (ChatMessage | DirectMessage)[]> = {}
    /**
     * Whether the server is initialized or not.
     */
    initialized: boolean = false
    /**
     * Server commands.  
     * - Use these in MPP chat by typing the command name with `^` at the beginning.
     */
    serverCommands: Record<string, ServerCommand[]> = {
        main: [
            {
                name: 'js',
                aliases: ['eval'],
                func: (a: string[], input: string, msg: DirectMessage, client: Client) => {
                    let str = 'unknown type'
                    let res = eval(input)
					switch (typeof res) {
						case 'number':
						case 'function':
						case 'symbol':
							str = res.toString()
							break
						case 'bigint':
							str = res.toString() + 'n'
							break
						case 'string':
							str = res
							break
						case 'boolean':
							str = res ? 'true' : 'false'
							break
						case 'object':
							str = JSON.stringify(res)
							break
						case 'undefined':
							str = 'undefined'
							break
						default:
							str = 'unknown type'
							break
					}
					client.serverMessage(`\`\`\`${str}\`\`\``, msg.id)
                }
            },
            {
                name: 'rank',
                aliases: [],
                func: (a: string[], input: string, msg: DirectMessage, client: Client) => {
                    let rank = this.findRankByToken(client.token)
					client.serverMessage(`Your current rank is: \`${rank}\`.`, msg.id)
                }
            },
            {
                name: 'setrank',
                aliases: [],
                func: (a: string[], input: string, msg: DirectMessage, client: Client) => {
                    let rank = Number.parseInt(input.trim())
                    if (Number.isNaN(rank))
                        return client.serverMessage(`\`\`\`${input.trim()}\`\`\` is not a valid number.`, msg.id)
                    if (rank < 0 || rank > 3)
                        return client.serverMessage(`\`${input.trim()}\` is not a valid rank.`, msg.id)
                    if (rank > this.findRankByToken(client.token))
                        return client.serverMessage(`You cannot set yourself to a higher rank.`, msg.id)
                    this.setRank(client.token, rank)
					client.serverMessage(`Your rank has been set to \`${rank}\`.`, msg.id)
                }
            }
        ]
    }
    /**
     * The participant used for things like server messages.
     */
    serverParticipant: Participant = {
        afk: false,
        color: '#0066ff',
        name: 'Server',
        id: 'server',
        _id: 'server'
    }
    /**
     * All currently connected clients.
     */
    clients: Client[] = []
    constructor(options?: ServerOptions) {
        this.options.lobbies      = options?.lobbies      ?? ['lobby', 'test/awkward']
        this.options.useJwt       = options?.useJwt       ?? true
        this.options.jwtSecret    = options?.jwtSecret    ?? 'e8wbn49najg8a8gj8hi7bg7a18f5bo9a'
        this.options.paths = {
            userDB       : options?.paths?.userDB        ?? './userDatabase.json',
            userModifiers: options?.paths?.userModifiers ?? './userModifiers.json'
        }
    }
    sendGlobalArray(exclusions: Client[], data: any[]) {
        if (!this.wss)
            return
        for (let client of this.clients) {
            if (exclusions.includes(client))
                continue
            client.sendArray(data)
        }
    }
    sendArrayChannel(exclusions: Client[], channel: string, data: object[]) {
        for (let client of this.clients.filter(client => client.channel == channel)) {
            if (exclusions.includes(client))
                continue
            client.send(JSON.stringify(data))
        }
    }
    findParticipantById(id: string): Participant {
        return Object.values(this.liveUsers).find(u => u._id === id)
    }
    findParticipantByToken(token: string): Participant {
        return this.liveUsers[token]
    }
    findClientById(_id: string) {
        return this.clients.find(client => client.participantId === _id)
    }
    findRankByToken(token: string) {
        return this.modifiers[token]?.rank ?? 0
    }
    setUser(token: string, data: any) {
        switch (this.findRankByToken(token)) {
            case 0:
                delete data.tag
                break
            case 1:
                data.tag = {
                    text: 'MOD',
                    color: '#00aa00'
                }
                break
            case 2:
                data.tag = {
                    text: 'ADMIN',
                    color: '#ff0000'
                }
                break
            case 3:
                data.tag = {
                    text: 'OWNER',
                    color: '#830000'
                }
                break
        }
        if (this.liveUsers[token])
            Object.assign(this.liveUsers[token], data)
        else this.liveUsers[token] = data as Participant
        if (this.userDatabase[token])
            Object.assign(this.userDatabase[token], data)
        else this.userDatabase[token] = data as Participant
    }
    updateRanks() {
        let data: any = {}
        for (let token in this.liveUsers) {
            switch (this.findRankByToken(token)) {
                case 0:
                    delete data.tag
                    break
                case 1:
                    data.tag = {
                        text: 'MOD',
                        color: '#00aa00'
                    }
                    break
                case 2:
                    data.tag = {
                        text: 'ADMIN',
                        color: '#ff0000'
                    }
                    break
                case 3:
                    data.tag = {
                        text: 'OWNER',
                        color: '#830000'
                    }
                    break
            }
            Object.assign(this.liveUsers[token], data)
            Object.assign(this.userDatabase[token], data)
        }
    }
    setRank(token: string, rank: number) {
        let input = JSON.parse(fs.readFileSync(this.options.paths.userModifiers, 'utf-8'))
        if (!input[token])
            return
        let output = structuredClone(input)
        output[token].rank = rank
        this.modifiers[token].rank = rank
        fs.writeFileSync(this.options.paths.userModifiers, JSON.stringify(output, undefined, 4), 'utf-8')
    }
    getUsersInChannel(channel: string) {
        if (!this.wss)
            return
        return this.clients.filter(client => client.channel === channel).map(client => this.liveUsers[client.token])
    }
    getClientsInChannel(channel: string) {
        if (!this.wss)
            return
        return this.clients.filter(client => client.channel === channel)
    }
    getClientsForToken(token: string, channel: string) {
        if (!this.wss)
            return
        return this.clients.filter(client => client.token === token && client.channel === channel)
    }
    createChannel(_id: string, creatorID?: string, set?: object): Channel {
        let ch = this.getChannel(_id)
        if (!ch) {
            let channelSettings: Channel = {
                count: 0,
                id: _id,
                _id,
                settings: {
                    allowBots: true,
                    chat: true,
                    color: '#3b5054',
                    color2: '#001014',
                    limit: 50,
                    noindex: false,
                    visible: true
                }
            }
            if (creatorID)
                channelSettings.crown = {
                    startPos: { x: 50, y: 50 },
                    endPos: { x: 50, y: 50 },
                    participantId: creatorID,
                    userId: creatorID,
                    time: Date.now()
                }
            if (set)
                Object.assign(channelSettings.settings, set)
            this.channelHistories[_id] = []
            this.channelSettings.push(channelSettings)
            return channelSettings
        }
        return ch
    }
    getChannel(_id: string): Channel {
        return this.channelSettings.find(set => set?._id === _id)
    }
    updateChannelCount(_id: string) {
        let channel = this.channelSettings.find(set => set?._id === _id)
        let count = this.clients.filter(client => client.channel === _id).length
        channel.count = count
        for (let client of this.clients) {
            client.sendArray([{
                m: 'ls',
                c: false,
                u: [channel]
            }])
        }
    }
    detectTokenType(token: string) {
        let sectionCount = token.split('.').length
        switch (sectionCount) {
            case 2:
                return 'legacy'
            case 3:
                return 'jwt'
            default:
                return 'invalid'
        }
    }
    generateJwtToken(_id: string, time: number) {
        let payload = { 
            sub: _id, 
            iat: Math.trunc(time / 1000) 
        }
        return jwt.sign(payload, this.options.jwtSecret, { algorithm: 'HS256' });
    }
    handleServerCommand(msg: DirectMessage) {
        let client = this.findClientById(msg.sender._id)
        if (!client || !client.token)
            return
        try {
            let prefix = '^'
			let a = msg.a.split(' '),
				b = a[0]?.trim() ?? ''
			let input = msg.a.substring(b.length).trim()
			if (msg.sender._id !== this.serverParticipant._id) {
				let command = this.findServerCommand(b.replace(prefix, ''))
				if (command) {
					try {
                        if (this.findRankByToken(client.token) >= 2)
						    command.func(a, input, msg, client)
                        else
                            client.serverMessage(`You don't have permission to use that command.`, msg.id)
					} catch (err) {
						client.serverMessage(`\`\`\`${err}\`\`\``, msg.id)
					}
				} else client.serverMessage(`This command doesn\'t exist.`, msg.id)
			}
		} catch (err) {
			client.serverMessage(`\`\`\`${err}\`\`\``, msg.id)
		}
    }
    findServerCommand(name: string): ServerCommand {
		let command: ServerCommand
		for (let category in this.serverCommands) {
			let commands = this.serverCommands[category]
			command = commands.find((h: ServerCommand) => h.name === name || h.aliases.includes(name))
			if (command)
				break
		}
		return command
	}
    validate: Record<string, (code: string) => boolean> = {
        connectionCode: (code: string) => {
            return (
                code && 
                code.length == 29 && 
                /^[0-9a-z]{5}\.[0-9a-z]{5}\.0[0-9a-z]{4}\.[0-9a-z]{5}\.[0-9a-z]{5}$/.test(code)
            )
        },
        hexColor: (code: string) => {
            let int = Number.parseInt(code.substring(1), 16)
            return code && code[0] === '#' && code.length <= 7 && !Number.isNaN(int) && int <= 0xffffff && int >= 0
        },
        legacyToken: (code: string) => {
            let sections = code.split('.')
            return (
                /^[0-9a-f]+$/.test(sections[0]) &&
                sections[0].length == 24 &&
                util.isUUIDv4(sections[1])
            )
        },
        jwtToken: (code: string) => {
            return util.validateJwtToken(code, this.options.jwtSecret)
        }
    }
    init() {
        if (this.initialized)
            this.#logging.warn('.init() called when the server is already initialized!')

        if (!fs.existsSync(this.options.paths.userDB))
            fs.writeFileSync(this.options.paths.userDB, '{}', 'utf-8')
        else {
            this.liveUsers = JSON.parse(fs.readFileSync(this.options.paths.userDB, 'utf-8'))
            this.userDatabase = JSON.parse(fs.readFileSync(this.options.paths.userDB, 'utf-8'))
        }

        if (!fs.existsSync(this.options.paths.userModifiers)) {
            fs.writeFileSync(this.options.paths.userModifiers, '{}', 'utf-8')
            this.modifiers = {}
        } else 
            this.modifiers = JSON.parse(fs.readFileSync(this.options.paths.userModifiers, 'utf-8'))

        this.updateRanks()

        for (let channel of this.options.lobbies) {
            this.channelHistories[channel] = []
            this.channelSettings.push({
                count: 0,
                id: channel,
                _id: channel,
                settings: {
                    allowBots: true,
                    chat: true,
                    color: '#73b3cc',
                    color2: '#273546',
                    crownsolo: false,
                    limit: 20,
                    lobby: true,
                    'no cussing': false,
                    noindex: false,
                    visible: true
                }
            })
        }
        this.initialized = true
        this.#logging.info('Server initalized!');
    }
    start(port: number = 4000) {
        if (!this.initialized)
            return this.#logging.error('The server is not yet initialized; run .init() first!')
        this.wss = new WebSocketServer({ port })
        this.#logging.info('Server started!');
        this.wss.on('connection', (ws: WebSocket) => {
            this.#logging.info(`A client has connected! [${color.blueBright(this.wss.clients.size)}]`);
            let client = new Client(ws, this)
            this.clients.push(client)
            client.sendArray([{
                m: 'b',
                code: `~let l="0123456789abcdefghijklmnopqrstuvwxyz",o=Array(5).fill("");for(let r=0;r<5;r++)for(let t=0;t<5;t++)o[r]+=2==r&&0==t?"0":l[Math.floor(36*Math.random())];return o.join(".");`
            }]);
            ws.on('message', (raw: string) => {
                let transmission = JSON.parse(raw)
                for (let msg of transmission) {
                    switch (msg.m) {
                        case 'm':
                            if (!client.token)
                                continue
                            if (!client.cursorQuota.emit())
                                continue
                            let pos: Vector2 = {
                                x: Number.parseFloat(msg.x),
                                y: Number.parseFloat(msg.y)
                            }
                            if (Number.isNaN(pos.x) || Number.isNaN(pos.y))
                                continue
                            this.sendArrayChannel([client], client.channel ?? 'lobby', [{
                                m: 'm',
                                x: pos.x.toFixed(2),
                                y: pos.y.toFixed(2),
                                id: client.participantId
                            }])
                            client.user.x = pos.x
                            client.user.y = pos.y
                            break
                        case 'hi':
                            if (!this.validate.connectionCode(msg.code))
                                ws.close()

                            if (msg.token) {
                                let tokenType = this.detectTokenType(msg.token)
                                let isValidToken = tokenType === 'legacy' ? this.validate.legacyToken(msg.token) : this.validate.jwtToken(msg.token)
                                if (isValidToken) {
                                    let u = this.findParticipantByToken(msg.token)
                                    if (u) {
                                        client.sendArray([{
                                            m: 'hi',
                                            motd: 'welcome',
                                            t: Date.now(),
                                            u,
                                        }]);
                                        client.token = msg.token
                                        client.participantId = u._id
                                        client.user = u

                                        // apply modifiers!
                                        client.modifier         = this.modifiers[msg.token] ?? {}
                                        client.chatQuota  .max *= this.modifiers[msg.token]?.quota?.chat   ?? 1
                                        client.cursorQuota.max *= this.modifiers[msg.token]?.quota?.cursor ?? 1
                                        client.userQuota  .max *= this.modifiers[msg.token]?.quota?.user   ?? 1
                                        continue
                                    }
                                }
                            }
                            { // generate a new token
                                let _id = crypto.randomBytes(12).toString('hex')
                                let u = {
                                    afk: false,
                                    color: '#' + crypto.randomBytes(3).toString('hex'),
                                    name: 'Anonymous',
                                    _id,
                                    id: _id
                                }
                                if (this.options.useJwt) {
                                    let token = this.generateJwtToken(_id, Date.now());
                                    client.token = token
                                    client.participantId = _id
                                    client.user = u

                                    // apply modifiers!
                                    client.modifier         = this.modifiers[msg.token] ?? {}
                                    client.chatQuota  .max *= this.modifiers[msg.token]?.quota?.chat   ?? 1
                                    client.cursorQuota.max *= this.modifiers[msg.token]?.quota?.cursor ?? 1
                                    client.userQuota  .max *= this.modifiers[msg.token]?.quota?.user   ?? 1
                                    client.sendArray([{
                                        m: 'hi',
                                        motd: 'welcome',
                                        t: Date.now(),
                                        token,
                                        u,
                                    }])
                                    this.setUser(token, u)
                                } else {
                                    let token = _id + '.' + crypto.randomUUID({ disableEntropyCache: true });
                                    client.token = token
                                    client.participantId = _id
                                    client.user = u

                                    // apply modifiers!
                                    client.modifier         = this.modifiers[msg.token] ?? {}
                                    client.chatQuota  .max *= this.modifiers[msg.token]?.quota?.chat   ?? 1
                                    client.cursorQuota.max *= this.modifiers[msg.token]?.quota?.cursor ?? 1
                                    client.userQuota  .max *= this.modifiers[msg.token]?.quota?.user   ?? 1
                                    client.sendArray([{
                                        m: 'hi',
                                        motd: 'welcome',
                                        t: Date.now(),
                                        token,
                                        u,
                                    }])
                                    this.setUser(token, u)
                                }
                            }
                            break
                        case 'ch':
                            if (!client.token)
                                continue
                            let prevChannel = client.channel;
                            client.channel = msg._id
                            let p = client.participantId
                            let ch = this.createChannel(msg._id, p, msg.set)
                            let nqParams = ((): NoteQuotaParams => {
                                if (this.findRankByToken(client.token) === 3)
                                    return NoteQuota.PARAMS_UNLIMITED
                                else if (ch.crown?.participantId === p)
                                    return NoteQuota.PARAMS_RIDICULOUS
                                else if (ch.settings.lobby)
                                    return NoteQuota.PARAMS_LOBBY
                                else
                                    return NoteQuota.PARAMS_NORMAL
                            })()
                            nqParams.allowance *= client.modifier?.quota?.note ?? 1
                            nqParams.max       *= client.modifier?.quota?.note ?? 1
                            client.noteQuota.setParams(nqParams)
                            client.sendArray([
                                {
                                    m: 'ch',
                                    ch,
                                    p,
                                    ppl: [...new Set(this.getUsersInChannel(msg._id))],
                                }
                            ]);
                            client.sendArray([
                                {
                                    m: 'c',
                                    c: this.channelHistories[msg._id].filter(msg => msg.m === 'dm' ? msg.recipient?._id === p : true)
                                }
                            ])
                            client.sendArray([
                                {
                                    m: 'nq',
                                    ...nqParams
                                }
                            ])
                            if (this.getClientsForToken(client.token, msg._id).length === 1) {
                                this.sendArrayChannel([client], msg._id, [{
                                    m: 'p',
                                    ...client.user
                                }])
                                this.updateChannelCount(msg._id)
                            }
                            if (prevChannel) {
                                if (this.getClientsForToken(client.token, prevChannel).length === 0) {
                                    this.sendArrayChannel([client], prevChannel, [{
                                        m: 'bye',
                                        p
                                    }])
                                    let prevChannelSettings = this.getChannel(prevChannel)
                                    if (prevChannelSettings)
                                        this.updateChannelCount(prevChannel)
                                }
                            }   
                            break
                        case 'a':
                            if (!client.token)
                                continue
                            if (!client.channel)
                                continue
                            if (!client.chatQuota.emit())
                                continue
                            if (!msg.message.startsWith('^')) {
                                let message: ChatMessage = {
                                    m: 'a',
                                    a: msg.message,
                                    id: crypto.randomBytes(4).toString('hex'),
                                    p: client.user,
                                    t: Date.now(),
                                }
                                msg.reply_to ? message.r = msg.reply_to : void 0
                                this.sendArrayChannel([], client.channel ?? 'lobby', [message])
                                this.channelHistories[client.channel ?? 'lobby'].push(message)
                            } else {
                                let dm: DirectMessage = {
                                    m: 'dm',
                                    a: msg.message,
                                    id: crypto.randomBytes(4).toString('hex'),
                                    sender: client.user,
                                    recipient: this.serverParticipant,
                                    t: Date.now(),
                                }
                                client.sendArray([dm])
                                this.channelHistories[client.channel ?? 'lobby'].push(dm)
                                this.handleServerCommand(dm)
                            }
                            break
                        case 'dm':
                            if (!client.token)
                                continue
                            if (!client.channel)
                                continue
                            if (!client.chatQuota.emit())
                                continue
                            let recipient = this.findClientById(msg._id)
                            if (recipient.channel !== client.channel)
                                continue
                            let r = crypto.randomBytes(4).toString('hex')
                            let dm: DirectMessage = {
                                m: 'dm',
                                a: msg.message,
                                id: r,
                                sender: client.user,
                                recipient: this.findParticipantById(msg._id),
                                t: Date.now(),
                            }
                            msg.reply_to ? dm.r = msg.reply_to : void 0
                            client.sendArray([dm])
                            recipient.sendArray([dm])
                            this.channelHistories[client.channel ?? 'lobby'].push(dm)
                            break
                        case 'n':
                            if (!client.token)
                                continue
                            if (!msg.n || msg.n.length == 0)
                                continue
                            if (!client.noteQuota.spend(msg.n.length))
                                continue
                            this.sendArrayChannel([client], client.channel ?? 'lobby', [{
                                m: 'n',
                                n: msg.n,
                                p: client.participantId,
                                t: Date.now()
                            }])
                            break
                        case 'userset':
                            if (!client.token)
                                continue
                            if (!client.userQuota.emit())
                                continue
                            if (!this.validate.hexColor(msg.set.color))
                                continue
                            this.setUser(client.token, msg.set)
                            this.sendArrayChannel([], client.channel ?? 'lobby', [{
                                m: 'p',
                                ...client.user
                            }])
                            break
                        case '+ls':
                            if (!client.token)
                                continue
                            client.subscribe('ls')
                            client.sendArray([{
                                m: 'ls',
                                c: true,
                                u: Object.values(this.channelSettings).filter((set: any) => (set._id === client.channel ? true : set.settings.visible))
                            }])
                            for (let channelKey in this.channelSettings) {
                                if (this.options.lobbies.includes(channelKey))
                                    continue
                                let ch = this.getChannel(channelKey)
                                if (!ch || ch.count <= 0) {
                                    delete this.channelSettings[this.channelSettings.indexOf(ch)]
                                    delete this.channelHistories[channelKey]
                                }
                            }
                            break
                        case '-ls':
                            if (!client.token)
                                continue
                            client.unsubscribe('ls')
                            break
                    }
                }
            })
            ws.on('close', (e: number) => {
                this.#logging.info(`A client has been disconnected! [${color.blueBright(this.wss.clients.size)}] [code: ${color.yellowBright(e)}]`);
                this.clients.splice(this.clients.indexOf(client), 1)
                if (!client.token)
                    return
                if (!client.channel)
                    return
                if (this.getClientsForToken(client.token, client.channel).length === 0) {
                    let input = JSON.parse(fs.readFileSync(this.options.paths.userDB, 'utf-8'))
                    let output = structuredClone(input)
                    output[client.token] = this.userDatabase[client.token]
                    fs.writeFileSync(this.options.paths.userDB, JSON.stringify(output, undefined, 4), 'utf-8')
                    this.sendArrayChannel([client], client.channel, [{
                        m: 'bye',
                        p: client.user
                    }])
                    this.updateChannelCount(client.channel)
                }
            })
        })
    }
    close() {
        this.wss.close()
    }
}
export {
    Server
}