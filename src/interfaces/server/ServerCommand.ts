// import: classes
import { WebSocket } from 'ws'

// import: local classes
import { Client } from '../../classes/client/Client.js'

// declaration
interface ServerCommand {
    name: string
    aliases: string[]
    func: (a?: string[], input?: string, msg?: any, client?: Client) => any
}
export {
    ServerCommand
}