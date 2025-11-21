// import: constants
import jwt from 'jsonwebtoken'

// code
export const util = {
    validateJSON(data: string) {
        try {
            JSON.parse(data)
            return true
        } catch (err) {
            return false
        }
    },
    validateJwtToken(token: string, secret: string) {
        try {
            jwt.verify(token, secret)
            return true
        } catch (err) {
            return false
        }
    }
}