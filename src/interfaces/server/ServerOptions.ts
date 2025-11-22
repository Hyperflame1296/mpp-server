interface ServerOptions {
    /**
     * Lobby list.
     * - These lobbies cannot be removed.
     */
    lobbies?: string[]
    /**
     * Whether or not to use JWT tokens when possible. 
     */
    useJwt?: boolean
    /**
     * The encryption secret to use for JWT tokens.
     */
    jwtSecret?: string
    /**
     * File directories for server data.
     */
    paths?: {
        /**
         * The path at which the user database is stored.
         * @default './userDatabase.json'
         */
        userDB?: string
        /**
         * The path at which extra user data (quota multiplier, rank, etc.) are stored.
         * @default './userModifiers.json'
         */
        userModifiers?: string
    }
}
export {
    ServerOptions
}