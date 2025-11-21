import { Server } from './dist/index.js'
console.clear()
let server = new Server({})
server.init()
server.start(4000)