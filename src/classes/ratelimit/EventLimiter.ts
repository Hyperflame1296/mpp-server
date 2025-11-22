class EventLimiter {
    eventCount: number = 0
    interval: NodeJS.Timeout
    max: number
    constructor(maxPerTwoSeconds: number) {
        this.max = maxPerTwoSeconds
        this.interval = setInterval((() => {
            this.eventCount = 0
        }).bind(this), 2000)
    }
    stop() {
        this.interval.close()
    }
    emit() {
        if (this.eventCount >= this.max) return false
        this.eventCount += 1
        return true
    }
}
export {
    EventLimiter
}