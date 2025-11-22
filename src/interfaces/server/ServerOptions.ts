interface ServerOptions {
    /**
     * Lobby room list.
     * - These lobbies cannot be removed.
     */
    lobbies?: string[]
    /**
     * Settings for account tokens.
     */
    tokens?: {
        /**
         * Different types for the structure of an MPP token
         * - `jwt` - use JSON Web Tokens for the server.
         * - `legacy` - use legacy MPP tokens for the server.
         * - `none` - Don't use tokens.
         * @default 'jwt'
         */
        type?: 'jwt' | 'legacy'
        /**
         * Settings for the JWT tokens.
         */
        jwt?: {
            /**
             * The JWT secret.
             * @default 'e8wbn49najg8a8gj8hi7bg7a18f5bo9a'
             */
            secret?: string
        }
    }
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