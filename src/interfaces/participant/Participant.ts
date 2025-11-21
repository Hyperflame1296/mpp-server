interface Participant {
    afk: boolean
    color: string
    name: string
    id: string
    _id: string
    x?: number
    y?: number
    tag?: {
        text: string
        color: string
    }
}
export {
    Participant
}