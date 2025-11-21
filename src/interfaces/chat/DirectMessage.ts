// import: local interfaces
import { Participant } from '../participant/Participant.js'

// declaration
interface DirectMessage {
    m: 'dm'
    a: string
    recipient: Participant
    sender: Participant
    t: number
    id: string
    r?: string
}
export {
    DirectMessage
}