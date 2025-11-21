// import: classes
import { WebSocket } from 'ws'

// declaration
interface ServerCommand {
    name: string
    aliases: string[]
    func: (a?: string[], input?: string, msg?: any, ws?: WebSocket) => any
}
export {
    ServerCommand
}