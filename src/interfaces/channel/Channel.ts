// import: local interfaces
import { ChannelSettings } from './ChannelSettings.js'
import { Crown } from './Crown.js'

// declaration
interface Channel {
    count: number
    id: string
    _id: string
    crown?: Crown
    settings: ChannelSettings
}
export {
    Channel
}