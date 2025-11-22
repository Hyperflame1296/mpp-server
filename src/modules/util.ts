// import: constants
import jwt from 'jsonwebtoken'

// code
export const util = {
    validateJwtToken(token: string, secret: string) {
        try {
            jwt.verify(token, secret)
            return true
        } catch (err) {
            return false
        }
    },
    isUUIDv4(str: string) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);
    }
}