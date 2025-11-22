interface ParticipantModifier {
    /**
     * The rank of this user.
     */
    rank?: number
    /**
     * All of the quota multipliers this user has.
     */
    quota?: {
        chat?  : number
        note?  : number
        cursor?: number
        user?  : number
    }
}
export {
    ParticipantModifier
}