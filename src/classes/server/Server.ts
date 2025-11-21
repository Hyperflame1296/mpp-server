// import: classes
import { WebSocket, WebSocketServer } from 'ws'

// import: constants
import fs from 'node:fs'
import crypto from 'node:crypto'
import color from 'cli-color'
import jwt from 'jsonwebtoken'
import * as uuid from 'uuid'

// import: local constants
import { util } from '../../modules/util.js'

// import: local interfaces
import { Channel } from '../../interfaces/channel/Channel.js'
import { Participant } from '../../interfaces/participant/Participant.js'
import { ChatMessage } from '../../interfaces/chat/ChatMessage.js'
import { ServerOptions } from '../../interfaces/server/ServerOptions.js'
import { DirectMessage } from '../../interfaces/chat/DirectMessage.js'
import { ServerCommand } from '../../interfaces/server/ServerCommand.js'

// code
class Server {
    wss: WebSocketServer = null
    options: ServerOptions = {}
    liveUsers: Record<string, Participant> = {}
    /**
     * The settings for each channel
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
     * Server logging methods.
     */
    logging: Record<string, (text: string) => void> = {
        info: text => {
            return console.log(`[${color.cyanBright('INFO')}] - ${color.whiteBright(text)}`)
        },
        warn: text => {
            return console.log(`[${color.yellowBright('WARNING')}] - ${color.whiteBright(text)}`)
        },
        error: text => {
            return console.log(`[${color.redBright('ERROR')}] - ${color.whiteBright(text)}`)
        }
    }
    /**
     * Server commands.  
     * - Use these in MPP chat by typing the command name with `^` at the beginning.
     */
    serverCommands: Record<string, ServerCommand[]> = {
        main: [
            {
                name: 'js',
                aliases: ['eval'],
                func: (a: string[], input: string, msg: DirectMessage, ws: WebSocket) => {
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
					this.sendServerMessage(ws, `\`\`\`${str}\`\`\``)
                }
            },
            {
                name: 'rank',
                aliases: [],
                func: (a: string[], input: string, msg: DirectMessage, ws: WebSocket) => {
                    let rank = this.findRankByToken((ws as any).token)
					this.sendServerMessage(ws, `Your current rank is: \`${rank}\`.`)
                }
            },
            {
                name: 'setrank',
                aliases: [],
                func: (a: string[], input: string, msg: DirectMessage, ws: WebSocket) => {
                    let rank = Number.parseInt(input.trim())
                    if (Number.isNaN(rank))
                        return this.sendServerMessage(ws, `\`\`\`${input.trim()}\`\`\` is not a valid number.`)
                    if (rank < 0 || rank > 3)
                        return this.sendServerMessage(ws, `\`${input.trim()}\` is not a valid rank.`)
                    if (rank > this.findRankByToken((ws as any).token))
                        return this.sendServerMessage(ws, `You cannot set yourself to a higher rank.`)
                    this.setRank((ws as any).token, rank)
					this.sendServerMessage(ws, `Your rank has been set to \`${rank}\`.`)
                }
            }
        ]
    }
    /**
     * All currently loaded user ranks by token.
     */
    ranks: Record<string, number> = {

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
    constructor(options?: ServerOptions) {
        this.options.lobbies   = options?.lobbies   ?? ['lobby', 'test/awkward']
        this.options.useJwt    = options?.useJwt    ?? true
        this.options.jwtSecret = options?.jwtSecret ?? 'e8wbn49najg8a8gj8hi7bg7a18f5bo9a'
    }
    sendServerMessage(ws: WebSocket, message: string, reply_to?: string) {
        let dm: DirectMessage = {
            m: 'dm',
            a: message,
            id: Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
            sender: this.serverParticipant,
            recipient: this.findParticipantByToken((ws as any).token),
            t: Date.now(),
        }
        reply_to ? dm.r = reply_to : void 0
        this.sendArrayTo(ws, dm)
    }
    handleServerCommand(msg: DirectMessage) {
        let ws = this.findClientById(msg.sender._id)
        if (!ws || !(ws as any).token)
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
                        if (this.findRankByToken((ws as any).token) >= 2)
						    command.func(a, input, msg, ws)
                        else
                            this.sendServerMessage(ws, `You don't have permission to use that command.`, msg.id)
					} catch (err) {
						this.sendServerMessage(ws, `\`\`\`${err}\`\`\``, msg.id)
					}
				} else this.sendServerMessage(ws, `This command doesn\'t exist.`, msg.id)
			}
		} catch (err) {
			this.sendServerMessage(ws, `\`\`\`${err}\`\`\``, msg.id)
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
    sendArray(exclusions: WebSocket[], ...data: object[]) {
        if (!this.wss)
            return
        for (let ws of this.wss.clients) {
            if (exclusions.includes(ws))
                continue
            ws.send(JSON.stringify(data))
        }
    }
    sendArrayChannel(exclusions: WebSocket[], channel: string, ...data: object[]) {
        for (let ws of [...this.wss.clients].filter(ws => (ws as any).channel == channel)) {
            if (exclusions.includes(ws))
                continue
            ws.send(JSON.stringify(data))
        }
    }
    sendArrayTo(ws: WebSocket, ...data: object[]) {
        if (!this.wss)
            return
        ws.send(JSON.stringify(data))
    }
    findParticipantById(id: string): Participant {
        return Object.values(this.liveUsers).find(u => u._id === id)
    }
    findParticipantByToken(token: string): Participant {
        return this.liveUsers[token]
    }
    findClientById(_id: string) {
        return [...this.wss.clients].find((ws: WebSocket) => this.findParticipantByToken((ws as any).token)._id === _id)
    }
    findRankByToken(token: string) {
        return this.ranks[token] ?? 0
    }
    generateHexCode(numDigits: number) {
        let res = ''
        let chars = '0123456789abcdef'
        for (let i = 0; i < numDigits; i++) {
            res += chars[Math.floor(Math.random() * chars.length)]
        }
        return res
    }
    setUser(token: string, data: any) {
        let input = JSON.parse(fs.readFileSync('./userDatabase.json', 'utf-8'))
        let output = structuredClone(input)
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
            default:
                delete data.tag
                break
        }
        if (output[token])
            Object.assign(output[token], data)
        else output[token] = data as Participant
        if (this.liveUsers[token])
            Object.assign(this.liveUsers[token], data)
        else this.liveUsers[token] = data as Participant
        fs.writeFileSync('./userDatabase.json', JSON.stringify(output), 'utf-8')
    }
    updateRanks() {
        let input = JSON.parse(fs.readFileSync('./userDatabase.json', 'utf-8'))
        let output = structuredClone(input)
        let data: any = {}
        for (let token in output) {
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
                default:
                    delete data.tag
                    break
            }
            Object.assign(output[token], data)
            Object.assign(this.liveUsers[token], data)
        }
        fs.writeFileSync('./userDatabase.json', JSON.stringify(output), 'utf-8')
    }
    setRank(token: string, rank: number) {
        let input = JSON.parse(fs.readFileSync('./userRanks.json', 'utf-8'))
        let output = structuredClone(input)
        output[token] = rank
        this.ranks[token] = rank
        fs.writeFileSync('./userRanks.json', JSON.stringify(output), 'utf-8')
    }
    getUsersInChannel(channel: string) {
        if (!this.wss)
            return
        let clients = [...this.wss.clients]
        return clients.filter((ws, i) => (ws as any).channel === channel && clients.findLastIndex(w => (w as any).token === (ws as any).token) === i).map((ws: WebSocket) => this.liveUsers[(ws as any).token])
    }
    getClientsInChannel(channel: string) {
        if (!this.wss)
            return
        return [...this.wss.clients].filter(ws => (ws as any).channel === channel)
    }
    getClientsForToken(token: string, channel: string) {
        if (!this.wss)
            return
        return [...this.wss.clients].filter(ws => (ws as any).token === token && (ws as any).channel === channel)
    }
    createChannel(_id: string, creatorID?: string, set?: object) {
        let ch = this.getChannel(_id)
        if (!ch) {
            let channelSettings: any = {
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
    getChannel(_id: string) {
        return this.channelSettings.find(set => set?._id === _id)
    }
    updateChannelCount(_id: string) {
        let channel = this.channelSettings.find(set => set?._id === _id)
        let clients = [...this.wss.clients]
        let count = clients.filter((ws, i) => (ws as any).channel === _id && clients.findLastIndex(w => (w as any).token === (ws as any).token) === i).length
        channel.count = count
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
                uuid.validate(sections[1])
            )
        },
        jwtToken: (code: string) => {
            return util.validateJwtToken(code, this.options.jwtSecret)
        }
    }
    init() {
        if (this.initialized)
            this.logging.warn('.init() called when the server is already initialized!')

        if (!fs.existsSync('./userDatabase.json')) {
            fs.writeFileSync('./userDatabase.json', '{}', 'utf-8')
            this.liveUsers = {}
        } else 
            this.liveUsers = JSON.parse(fs.readFileSync('./userDatabase.json', 'utf-8'))

        if (!fs.existsSync('./userRanks.json')) {
            fs.writeFileSync('./userRanks.json', '{}', 'utf-8')
            this.ranks = {}
        } else 
            this.ranks = JSON.parse(fs.readFileSync('./userRanks.json', 'utf-8'))

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
        this.logging.info('Server initalized!');
    }
    start(port: number = 4000) {
        if (!this.initialized)
            return this.logging.error('The server is not yet initialized; run .init() first!')
        this.wss = new WebSocketServer({ port })
        this.logging.info('Server started!');
        this.wss.on('connection', (ws: WebSocket) => {
            this.logging.info(`A client has connected! [${color.blueBright(this.wss.clients.size)}]`);
            this.sendArrayTo(ws, {
                m: 'b',
                code: `~let l="0123456789abcdefghijklmnopqrstuvwxyz",o=Array(5).fill("");for(let r=0;r<5;r++)for(let t=0;t<5;t++)o[r]+=2==r&&0==t?"0":l[Math.floor(36*Math.random())];return o.join(".");`
            })
            ws.on('message', (raw: string) => {
                let transmission = JSON.parse(raw)
                for (let msg of transmission) {
                    switch (msg.m) {
                        case 'm':
                            if (!(ws as any).token)
                                continue
                            let x = Number.parseFloat(msg.x),
                                y = Number.parseFloat(msg.y)
                            if (Number.isNaN(x) || Number.isNaN(y))
                                continue
                            this.sendArrayChannel([ws], (ws as any).channel ?? 'lobby', {
                                m: 'm',
                                x: x.toFixed(2),
                                y: y.toFixed(2),
                                id: this.findParticipantByToken((ws as any).token)._id
                            })
                            this.liveUsers[(ws as any).token].x = x
                            this.liveUsers[(ws as any).token].y = y
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
                                        this.sendArrayTo(ws, {
                                            m: 'hi',
                                            motd: 'welcome',
                                            t: Date.now(),
                                            u,
                                        });
                                        (ws as any).token = msg.token
                                        continue
                                    }
                                }
                            }
                            { // generate a new token
                                let _id = this.generateHexCode(24)
                                let u = {
                                    afk: false,
                                    color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
                                    name: 'Anonymous',
                                    _id,
                                    id: _id
                                }
                                if (this.options.useJwt) {
                                    let token = this.generateJwtToken(_id, Date.now());
                                    (ws as any).token = token

                                    this.sendArrayTo(ws, {
                                        m: 'hi',
                                        motd: 'welcome',
                                        t: Date.now(),
                                        token,
                                        u,
                                    })
                                    this.setUser(token, u)
                                } else {
                                    let token = _id + '.' + uuid.v4();
                                    (ws as any).token = token

                                    this.sendArrayTo(ws, {
                                        m: 'hi',
                                        motd: 'welcome',
                                        t: Date.now(),
                                        token,
                                        u,
                                    })
                                    this.setUser(token, u)
                                }
                            }
                            break
                        case 'ch':
                            if (!(ws as any).token)
                                continue
                            let prevChannel = (ws as any).channel;
                            (ws as any).channel = msg._id
                            let p = this.findParticipantByToken((ws as any).token)._id
                            let ch = this.createChannel(msg._id, p, msg.set)
                            this.sendArrayTo(ws, {
                                m: 'ch',
                                ch,
                                p,
                                ppl: [...new Set(this.getUsersInChannel(msg._id))],
                            })
                            this.sendArrayTo(ws, {
                                m: 'c',
                                c: this.channelHistories[msg._id].filter(msg => msg.m === 'dm' ? msg.recipient?._id === p : true)
                            })
                            if (this.getClientsForToken((ws as any).token, msg._id).length === 1) {
                                this.sendArrayChannel([ws], msg._id, {
                                    m: 'p',
                                    ...this.findParticipantByToken((ws as any).token)
                                })
                                this.updateChannelCount(msg._id)
                            }
                            if (prevChannel) {
                                if (this.getClientsForToken((ws as any).token, prevChannel).length === 0) {
                                    this.sendArrayChannel([ws], prevChannel, {
                                        m: 'bye',
                                        p
                                    })
                                    let prevChannelSettings = this.getChannel(prevChannel)
                                    if (prevChannelSettings)
                                        this.updateChannelCount(prevChannel)
                                }
                            }   
                            break
                        case 'a':
                            if (!(ws as any).token)
                                continue
                            if (!msg.message.startsWith('^')) {
                                let message: ChatMessage = {
                                    m: 'a',
                                    a: msg.message,
                                    id: Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
                                    p: this.findParticipantByToken((ws as any).token),
                                    t: Date.now(),
                                }
                                msg.reply_to ? message.r = msg.reply_to : void 0
                                this.sendArrayChannel([], (ws as any).channel ?? 'lobby', message)
                                this.channelHistories[(ws as any).channel ?? 'lobby'].push(message)
                            } else {
                                let dm: DirectMessage = {
                                    m: 'dm',
                                    a: msg.message,
                                    id: Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
                                    sender: this.findParticipantByToken((ws as any).token),
                                    recipient: this.serverParticipant,
                                    t: Date.now(),
                                }
                                this.sendArrayTo(ws, dm)
                                this.channelHistories[(ws as any).channel ?? 'lobby'].push(dm)
                                this.handleServerCommand(dm)
                            }
                            break
                        case 'dm':
                            if (!(ws as any).token)
                                continue
                            if ((this.findClientById(msg._id) as any).channel !== (ws as any).channel)
                                continue
                            let dm: DirectMessage = {
                                m: 'dm',
                                a: msg.message,
                                id: Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
                                sender: this.findParticipantByToken((ws as any).token),
                                recipient: this.findParticipantByToken(msg._id),
                                t: Date.now(),
                            }
                            msg.reply_to ? dm.r = msg.reply_to : void 0
                            this.sendArrayTo(ws, dm)
                            this.channelHistories[(ws as any).channel ?? 'lobby'].push(dm)
                            break
                        case 'n':
                            if (!(ws as any).token)
                                continue
                            this.sendArrayChannel([ws], (ws as any).channel ?? 'lobby', {
                                m: 'n',
                                n: msg.n,
                                p: this.findParticipantByToken((ws as any).token)._id,
                                t: Date.now()
                            })
                            break
                        case 'userset':
                            if (!(ws as any).token)
                                continue
                            if (!this.validate.hexColor(msg.set.color))
                                continue
                            this.setUser((ws as any).token, msg.set)
                            this.sendArrayChannel([], (ws as any).channel ?? 'lobby', {
                                m: 'p',
                                ...this.findParticipantByToken((ws as any).token)
                            })
                            break
                        case '+ls':
                            if (!(ws as any).token)
                                continue
                            this.sendArrayTo(ws, {
                                m: 'ls',
                                c: true,
                                u: Object.values(this.channelSettings).filter((set: any) => (set._id === (ws as any).channel ? true : set.settings.visible))
                            })
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
                            if (!(ws as any).token)
                                continue
                            break
                    }
                }
            })
            ws.on('close', (e: number) => {
                this.logging.info(`A client has been disconnected! [${color.blueBright(this.wss.clients.size)}] [code: ${color.yellowBright(e)}]`);
                if (!(ws as any).token)
                    return
                if (!(ws as any).channel)
                    return
                if (this.getClientsForToken((ws as any).token, (ws as any).channel).length === 0) {
                    this.sendArrayChannel([ws], (ws as any).channel, {
                        m: 'bye',
                        p: this.findParticipantByToken((ws as any).token)._id
                    })
                    this.updateChannelCount((ws as any).channel)
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