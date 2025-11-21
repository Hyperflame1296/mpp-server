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
}
export {
    ServerOptions
}