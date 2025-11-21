// import: local interfaces
import { Participant } from '../participant/Participant.js'

// declaration
interface ChatMessage {
    m: 'a'
    a: string
    p: Participant
    t: number
    id: string
    r?: string
}
export {
    ChatMessage
}